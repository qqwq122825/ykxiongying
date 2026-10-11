// device-upstream.js —— 每设备一个上游连接单例（连接池 + 帧缓冲 + 扇出）
// 2026-08-05：根据 Claude 5.0 方案实施
'use strict';
const http = require('http');

const CRLF = Buffer.from('\r\n');
const FRAME_HEADER_TAIL = CRLF; // multipart part 末尾（boundary 之前）
const MAX_FRAME_BYTES = 1024 * 1024; // 单帧 1MB 上限（异常帧保护）

class DeviceUpstream {
  constructor({ deviceId, resolveUpstream, maxFrames = 8,
                stallTimeoutMs = 3000, reconnectBaseMs = 1000, reconnectMaxMs = 30000 }) {
    this.deviceId = deviceId;
    this.resolveUpstream = resolveUpstream;
    this.maxFrames = maxFrames;
    this.stallTimeoutMs = stallTimeoutMs;
    this.reconnectBaseMs = reconnectBaseMs;
    this.reconnectMaxMs = reconnectMaxMs;

    this.state = 'idle';  // idle | connecting | streaming | reconnecting
    this.frames = [];     // [{seq, buf: Buffer}]
    this.frameBytes = 0;
    this.subscribers = new Set();
    this.lastByteAt = 0;
    this.seq = 0;
    this.attempt = 0;
    this.lastError = null;

    this._req = null;
    this._buf = Buffer.alloc(0);
    this._phase = 'headers';  // headers -> data -> boundary -> headers
    this._remaining = 0;
    this._watchdog = null;
    this._retryTimer = null;
    this._idleTimer = null;
  }

  hasSubscribers() { return this.subscribers.size > 0; }
  bufferedBytes()  { return this.frameBytes; }

  // 订阅：先回放缓冲帧，再保证上游连接
  subscribe(consumer) {
    this.subscribers.add(consumer);
    // 回放缓冲帧（让新订阅者立即看到最后一帧）
    for (const f of this.frames) this._writeTo(consumer, f.buf);
    if (this.state === 'idle') this._connect();
    else if (this.state === 'reconnecting') this._retryNow();  // 有人看，跳过退避立即重连
    return this;
  }

  unsubscribe(consumer) {
    this.subscribers.delete(consumer);
  }

  _connect() {
    if (this.state === 'connecting' || this.state === 'streaming') return;
    this.state = 'connecting';
    this.attempt++;
    Promise.resolve()
      .then(() => this.resolveUpstream(this.deviceId))
      .then((upstream) => {
        const [host, port] = String(upstream).split(':');
        const req = http.request({
          host, port: Number(port), path: '/minicap/stream', method: 'GET',
          headers: { Connection: 'keep-alive', Accept: '*/*' },
          timeout: 10000,
        });
        this._req = req;
        req.setTimeout(10000, () => req.destroy(new Error('upstream connect timeout')));
        req.on('response', (res) => {
          if (res.statusCode !== 200) {
            return this._fail(`upstream HTTP ${res.statusCode}`);
          }
          this.state = 'streaming';
          this.attempt = 0;
          this.lastByteAt = Date.now();
          this._buf = Buffer.alloc(0);
          this._phase = 'headers';
          this._startWatchdog();
          res.on('data', (c) => { this.lastByteAt = Date.now(); this._push(c); });
          res.on('end',   () => this._fail('upstream end'));
          res.on('error', (e) => this._fail(e.message));
          res.on('close', () => { if (this.state === 'streaming') this._fail('upstream close'); });
        });
        req.on('error', (e) => this._fail(e.message));
        req.end();
      })
      .catch((e) => this._fail(e.message));
  }

  _fail(reason) {
    if (this.state === 'dead') return;
    this.lastError = reason;
    this._teardown();
    if (!this.hasSubscribers()) {
      // 没人看则彻底 idle，避免无谓重连
      this.state = 'idle';
      return;
    }
    this.state = 'reconnecting';
    const delay = Math.min(
      this.reconnectMaxMs,
      this.reconnectBaseMs * 2 ** Math.min(this.attempt - 1, 6)
    ) * (0.8 + Math.random() * 0.4);
    this._retryTimer = setTimeout(() => { this._retryTimer = null; this._connect(); }, delay);
  }

