'use strict';

function deletedDeviceKey(deviceId) {
  return `device_deleted:${deviceId}`;
}

async function isDeviceDeleted(db, deviceId) {
  if (!db || !deviceId) return false;
  const key = deletedDeviceKey(deviceId);
  try {
    const [rows] = await db.query('SELECT `value` FROM fisher_settings WHERE `key` = ? LIMIT 1', [key]);
    if (!rows || rows.length === 0) return false;
    let payload = {};
    try { payload = JSON.parse(rows[0].value || '{}'); } catch (_) {}
    const expiresAt = Number(payload.expires_at || 0);
    if (expiresAt > 0 && expiresAt < Math.floor(Date.now() / 1000)) {
      await db.query('DELETE FROM fisher_settings WHERE `key` = ?', [key]);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[DeletedDevice] tombstone check failed for ${String(deviceId).substring(0, 12)}...: ${e.message}`);
    return false;
  }
}

module.exports = { deletedDeviceKey, isDeviceDeleted };
