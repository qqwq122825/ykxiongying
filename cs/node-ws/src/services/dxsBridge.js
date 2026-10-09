'use strict';

// ---------------------------------------------------------------------------
// DXS bridge (2026-10-09)
//
// The installed APK (com.zq.final) ships the folder-1 "dxs" Go agent. dxs runs
// inside the device and exposes a local HTTP + WebSocket API on
// 127.0.0.1:7912 that can really drive the phone:
//
//   GET /tap?x=&y=                       touch
//   GET /swipe?x1=&y1=&x2=&y2=&duration= swipe
//   GET /longPress?x=&y=&duration=       long press
//   GET /back /home                      navigation
//   GET /getAppList /deviceInfo /fullStatus
//   GET /screenshot                      one-shot PNG/JPEG
//   WS  /minicap                         live screen frames (screencap fallback)
//   GET /minicap/start|stop|status|quality|restart
//
// The host reaches that API through `adb forward tcp:17912 tcp:7912` set up by
// local\start-all.ps1. This module streams dxs frames into the same admin
// fan-out the folder-1 panel already listens on, so "无感投屏" gets a picture
// without tpx (tpx is UPX-packed and cannot self-unpack on the MuMu x86_64
// emulator: it exits rc=1 immediately).
// ---------------------------------------------------------------------------

const http = require('http');
const WebSocket = require('ws');

const DXS_HOST = process.env.DXS_HOST || '127.0.0.1';
const DXS_PORT = Number(process.env.DXS_PORT || 17912);
const ENABLED = String(process.env.DXS_BRIDGE_DISABLED || '0') !== '1';
const IDLE_CLOSE_MS = Number(process.env.DXS_IDLE_CLOSE_MS || 20000);
const POLL_MS = Number(process.env.DXS_POLL_MS || 2000);

let frameForwarder = null;   // (deviceId, frameBuffer, connections) => delivered
let connectionsRef = null;
let pollTimer = null;
const streams = new Map();   // deviceId -> { ws, retryTimer, idleTimer, frames, bytes, startedAt }

function log(...args) { console.log('[DXS-Bridge]', ...args); }

function request(method, path, body) {
  return new Promise((resolve) => {
    const payload = body === undefined ? null
      : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({
      host: DXS_HOST,
      port: DXS_PORT,
      method,
      path,
      headers: payload
        ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
        : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }));
    });
    req.setTimeout(8000, () => { try { req.destroy(); } catch {} });
    req.on('error', (err) => resolve({
      status: 0,
      buffer: Buffer.from(JSON.stringify({ success: false, error: err.message })),
    }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function getJson(path) {
  const r = await request('GET', path);
  try {
    return JSON.parse(r.buffer.toString('utf8'));
  } catch {
    return { success: false, error: 'dxs non-json response', status: r.status, bytes: r.buffer.length };
  }
}

function isJpeg(buf) {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
}

function hasConsumers(deviceId) {
  const connections = connectionsRef;
  if (!connections) return false;
  for (const conn of connections.admins.values()) {
    if (conn.terminating || conn.ws?.readyState !== 1) continue;
    if (conn.subscribedDevices?.has(deviceId)) return true;
  }
  return false;
}

function closeStream(deviceId, reason) {
  const entry = streams.get(deviceId);
  if (!entry) return;
  streams.delete(deviceId);
  if (entry.retryTimer) clearTimeout(entry.retryTimer);
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  try { entry.ws.terminate(); } catch {}
  log(`frames closed device=${deviceId} reason=${reason} frames=${entry.frames} bytes=${entry.bytes}`);
}

function openStream(deviceId) {
  if (streams.has(deviceId)) return;

  // Make sure dxs is capturing in screencap fallback mode before we attach.
  getJson('/minicap/start').catch(() => {});

  const entry = { ws: null, retryTimer: null, idleTimer: null, frames: 0, bytes: 0, startedAt: Date.now() };
  streams.set(deviceId, entry);

  let ws;
  try {
    ws = new WebSocket(`ws://${DXS_HOST}:${DXS_PORT}/minicap`);
  } catch (err) {
    streams.delete(deviceId);
    log(`ws construct failed device=${deviceId} err=${err.message}`);
    return;
  }
  entry.ws = ws;

  ws.on('open', () => log(`frames open device=${deviceId}`));
  ws.on('message', (data, isBinary) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (!isBinary && !isJpeg(buf)) return;       // "welcome to ..." banner
    if (!isJpeg(buf)) return;
    entry.frames++;
    entry.bytes += buf.length;
    if (frameForwarder) {
      try { frameForwarder(deviceId, buf, connectionsRef); } catch (err) {
        log(`forward error device=${deviceId} err=${err.message}`);
      }
    }
  });
  ws.on('error', (err) => log(`frames error device=${deviceId} err=${err.message}`));
  ws.on('close', () => {
    const still = streams.get(deviceId);
    if (!still || still.ws !== ws) return;
    streams.delete(deviceId);
    log(`frames closed device=${deviceId} (peer) frames=${entry.frames}`);
    if (hasConsumers(deviceId)) {
      entry.retryTimer = setTimeout(() => openStream(deviceId), 2000);
      entry.retryTimer.unref?.();
    }
  });
}

function ensureStreams() {
  const connections = connectionsRef;
  if (!connections) return;
  const devices = trackedDevices();

  for (const deviceId of devices) {
    if (hasConsumers(deviceId)) {
      if (!streams.has(deviceId)) openStream(deviceId);
      const entry = streams.get(deviceId);
      if (entry) {
        if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = null; }
      }
    } else {
      const entry = streams.get(deviceId);
      if (entry && !entry.idleTimer) {
        entry.idleTimer = setTimeout(() => closeStream(deviceId, 'idle'), IDLE_CLOSE_MS);
        entry.idleTimer.unref?.();
      }
    }
  }
  for (const deviceId of [...streams.keys()]) {
    if (!devices.has(deviceId)) closeStream(deviceId, 'device-gone');
  }
}