  _retryNow() {
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    if (this.state === 'reconnecting' || this.state === 'idle') this._connect();
  }

  _startWatchdog() {
    if (this._watchdog) clearInterval(this._watchdog);
    this._watchdog = setInterval(() => {
      // 流式状态长时间无字节 = 隧道静默死（TCP 可能还活着），主动 destroy 触发重连
      if (this.state === 'streaming' && Date.now() - this.lastByteAt > this.stallTimeoutMs) {
        this._fail(`stall: no bytes for ${this.stallTimeoutMs}ms`);
      }
    }, Math.min(this.stallTimeoutMs, 1000));
  }

  _teardown() {
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    if (this._watchdog)   { clearInterval(this._watchdog);   this._watchdog = null; }
    if (this._req)        { try { this._req.destroy(); } catch {} this._req = null; }
  }

  close() {
    this.state = 'dead';
    this._teardown();
    this.frames = [];
    this.frameBytes = 0;
  }

  // ---- 帧解析（长度驱动，防 JPEG 内含 --frame 字节串误切） ----
  _push(chunk) {
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    this._drain();
  }

  _drain() {
    while (true) {
      if (this._phase === 'headers') {
        const end = this._buf.indexOf(CRLF); // 找第一个 \r\n
        if (end === -1) return this._trimIfHuge();
        // 找 Content-Length（可能在实际帧之后的下一个分块里搜索）
        const limit = Math.min(this._buf.length, end + 4096);
        const head = this._buf.subarray(0, limit).toString('latin1');
        const m = /Content-Length:\s*(\d+)/i.exec(head);
        if (!m) {
          // 异常头，跳过这一行
          this._buf = this._buf.subarray(end + 2);
          continue;
        }
        const headerEnd = this._buf.indexOf(Buffer.from('\r\n\r\n'));
        if (headerEnd === -1) return this._trimIfHuge();
        this._remaining = Number(m[1]);
        this._buf = this._buf.subarray(headerEnd + 4);
        this._phase = 'data';
      }
      if (this._phase === 'data') {
        if (this._buf.length < this._remaining) return this._trimIfHuge();
        const frame = Buffer.from(this._buf.subarray(0, this._remaining));
        this._buf = this._buf.subarray(this._remaining);
        this._phase = 'boundary';
        this._emitFrame(frame);
      }
      if (this._phase === 'boundary') {
        // 找下一个 --frame\r\n
        const i = this._buf.indexOf('--frame');
        if (i === -1) return this._trimIfHuge();
        this._buf = this._buf.subarray(i + 7);
        this._phase = 'headers';
      }
    }
  }

  _trimIfHuge() {
    // 异常流保护：无进展且缓冲超 8MB 丢弃
    if (this._buf.length > 8 * 1024 * 1024) this._buf = Buffer.alloc(0);
  }

  _emitFrame(frame) {
    this.seq++;
    // 环形缓冲
    this.frames.push({ seq: this.seq, buf: frame });
    this.frameBytes += frame.length;
    while (this.frames.length > this.maxFrames) {
      const old = this.frames.shift();
      this.frameBytes -= old.buf.length;
    }
    // 扇出：慢订阅者丢帧
    for (const c of this.subscribers) this._writeTo(c, frame);
  }

  _writeTo(consumer, frame) {
    if (consumer._skipFrames) return; // 慢订阅者跳过
    const header = Buffer.from(
      `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
    const ok = consumer.write(Buffer.concat([header, frame, FRAME_HEADER_TAIL]));
    if (!ok) {
      consumer._skipFrames = true;
      consumer.once('drain', () => { consumer._skipFrames = false; });
    }
  }
}

module.exports = DeviceUpstream;