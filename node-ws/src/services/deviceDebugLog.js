'use strict';

const { getPool } = require('./commandPoller');

const ENABLE_KEY = 'onboarding_debug_enabled';
const SESSION_KEY = 'onboarding_debug_session_id';
let cached = { enabled: false, sessionId: '', expiresAt: 0 };
let schemaPromise = null;

function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = getPool().query(`CREATE TABLE IF NOT EXISTS fisher_debug_events (
      id bigint unsigned NOT NULL AUTO_INCREMENT,
      session_id varchar(64) NOT NULL DEFAULT '',
      source varchar(32) NOT NULL DEFAULT '',
      stage varchar(96) NOT NULL DEFAULT '',
      level varchar(16) NOT NULL DEFAULT 'info',
      device_id varchar(128) NOT NULL DEFAULT '',
      event_time bigint unsigned NOT NULL DEFAULT 0,
      details_json longtext,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_session_id (session_id,id),
      KEY idx_device_id (device_id,id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch(err => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

async function debugState() {
  const now = Date.now();
  if (cached.expiresAt > now) return cached;
  const [rows] = await getPool().query(
    'SELECT `key`,`value` FROM fisher_settings WHERE `key` IN (?,?)',
    [ENABLE_KEY, SESSION_KEY]
  );
  const values = Object.fromEntries((rows || []).map(row => [row.key, String(row.value ?? '')]));
  cached = {
    enabled: values[ENABLE_KEY] === '1',
    sessionId: values[SESSION_KEY] || '',
    expiresAt: now + 750,
  };
  return cached;
}

function scrub(value, depth = 0) {
  if (depth > 5) return '[depth-limited]';
  if (Array.isArray(value)) return value.slice(0, 100).map(item => scrub(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = /password|passwd|pwd|token|secret|cookie|authorization|html/i.test(key)
        ? '[redacted]'
        : scrub(item, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 1000) return value.slice(0, 1000) + '…';
  return value;
}

async function recordDeviceDebug(stage, deviceId, details = {}, level = 'info') {
  const eventTime = Date.now();
  try {
    const state = await debugState();
    if (!state.enabled) return;
    await ensureSchema();
    await getPool().query(
      `INSERT INTO fisher_debug_events
       (session_id,source,stage,level,device_id,event_time,details_json,created_at)
       VALUES (?,'node-ws',?,?,?,?,?,NOW())`,
      [state.sessionId, String(stage).slice(0, 96), String(level).slice(0, 16), String(deviceId || '').slice(0, 128), eventTime, JSON.stringify(scrub(details))]
    );
  } catch (err) {
    console.warn('[OnboardingDebug] record failed: ' + err.message);
  }
}

module.exports = { recordDeviceDebug };
