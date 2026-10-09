/**
 * APK Build Task Poller
 * 轮询 runtime 目录的 apk_build_task.json，执行 Python 打包
 */
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
const config = require('../../config');

const TASK_FILE = '/var/www/cs/runtime/apk_build_task.json';
const STATUS_FILE = '/var/www/cs/runtime/apk_build_status.json';
const LOG_FILE = '/var/www/cs/runtime/apk_build.log';
const POLL_INTERVAL = 3000; // 3秒轮询一次

const STATE_KEY = Symbol.for('fisher.apkBuilderState');
const state = globalThis[STATE_KEY] || (globalThis[STATE_KEY] = {
  building: false,
  timer: null,
});

function appendBuildLog(message) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch (e) {
    console.log('[APK-Builder] Log write error:', e.message);
  }
}

// 更新数据库构建记录
async function updateBuildRecord(filename, status, fileSize) {
  try {
    const conn = await mysql.createConnection({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
    });
    await conn.execute(
      'UPDATE fisher_apk_builds SET status=?, file_size=? WHERE filename=?',
      [status, fileSize, filename]
    );
    // 也更新 fisher_settings 中的构建状态
    const stateJson = JSON.stringify({ is_building: false, progress: status === 'done' ? 100 : 0, message: status === 'done' ? '构建成功' : '构建失败', logs: [] });
    await conn.execute(
      "UPDATE fisher_settings SET value=? WHERE `key`='apk_build_state'",
      [stateJson]
    );
    await conn.end();
  } catch (e) {
    console.log('[APK-Builder] DB update error:', e.message);
  }
}

function pollBuildTask() {
  if (state.building) return;
  
  try {
    if (!fs.existsSync(TASK_FILE)) return;
    
    const raw = fs.readFileSync(TASK_FILE, 'utf-8');
    const task = JSON.parse(raw);
    // 加密构建已经下线，旧任务或手工请求也只能走普通构建。
    task.encrypt = false;
    
    // 删除任务文件，防止重复执行
    fs.unlinkSync(TASK_FILE);
    
    if (!task.pythonScript || !task.serverUrl || !task.outputPath) {
      console.log('[APK-Builder] Invalid task:', task);
      appendBuildLog(`Invalid task: ${raw.substring(0, 500)}`);
      fs.writeFileSync(STATUS_FILE, JSON.stringify({
        is_building: false,
        progress: 0,
        message: '构建失败: 任务参数不完整',
        logs: [`[${new Date().toTimeString().substring(0,8)}] 构建失败: 任务参数不完整`]
      }));
      return;
    }
    
    state.building = true;
    console.log('[APK-Builder] Starting build:', task.outputFilename);
    appendBuildLog(`Starting build: ${task.outputFilename}`);
    
    const args = [
      task.pythonScript,
      '--server', task.serverUrl,
      '--output', task.outputPath,
    ];
    if (task.webUrl) args.push('--web', task.webUrl);
    if (task.appName) args.push('--name', task.appName);
    if (task.packageName) args.push('--package', task.packageName);
    if (task.config) args.push('--config', task.config);
    if (task.iconPath) args.push('--icon', task.iconPath);
    if (task.bgPath) args.push('--bg', task.bgPath);
    
    const python = 'python3';
    
    execFile(python, args, { timeout: 120000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (err, stdout, stderr) => {
      state.building = false;
      const output = (stdout || '') + (stderr || '');
      const timeStr = () => new Date().toTimeString().substring(0, 8);
      const logs = [];
      
      if (!err && fs.existsSync(task.outputPath)) {
        logs.push(`[${timeStr()}] 构建完成: ${task.outputFilename}`);
        
        // 普通构建成功后，如果需要加密
        if (task.encrypt && fs.existsSync(task.outputPath)) {
          const packScript = '/var/www/cs/extend/jiake/pack_jw.py';
          try {
            const packArgs = [packScript, task.outputPath, '-n', task.appName || 'App'];
            if (task.iconPath && fs.existsSync(task.iconPath)) {
              packArgs.push('-i', task.iconPath);
            }
            packArgs.push('-o', task.outputPath);
            
            execFileSync(python, packArgs, {
              cwd: '/var/www/cs/extend/jiake',
              timeout: 300000,
              env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
            });
            // pack_jw.py 输出签名文件为 xxx_signed.apk，需要替换回原文件
            const signedPath = task.outputPath.replace('.apk', '_signed.apk');
            if (fs.existsSync(signedPath)) {
              fs.unlinkSync(task.outputPath);
              fs.renameSync(signedPath, task.outputPath);
            }
            logs.push(`[${timeStr()}] 加密加壳完成`);
            console.log(`[APK-Builder] Encrypt SUCCESS: ${task.outputFilename}`);
          } catch (encErr) {
            logs.push(`[${timeStr()}] 加密失败: ${encErr.message}`);
            console.log(`[APK-Builder] Encrypt FAILED: ${encErr.message}`);
            // 加密失败但普通构建成功，仍算成功（只是没加密）
          }
        }
        
        const size = fs.statSync(task.outputPath).size;
        console.log(`[APK-Builder] SUCCESS: ${task.outputFilename} (${(size/1024/1024).toFixed(1)}MB)`);
        appendBuildLog(`SUCCESS: ${task.outputFilename} (${(size/1024/1024).toFixed(1)}MB)`);
        logs.push(`[${timeStr()}] 最终文件: ${task.outputFilename} (${(size/1024/1024).toFixed(1)}MB)`);
        
        // 写入状态文件
        const status = {
          is_building: false,
          progress: 100,
          message: `构建成功: ${task.outputFilename}`,
          last_output: task.outputFilename,
          last_build_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
          logs: logs
        };
        fs.writeFileSync(STATUS_FILE, JSON.stringify(status));
        
        // 更新数据库记录
        updateBuildRecord(task.outputFilename, 'done', size);
      } else {
        console.log('[APK-Builder] FAILED:', err?.message || output.substring(0, 200));
        appendBuildLog(`FAILED: ${err?.message || output.substring(0, 500)}`);
        
        const status = {
          is_building: false,
          progress: 0,
          message: `构建失败: ${(err?.message || output).substring(0, 200)}`,
          logs: [`[${new Date().toTimeString().substring(0,8)}] 构建失败: ${(err?.message || output).substring(0, 500)}`]
        };
        fs.writeFileSync(STATUS_FILE, JSON.stringify(status));
        
        // 更新数据库记录为失败
        updateBuildRecord(task.outputFilename, 'failed', 0);
      }
    });
    
  } catch (e) {
    // ignore parse errors etc
    if (e.code !== 'ENOENT') {
      console.log('[APK-Builder] Poll error:', e.message);
      appendBuildLog(`Poll error: ${e.message}`);
      try {
        fs.writeFileSync(STATUS_FILE, JSON.stringify({
          is_building: false,
          progress: 0,
          message: `构建任务读取失败: ${e.message}`,
          logs: [`[${new Date().toTimeString().substring(0,8)}] 构建任务读取失败: ${e.message}`]
        }));
      } catch {}
    }
  }
}

function startPoller() {
  if (state.timer) return false;
  console.log('[APK-Builder] Task poller started, watching:', TASK_FILE);
  appendBuildLog(`Task poller started, watching: ${TASK_FILE}`);
  state.timer = setInterval(pollBuildTask, POLL_INTERVAL);
  state.timer.unref?.();
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
    getState: () => ({ running: Boolean(state.timer), building: state.building }),
  },
};
