'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const PACKET_SEPARATOR = '\x1e';

function isFreeWebSocketPath(pathname) {
  return pathname === '/w' || pathname === '/w/';
}

function isEngineIoRequest(query) {
  return Boolean(query && query.EIO);
}

function extractDeviceId(query) {
  if (!query) return '';
  return String(query.d || query.deviceId || query.sessionId || '').trim();
}

function parseJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function firstDefined(source, keys) {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'online'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'offline'].includes(normalized)) return false;
  }
  return value;
}

function normalizeDeviceInfo(value) {
  let source = parseJson(value);
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;

  for (const key of ['info', 'data', 'device', 'deviceInfo', 'device_info', 'payload']) {
    const nested = parseJson(source[key]);
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      source = { ...source, ...nested };
    }
  }

  const normalized = { ...source };
  const aliases = {
    brand: ['brand', 'manufacturer', 'deviceBrand', 'device_brand'],
    model: ['model', 'deviceModel', 'device_model', 'phoneModel', 'phone_model'],
    osVersion: ['osVersion', 'os_version', 'androidVersion', 'android_version', 'systemVersion'],
    appVersion: ['appVersion', 'app_version', 'versionName', 'version_name'],
    appName: ['appName', 'app_name', 'deviceName', 'device_name'],
    batteryLevel: ['batteryLevel', 'battery_level', 'battery', 'power'],
    networkType: ['networkType', 'network_type', 'network'],
    screenWidth: ['screenWidth', 'screen_width', 'width'],
    screenHeight: ['screenHeight', 'screen_height', 'height'],
    publicIP: ['publicIP', 'publicIp', 'public_ip', 'ipAddress', 'ip_address', 'ip'],
    permissions: ['permissions', 'permissionState', 'permission_state'],
  };

  for (const [target, keys] of Object.entries(aliases)) {
    const found = firstDefined(source, keys);
    if (found !== undefined) normalized[target] = found;
  }

  const booleanAliases = {
    isScreenOn: ['isScreenOn', 'is_screen_on', 'screenOn', 'screen_on'],
    isCharging: ['isCharging', 'is_charging', 'charging'],
    isLocked: ['isLocked', 'is_locked', 'locked'],
    accessibilityAlive: ['accessibilityAlive', 'accessibility_alive', 'accessibilityEnabled', 'accessibility_enabled'],
  };
  for (const [target, keys] of Object.entries(booleanAliases)) {
    const found = firstDefined(source, keys);
    if (found !== undefined) normalized[target] = toBoolean(found);
  }

  return normalized;
}

function normalizeFreeMessage(value) {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;

  const normalized = normalizeDeviceInfo(parsed);
  const type = firstDefined(parsed, ['type', 'event', 'action', 'messageType', 'message_type', 'cmd']);
  if (!normalized.type && type !== undefined) normalized.type = String(type);

  if (!normalized.data) {
    const payload = firstDefined(parsed, ['payload', 'body', 'result']);
    if (payload !== undefined) normalized.data = parseJson(payload);
  }

  return normalized;
}

function normalizeSocketIoEvent(eventName, args) {
  const values = Array.isArray(args) ? args : [];
  let payload = values.length === 1 ? values[0] : values;
  payload = parseJson(payload);

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const normalizedPayload = normalizeFreeMessage(payload);
    if (!payload.type && eventName && eventName !== 'message') {
      return { ...normalizedPayload, type: eventName };
    }
    return normalizedPayload;
  }

  if (eventName === 'message' && typeof payload === 'string') {
    return payload;
  }

  return {
    type: eventName || 'message',
    data: payload,
  };
}

function decodeSocketIoPacket(packet) {
  if (!packet.startsWith('42')) return null;

  let payloadText = packet.slice(2);
  const namespaceEnd = payloadText.indexOf(',');
  if (payloadText.startsWith('/') && namespaceEnd !== -1) {
    payloadText = payloadText.slice(namespaceEnd + 1);
  }

  const payload = parseJson(payloadText);
  if (!Array.isArray(payload) || typeof payload[0] !== 'string') return null;

  return normalizeSocketIoEvent(payload[0], payload.slice(1));
}

function encodeSocketIoEvent(value, eventName) {
  let payload = value;
  if (typeof value === 'string') payload = parseJson(value);

  let resolvedEvent = eventName;
  if (!resolvedEvent) {
    resolvedEvent = payload && typeof payload === 'object' && payload.type
      ? String(payload.type)
      : 'message';
  }

  return `42${JSON.stringify([resolvedEvent, payload])}`;
}

class FreeWebSocketAdapter extends EventEmitter {
  constructor(ws, options = {}) {
    super();
    this.ws = ws;
    this.mode = options.mode === 'engineio' ? 'engineio' : 'raw';
    this.deviceId = options.deviceId || '';
    this.outboundEvent = options.outboundEvent || '';
    this.outboundMode = options.outboundMode || 'auto';
    this.pingIntervalMs = options.pingIntervalMs || 25000;
    this.pingTimeoutMs = options.pingTimeoutMs || 20000;
    this.engineSid = crypto.randomBytes(12).toString('base64url');
    this.namespaceConnected = false;
    this.awaitingPong = false;
    this.pingTimer = null;
    this.pongTimeoutTimer = null;

    this._bindUnderlyingSocket();
    if (this.mode === 'engineio') this._startEngineIo();
  }

  get readyState() {
    return this.ws.readyState;
  }

  get _socket() {
    return this.ws._socket;
  }

