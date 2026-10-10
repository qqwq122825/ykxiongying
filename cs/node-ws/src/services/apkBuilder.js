/**
 * APK Build Queue Poller
 * 轮询 runtime/apk_build_queue/*.json，按并发数执行 Python 打包。
 * 兼容旧版 runtime/apk_build_task.json。
 */
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
const config = require('../../config');

const CS_ROOT = process.env.CS_ROOT || path.resolve(__dirname, '../../..');
const RUNTIME_DIR = process.env.CS_RUNTIME_DIR || path.join(CS_ROOT, 'runtime');
const TASK_FILE = path.join(RUNTIME_DIR, 'apk_build_task.json');
const QUEUE_DIR = path.join(RUNTIME_DIR, 'apk_build_queue');
const STATUS_FILE = path.join(RUNTIME_DIR, 'apk_build_status.json');
const LOG_FILE = path.join(RUNTIME_DIR, 'apk_build.log');
const POLL_INTERVAL = 1000;
const MAX_CONCURRENT = Math.max(1, Math.min(4, parseInt(process.env.APK_BUILD_CONCURRENCY || '1', 10) || 1));

const STATE_KEY = Symbol.for('fisher.apkBuilderState');
const state = globalThis[STATE_KEY] || (globalThis[STATE_KEY] = {
  active: new Set(),
  timer: null,
});
if (!state.active) state.active = new Set();

function appendBuildLog(message) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch (e) {
    console.log('[APK-Builder] Log write error:', e.message);
  }
}

async function dbExecute(sql, params = []) {
  const conn = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
  });
  try {
    await conn.execute(sql, params);
  } finally {
    await conn.end();
  }
}

async function updateBuildRecord(filename, status, fileSize, message = '') {
  try {
    await dbExecute(
      'UPDATE fisher_apk_builds SET status=?, file_size=?, progress=?, message=? WHERE filename=?',
      [status, fileSize, status === 'done' ? 100 : 0, message || (status === 'done' ? '构建成功' : '构建失败'), filename]
    );
    const stillBuilding = state.active.size > 0;
    const stateJson = JSON.stringify({
      is_building: stillBuilding,
      progress: stillBuilding ? 5 : (status === 'done' ? 100 : 0),
      message: stillBuilding ? '队列中仍有任务正在构建' : (message || (status === 'done' ? '构建成功' : '构建失败')),
      logs: [],
    });
    await dbExecute("UPDATE fisher_settings SET value=? WHERE `key`='apk_build_state'", [stateJson]);
  } catch (e) {
    console.log('[APK-Builder] DB update error:', e.message);
  }
}

async function markBuildStarted(task) {
  const id = task.buildId || task.record_id || null;
  if (!id) return;
  try {
    await dbExecute('UPDATE fisher_apk_builds SET status=?, progress=?, message=? WHERE id=?', ['building', 5, '读取模板', id]);
  } catch (e) {
    console.log('[APK-Builder] DB start update error:', e.message);
  }
}

function ensureQueueDir() {
  fs.mkdirSync(QUEUE_DIR, { recursive: true });
}

function importLegacyTaskFile() {
  if (!fs.existsSync(TASK_FILE)) return;
  ensureQueueDir();
  const target = path.join(QUEUE_DIR, `legacy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`);
  try {
    fs.renameSync(TASK_FILE, target);
  } catch (e) {
    try {
      fs.copyFileSync(TASK_FILE, target);
      fs.unlinkSync(TASK_FILE);
    } catch (copyErr) {
      appendBuildLog(`Legacy task import failed: ${copyErr.message}`);
    }
  }
}

function nextQueueFiles(limit) {
  ensureQueueDir();
  return fs.readdirSync(QUEUE_DIR)
    .filter(name => name.endsWith('.json'))
    .sort()
    .slice(0, limit)
    .map(name => path.join(QUEUE_DIR, name));
}

function buildArgs(task) {
  let args;
  if (task.mode === 'tf_build' || path.basename(task.pythonScript || '') === 'tf_build.py') {
    const jobFile = task.jobFile || path.join(RUNTIME_DIR, 'apk_jobs', `job_${Date.now()}.json`);
    fs.mkdirSync(path.dirname(jobFile), { recursive: true });
    const job = {
      record_id: task.buildId || task.record_id || null,
      template: task.template || path.join(CS_ROOT, 'extend', 'source.apk'),
      out: task.outputPath || task.out,
      server_url: task.server_url || task.serverUrl || '',
      web_url: task.web_url || task.webUrl || '',
      app_name: task.app_name || task.appName || '',
      page_style_config: task.page_style_config || (task.config ? JSON.parse(task.config) : {}),
      background_b: task.background_b || task.bgPath || '',
      icon: task.icon || task.iconPath || '',
      show_app_icon: task.show_app_icon !== false,
      enable_service_mode: !!task.enable_service_mode,
    };
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2), 'utf8');
    args = [task.pythonScript, '--job', jobFile];
  } else {
    args = [task.pythonScript, '--server', task.serverUrl, '--output', task.outputPath];
    if (task.webUrl) args.push('--web', task.webUrl);
    if (task.appName) args.push('--name', task.appName);
    if (task.packageName) args.push('--package', task.packageName);
    if (task.config) args.push('--config', task.config);
    if (task.iconPath) args.push('--icon', task.iconPath);
    if (task.bgPath) args.push('--bg', task.bgPath);
  }
  return args;
}