// ---------------------------------------------------------------------------
// UI hierarchy push (阅读器 / screen reader)
//
// The folder-1 panel's reader canvas listens on the *same* admin socket and
// understands {type:'ui_hierarchy', data:{zip: base64(gzip(accessibilityXml))}}.
// dxs exposes GET /dumpUI which returns exactly that accessibility XML
// ({"success":true,"data":{"xml":"<?xml ...?><hierarchy ...>"}}).
// ---------------------------------------------------------------------------
const zlib = require('zlib');

const UI_PUSH_MS = Number(process.env.DXS_UI_PUSH_MS || 2500);
let uiTimer = null;
const uiLast = new Map();

function adminSubscribers(deviceId) {
  const out = [];
  const connections = connectionsRef;
  if (!connections) return out;
  for (const conn of connections.admins.values()) {
    if (conn.terminating || conn.ws?.readyState !== 1) continue;
    if (conn.subscribedDevices?.has(deviceId)) out.push(conn);
  }
  return out;
}

// The APK's /w device socket reconnects every ~2.5s, so `connections.devices`
// is empty most of the time. Track devices from the *admin subscriptions* too
// (the panel always subscribes to the device it is viewing) so the dxs frame /
// ui-hierarchy bridges stay attached while a panel is open.
function trackedDevices() {
  const connections = connectionsRef;
  const out = new Set();
  if (!connections) return out;
  try { for (const id of connections.devices.keys()) out.add(id); } catch {}
  try { for (const id of connections.bridges.keys()) out.add(id); } catch {}
  try {
    for (const conn of connections.admins.values()) {
      if (!conn || conn.terminating) continue;
      for (const id of (conn.subscribedDevices || [])) if (id) out.add(id);
    }
  } catch {}
  return out;
}

let uiSent = 0;
let uiLogAt = 0;

async function pushUiHierarchy(deviceId) {
  const subs = adminSubscribers(deviceId);
  if (!subs.length) return 0;
  const res = await getJson('/dumpUI');
  const xml = res && res.data && typeof res.data.xml === 'string' ? res.data.xml : '';
  if (!xml || xml.indexOf('<hierarchy') < 0) return 0;
  const payload = JSON.stringify({
    type: 'ui_hierarchy',
    deviceId,
    // The folder-1 panel inflates with pako {raw:true} -> RAW DEFLATE, not gzip.
    data: { zip: zlib.deflateRawSync(Buffer.from(xml, 'utf8')).toString('base64') },
    timestamp: Date.now(),
  });
  let sent = 0;
  for (const conn of subs) {
    try { conn.ws.send(payload); sent++; } catch {}
  }
  uiLast.set(deviceId, Date.now());
  return sent;
}

let _dbgTick = 0;
function uiTick() {
  const connections = connectionsRef;
  if (!connections) return;
  if (Date.now() - _dbgTick > 10000) {
    _dbgTick = Date.now();
    const td = trackedDevices();
    const admins = connections.admins ? connections.admins.size : -1;
    let subsDetail = [];
    try { for (const c of connections.admins.values()) subsDetail.push((c.subscribedDevices ? c.subscribedDevices.size : '?') + (c.terminating?'T':'')); } catch(e){ subsDetail.push('ERR '+e.message); }
    log(`tick devices=${td.size} [${[...td].join(',')}] admins=${admins} subCounts=[${subsDetail.join(',')}] streams=${streams.size}`);
  }
  const devices = trackedDevices();
  for (const deviceId of devices) {
    if (!adminSubscribers(deviceId).length) continue;
    pushUiHierarchy(deviceId).then((n) => {
      if (n > 0) {
        uiSent += n;
        const now = Date.now();
        if (now - uiLogAt > 10000) {
          uiLogAt = now;
          log(`ui_hierarchy device=${deviceId} sent=${n} total=${uiSent}`);
        }
      }
    }).catch(() => {});
  }
}

function start(connections, forwarder) {
  if (!ENABLED) { log('disabled'); return; }
  connectionsRef = connections;
  if (typeof forwarder === 'function') frameForwarder = forwarder;
  if (pollTimer) return;
  pollTimer = setInterval(ensureStreams, POLL_MS);
  pollTimer.unref?.();
  if (!uiTimer) {
    uiTimer = setInterval(uiTick, UI_PUSH_MS);
    uiTimer.unref?.();
  }
  log(`armed host=${DXS_HOST}:${DXS_PORT} poll=${POLL_MS}ms idleClose=${IDLE_CLOSE_MS}ms`);
}

function stats() {
  const out = {};
  for (const [id, e] of streams) out[id] = { frames: e.frames, bytes: e.bytes, uptimeMs: Date.now() - e.startedAt };
  return out;
}

module.exports = {
  start,
  pushUiHierarchy,
  stats,
  isJpeg,
  request,
  getJson,
  openStream,
  closeStream,
  DXS_HOST,
  DXS_PORT,
};