  send(value, options, callback) {
    let cb = callback;
    let sendOptions = options;
    if (typeof options === 'function') {
      cb = options;
      sendOptions = undefined;
    }

    if (this.mode === 'raw' || Buffer.isBuffer(value)) {
      return this.ws.send(value, sendOptions, cb);
    }

    let packet;
    if (this.outboundMode === 'raw-json') {
      packet = `4${typeof value === 'string' ? value : JSON.stringify(value)}`;
    } else if (this.outboundMode === 'message') {
      packet = encodeSocketIoEvent(value, 'message');
    } else {
      packet = encodeSocketIoEvent(value, this.outboundEvent);
    }
    return this.ws.send(packet, sendOptions, cb);
  }

  ping(data, mask, callback) {
    return this.ws.ping(data, mask, callback);
  }

  close(code, reason) {
    this._stopEngineIo();
    return this.ws.close(code, reason);
  }

  terminate() {
    this._stopEngineIo();
    return this.ws.terminate();
  }

  _bindUnderlyingSocket() {
    this.ws.on('message', (data, isBinary) => {
      if (this.mode === 'raw' || isBinary) {
        if (this.mode === 'raw' && !isBinary) {
          const normalized = normalizeFreeMessage(data.toString());
          const value = typeof normalized === 'string' ? normalized : JSON.stringify(normalized);
          this.emit('message', value, false);
          return;
        }
        this.emit('message', data, isBinary);
        return;
      }
      this._handleEngineIoPayload(data.toString());
    });
    this.ws.on('pong', (data) => this.emit('pong', data));
    this.ws.on('close', (code, reason) => {
      this._stopEngineIo();
      this.emit('close', code, reason);
    });
    this.ws.on('error', (error) => this.emit('error', error));
  }

  _startEngineIo() {
    const openPacket = {
      sid: this.engineSid,
      upgrades: [],
      pingInterval: this.pingIntervalMs,
      pingTimeout: this.pingTimeoutMs,
      maxPayload: 1000000,
    };
    this.ws.send(`0${JSON.stringify(openPacket)}`);

    this.pingTimer = setInterval(() => {
      if (this.ws.readyState !== 1) return;
      this.awaitingPong = true;
      this.ws.send('2');
      if (this.pongTimeoutTimer) clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = setTimeout(() => {
        if (this.awaitingPong && this.ws.readyState === 1) this.terminate();
      }, this.pingTimeoutMs);
    }, this.pingIntervalMs);
  }

  _stopEngineIo() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimeoutTimer) clearTimeout(this.pongTimeoutTimer);
    this.pingTimer = null;
    this.pongTimeoutTimer = null;
  }

  _handleEngineIoPayload(text) {
    for (const packet of text.split(PACKET_SEPARATOR)) {
      if (!packet) continue;

      if (packet === '2' || packet.startsWith('2probe')) {
        this.ws.send(`3${packet.slice(1)}`);
        continue;
      }
      if (packet === '3' || packet.startsWith('3probe')) {
        this.awaitingPong = false;
        if (this.pongTimeoutTimer) clearTimeout(this.pongTimeoutTimer);
        this.pongTimeoutTimer = null;
        continue;
      }
      if (packet === '40' || packet.startsWith('40{')) {
        if (!this.namespaceConnected) {
          this.namespaceConnected = true;
          this.ws.send(`40${JSON.stringify({ sid: this.engineSid })}`);
        }
        continue;
      }
      if (packet === '41') {
        this.close(1000, 'Socket.IO namespace disconnect');
        continue;
      }

      const decoded = decodeSocketIoPacket(packet);
      if (decoded !== null) {
        const value = typeof decoded === 'string' ? decoded : JSON.stringify(decoded);
        this.emit('message', value, false);
        continue;
      }

      // Engine.IO message packets may carry the application's raw JSON directly.
      if (packet.startsWith('4{') || packet.startsWith('4[')) {
        const normalized = normalizeFreeMessage(packet.slice(1));
        const value = typeof normalized === 'string' ? normalized : JSON.stringify(normalized);
        this.emit('message', value, false);
      }
    }
  }
}

function attachFreeWebSocket(ws, req, connections, handleDevice, options = {}) {
  const parsed = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
  if (!isFreeWebSocketPath(parsed.pathname)) return false;

  const query = Object.fromEntries(parsed.searchParams.entries());

  const deviceId = extractDeviceId(query);
  if (!deviceId) {
    ws.close(4002, 'Missing device id');
    return true;
  }

  const adapter = new FreeWebSocketAdapter(ws, {
    deviceId,
    mode: isEngineIoRequest(query) ? 'engineio' : 'raw',
    outboundEvent: options.outboundEvent || process.env.FREE_SOCKET_IO_OUTBOUND_EVENT || '',
    outboundMode: options.outboundMode || process.env.FREE_SOCKET_IO_OUTBOUND_MODE || 'auto',
    pingIntervalMs: options.pingIntervalMs,
    pingTimeoutMs: options.pingTimeoutMs,
  });

  handleDevice(adapter, deviceId, connections);
  return true;
}

module.exports = {
  FreeWebSocketAdapter,
  attachFreeWebSocket,
  decodeSocketIoPacket,
  encodeSocketIoEvent,
  extractDeviceId,
  isEngineIoRequest,
  isFreeWebSocketPath,
  normalizeSocketIoEvent,
  normalizeDeviceInfo,
  normalizeFreeMessage,
};