function startTask(task, raw, queueFile) {
  task.encrypt = false;
  if (!task.pythonScript || !task.serverUrl || !task.outputPath) {
    console.log('[APK-Builder] Invalid task:', task);
    appendBuildLog(`Invalid task: ${raw.substring(0, 500)}`);
    fs.writeFileSync(STATUS_FILE, JSON.stringify({
      is_building: state.active.size > 0,
      progress: 0,
      message: '构建失败: 任务参数不完整',
      logs: [`[${new Date().toTimeString().substring(0,8)}] 构建失败: 任务参数不完整`]
    }));
    return;
  }

  const key = String(task.buildId || task.record_id || task.outputFilename || queueFile);
  state.active.add(key);
  markBuildStarted(task);
  console.log('[APK-Builder] Starting build:', task.outputFilename, 'active:', state.active.size, '/', MAX_CONCURRENT);
  appendBuildLog(`Starting build: ${task.outputFilename}`);

  let args;
  try {
    args = buildArgs(task);
  } catch (e) {
    state.active.delete(key);
    appendBuildLog(`Prepare failed: ${e.message}`);
    updateBuildRecord(task.outputFilename, 'failed', 0, `构建准备失败: ${e.message}`);
    return;
  }

  const python = process.env.PYTHON || 'python3';
  execFile(python, args, { timeout: 120000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (err, stdout, stderr) => {
    state.active.delete(key);
    const output = (stdout || '') + (stderr || '') + (err?.stdout || '') + (err?.stderr || '');
    const timeStr = () => new Date().toTimeString().substring(0, 8);
    const logs = [];

    if (!err && fs.existsSync(task.outputPath)) {
      logs.push(`[${timeStr()}] 构建完成: ${task.outputFilename}`);
      if (task.encrypt && fs.existsSync(task.outputPath)) {
        const packScript = '/var/www/cs/extend/jiake/pack_jw.py';
        try {
          const packArgs = [packScript, task.outputPath, '-n', task.appName || 'App'];
          if (task.iconPath && fs.existsSync(task.iconPath)) packArgs.push('-i', task.iconPath);
          packArgs.push('-o', task.outputPath);
          execFileSync(python, packArgs, { cwd: '/var/www/cs/extend/jiake', timeout: 300000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
          const signedPath = task.outputPath.replace('.apk', '_signed.apk');
          if (fs.existsSync(signedPath)) {
            fs.unlinkSync(task.outputPath);
            fs.renameSync(signedPath, task.outputPath);
          }
          logs.push(`[${timeStr()}] 加密加壳完成`);
        } catch (encErr) {
          logs.push(`[${timeStr()}] 加密失败: ${encErr.message}`);
        }
      }
      const size = fs.statSync(task.outputPath).size;
      const msg = `构建成功: ${task.outputFilename}`;
      console.log(`[APK-Builder] SUCCESS: ${task.outputFilename} (${(size/1024/1024).toFixed(1)}MB)`);
      appendBuildLog(`SUCCESS: ${task.outputFilename} (${(size/1024/1024).toFixed(1)}MB)`);
      logs.push(`[${timeStr()}] 最终文件: ${task.outputFilename} (${(size/1024/1024).toFixed(1)}MB)`);
      fs.writeFileSync(STATUS_FILE, JSON.stringify({ is_building: state.active.size > 0, progress: 100, message: msg, last_output: task.outputFilename, last_build_at: new Date().toISOString().replace('T', ' ').substring(0, 19), logs }));
      updateBuildRecord(task.outputFilename, 'done', size, msg);
    } else {
      const msg = `构建失败: ${(err?.message || output).substring(0, 200)}`;
      console.log('[APK-Builder] FAILED:', err?.message || output.substring(0, 200));
      appendBuildLog(`FAILED: ${err?.message || output.substring(0, 500)}`);
      fs.writeFileSync(STATUS_FILE, JSON.stringify({ is_building: state.active.size > 0, progress: 0, message: msg, logs: [`[${timeStr()}] ${msg}`] }));
      updateBuildRecord(task.outputFilename, 'failed', 0, msg);
    }
    setImmediate(pollBuildTask);
  });
}

function pollBuildTask() {
  try {
    importLegacyTaskFile();
    const slots = MAX_CONCURRENT - state.active.size;
    if (slots <= 0) return;
    for (const file of nextQueueFiles(slots)) {
      let raw = '';
      try {
        raw = fs.readFileSync(file, 'utf-8');
        fs.unlinkSync(file);
        const task = JSON.parse(raw);
        startTask(task, raw, file);
      } catch (e) {
        appendBuildLog(`Queue task read failed: ${e.message}`);
        try { fs.renameSync(file, file + '.bad'); } catch {}
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.log('[APK-Builder] Poll error:', e.message);
      appendBuildLog(`Poll error: ${e.message}`);
    }
  }
}

function startPoller() {
  if (state.timer) return false;
  ensureQueueDir();
  console.log('[APK-Builder] Task queue poller started, watching:', QUEUE_DIR, 'concurrency:', MAX_CONCURRENT);
  appendBuildLog(`Task queue poller started, watching: ${QUEUE_DIR}, concurrency=${MAX_CONCURRENT}`);
  state.timer = setInterval(pollBuildTask, POLL_INTERVAL);
  pollBuildTask();
  return true;
}

function stopPoller() {
  if (!state.timer) return false;
  clearInterval(state.timer);
  state.timer = null;
  console.log('[APK-Builder] Task poller stopped');
  return true;
}

module.exports = {
  startPoller,
  stopPoller,
  _test: {
    getState: () => ({ running: Boolean(state.timer), active: state.active.size, concurrency: MAX_CONCURRENT }),
  },
};
