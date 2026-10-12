/**
 * APK Build Queue Poller
 * 轮询 runtime/apk_build_queue/*.json，按 FIFO 顺序执行 Python 打包。
 * 兼容旧版 runtime/apk_build_task.json。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
const config = require('../../config');

const PROJECT_ROOT = process.env.CS_ROOT || path.resolve(__dirname, '..', '..', '..');
const RUNTIME_DIR = process.env.CS_RUNTIME_DIR || path.join(PROJECT_ROOT, 'runtime');
const TASK_FILE = path.join(RUNTIME_DIR, 'apk_build_task.json');
const QUEUE_DIR = path.join(RUNTIME_DIR, 'apk_build_queue');
const STATUS_FILE = path.join(RUNTIME_DIR, 'apk_build_status.json');
const LOG_FILE = path.join(RUNTIME_DIR, 'apk_build.log');
const POLL_INTERVAL = 1000;
// build_apk.py 会校验并按需修补共享模板，默认必须串行，避免并发写模板产生不完整产物。
const MAX_CONCURRENT = 1;
const MIN_VISIBLE_PROGRESS_MS = Math.max(0, parseInt(process.env.APK_BUILD_MIN_VISIBLE_MS || '6500', 10) || 0);

const STATE_KEY = Symbol.for('fisher.apkBuilderState');
const state = globalThis[STATE_KEY] || (globalThis[STATE_KEY] = { active: new Set(), timer: null });
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
    timezone: config.mysql.timezone || '+08:00',
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

async function updateBuildProgress(task, progress, message) {
  const id = task.buildId || task.record_id || null;
  if (!id) return;
  try {
    await dbExecute('UPDATE fisher_apk_builds SET status=?, progress=?, message=? WHERE id=?', ['building', progress, message, id]);
  } catch (e) {
    console.log('[APK-Builder] DB progress update error:', e.message);
  }
}

function ensureQueueDir() {
  fs.mkdirSync(QUEUE_DIR, { recursive: true });
}

function validateApkArtifact(filePath, options = {}) {
  const verifySignature = options.verifySignature !== false;
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, size: 0, reason: '构建产物不存在' };
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size < 1024 * 1024) {
    return { ok: false, size: stat.size || 0, reason: '构建产物过小' };
  }

  try {
    execFileSync('unzip', ['-tqq', filePath], { timeout: 60000, stdio: 'ignore' });
    const entries = execFileSync('unzip', ['-Z1', filePath], {
      timeout: 60000,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }).split(/\r?\n/);
    const hasManifest = entries.includes('AndroidManifest.xml');
    const hasDex = entries.some(name => /^classes(?:\d+)?\.dex$/.test(name));
    if (!hasManifest || !hasDex) {
      return { ok: false, size: stat.size, reason: 'APK 缺少 Manifest 或 DEX' };
    }
  } catch (e) {
    return { ok: false, size: stat.size, reason: `APK ZIP 完整性校验失败: ${e.message}` };
  }

  if (verifySignature) {
    const candidates = [
      process.env.APKSIGNER_BIN,
      path.join(PROJECT_ROOT, 'extend', 'jiake', 'tools', 'apksigner'),
    ].filter(Boolean);
    const apksigner = candidates.find(candidate => fs.existsSync(candidate));
    if (apksigner) {
      try {
        execFileSync(apksigner, ['verify', filePath], { timeout: 60000, stdio: 'ignore' });
      } catch (e) {
        return { ok: false, size: stat.size, reason: `APK 签名校验失败: ${e.message}` };
      }
    }
  }

  return { ok: true, size: stat.size, reason: 'APK 结构与签名校验通过' };
}

function removeClaimFile(claimFile) {
  if (!claimFile) return;
  try {
    if (fs.existsSync(claimFile)) fs.unlinkSync(claimFile);
  } catch (e) {
    appendBuildLog(`Queue claim cleanup failed: ${e.message}`);
  }
}

function recoverClaimedTasks() {
  ensureQueueDir();
  const claimed = fs.readdirSync(QUEUE_DIR).filter(name => name.endsWith('.json.working')).sort();
  for (const name of claimed) {
    const from = path.join(QUEUE_DIR, name);
    const preferred = path.join(QUEUE_DIR, name.slice(0, -'.working'.length));
    const to = fs.existsSync(preferred)
      ? path.join(QUEUE_DIR, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`)
      : preferred;
    try {
      fs.renameSync(from, to);
      const task = JSON.parse(fs.readFileSync(to, 'utf8'));
      const id = task.buildId || task.record_id;
      if (id) {
        dbExecute('UPDATE fisher_apk_builds SET status=?, progress=?, message=? WHERE id=? AND status=?', ['queued', 1, '服务重启后已恢复到构建队列', id, 'building']).catch(() => {});
      }
      appendBuildLog(`Recovered claimed task: ${path.basename(to)}`);
    } catch (e) {
      appendBuildLog(`Recover claimed task failed: ${name}: ${e.message}`);
    }
  }
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
  const args = [task.pythonScript, '--server', task.serverUrl, '--output', task.outputPath];
  if (task.webUrl) args.push('--web', task.webUrl);
  if (task.appName) args.push('--name', task.appName);
  if (task.packageName) args.push('--package', task.packageName);
  if (task.config) args.push('--config', task.config);
  if (task.iconPath) args.push('--icon', task.iconPath);
  if (task.bgPath) args.push('--bg', task.bgPath);
  return args;
}

function startTask(task, raw, claimFile) {
  task.encrypt = false;
  if (!task.pythonScript || !task.serverUrl || !task.outputPath) {
    console.log('[APK-Builder] Invalid task:', task);
    appendBuildLog(`Invalid task: ${raw.substring(0, 500)}`);
    fs.writeFileSync(STATUS_FILE, JSON.stringify({
      is_building: state.active.size > 0,
      progress: 0,
      message: '构建失败: 任务参数不完整',
      logs: [`[${new Date().toTimeString().substring(0, 8)}] 构建失败: 任务参数不完整`]
    }));
    updateBuildRecord(task.outputFilename || '', 'failed', 0, '构建失败: 任务参数不完整');
    removeClaimFile(claimFile);
    return;
  }

  const key = String(task.buildId || task.record_id || task.outputFilename || claimFile);
  state.active.add(key);
  const startedAt = Date.now();
  let resultReady = false;
  const progressStages = [
    [800, 12, '准备构建环境'],
    [1600, 24, '生成应用配置'],
    [2600, 38, '处理图标和背景资源'],
    [3800, 55, '编译 APK 资源'],
    [5000, 72, '打包 APK 文件'],
    [6200, 88, '签名与校验 APK'],
  ];
  let lastStageProgress = 5;
  const progressTimer = setInterval(() => {
    if (resultReady) return;
    const elapsed = Date.now() - startedAt;
    const stage = [...progressStages].reverse().find(([ms]) => elapsed >= ms);
    if (!stage || stage[1] <= lastStageProgress) return;
    lastStageProgress = stage[1];
    updateBuildProgress(task, stage[1], stage[2]);
  }, 500);
  updateBuildProgress(task, 5, `构建线程 ${state.active.size}/${MAX_CONCURRENT} 已启动`);
  console.log('[APK-Builder] Starting build:', task.outputFilename, 'active:', state.active.size, '/', MAX_CONCURRENT);
  appendBuildLog(`Starting build: ${task.outputFilename}, active=${state.active.size}/${MAX_CONCURRENT}`);

  let args;
  try {
    args = buildArgs(task);
  } catch (e) {
    clearInterval(progressTimer);
    state.active.delete(key);
    appendBuildLog(`Prepare failed: ${e.message}`);
    updateBuildRecord(task.outputFilename, 'failed', 0, `构建准备失败: ${e.message}`);
    removeClaimFile(claimFile);
    return;
  }

  const isWin = os.platform() === 'win32';
  const python = isWin ? 'python' : (process.env.PYTHON_BIN || process.env.PYTHON || 'python3');
  const execOpts = {
    timeout: 120000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', APK_BUILD_THREADS: String(task.buildThreads || MAX_CONCURRENT) },
    shell: false,
    ...(isWin ? { windowsHide: true } : {})
  };

  execFile(python, args, execOpts, (err, stdout, stderr) => {
    resultReady = true;
    const output = (stdout || '') + (stderr || '') + (err?.stdout || '') + (err?.stderr || '');
    const artifactCheck = !err
      ? validateApkArtifact(task.outputPath)
      : { ok: false, size: 0, reason: err?.message || '构建进程失败' };
    const finishDelay = Math.max(0, MIN_VISIBLE_PROGRESS_MS - (Date.now() - startedAt));
    if (!err && artifactCheck.ok) {
      updateBuildProgress(task, 95, '构建完成，正在校验 ZIP 与签名');
    }
    setTimeout(() => {
      clearInterval(progressTimer);
      state.active.delete(key);
      removeClaimFile(claimFile);
      const timeStr = () => new Date().toTimeString().substring(0, 8);
      const logs = [];

      if (!err && artifactCheck.ok) {
      logs.push(`[${timeStr()}] 构建完成: ${task.outputFilename}`);

      if (task.encrypt && fs.existsSync(task.outputPath)) {
        const packScript = path.join(PROJECT_ROOT, 'extend', 'jiake', 'pack_jw.py');
        const packCwd = path.join(PROJECT_ROOT, 'extend', 'jiake');
        try {
          const packArgs = [packScript, task.outputPath, '-n', task.appName || 'App'];
          if (task.iconPath && fs.existsSync(task.iconPath)) packArgs.push('-i', task.iconPath);
          packArgs.push('-o', task.outputPath);
          execFileSync(python, packArgs, { cwd: packCwd, timeout: 300000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, shell: false, ...(isWin ? { windowsHide: true } : {}) });
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

      const size = artifactCheck.size;
      const msg = `构建成功并校验通过: ${task.outputFilename}`;
      console.log(`[APK-Builder] SUCCESS: ${task.outputFilename} (${(size / 1024 / 1024).toFixed(1)}MB)`);
      appendBuildLog(`SUCCESS: ${task.outputFilename} (${(size / 1024 / 1024).toFixed(1)}MB)`);
      logs.push(`[${timeStr()}] 最终文件: ${task.outputFilename} (${(size / 1024 / 1024).toFixed(1)}MB)`);
      fs.writeFileSync(STATUS_FILE, JSON.stringify({ is_building: state.active.size > 0, progress: 100, message: msg, last_output: task.outputFilename, last_build_at: new Date().toISOString().replace('T', ' ').substring(0, 19), logs }));
      updateBuildRecord(task.outputFilename, 'done', size, msg);
      } else {
        const failureReason = err?.message || artifactCheck.reason || output || '未知错误';
        const msg = `构建失败: ${failureReason.substring(0, 200)}`;
        console.log('[APK-Builder] FAILED:', err?.message || output.substring(0, 200));
        appendBuildLog(`FAILED: ${failureReason.substring(0, 500)}`);
        if (fs.existsSync(task.outputPath)) {
          try {
            fs.renameSync(task.outputPath, `${task.outputPath}.invalid-${Date.now()}`);
          } catch (quarantineError) {
            appendBuildLog(`Invalid artifact quarantine failed: ${quarantineError.message}`);
          }
        }
        fs.writeFileSync(STATUS_FILE, JSON.stringify({ is_building: state.active.size > 0, progress: 0, message: msg, logs: [`[${timeStr()}] ${msg}`] }));
        updateBuildRecord(task.outputFilename, 'failed', 0, msg);
      }
      setImmediate(pollBuildTask);
    }, finishDelay);
  });
}

function pollBuildTask() {
  try {
    importLegacyTaskFile();
    const slots = MAX_CONCURRENT - state.active.size;
    if (slots <= 0) return;
    for (const file of nextQueueFiles(slots)) {
      let raw = '';
      let claimFile = '';
      try {
        claimFile = file + '.working';
        fs.renameSync(file, claimFile);
        raw = fs.readFileSync(claimFile, 'utf-8');
        const task = JSON.parse(raw);
        startTask(task, raw, claimFile);
      } catch (e) {
        appendBuildLog(`Queue task read failed: ${e.message}`);
        const badSource = claimFile && fs.existsSync(claimFile) ? claimFile : file;
        try { fs.renameSync(badSource, badSource + '.bad'); } catch {}
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
  recoverClaimedTasks();
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
    validateApkArtifact,
    recoverClaimedTasks,
  },
};
