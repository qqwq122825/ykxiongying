'use strict';

function normalizeRole(role) {
  return String(role || 'user').trim().toLowerCase().replace(/_/g, '-');
}

function isSuperAdmin(user) {
  return ['superadmin', 'super-admin'].includes(normalizeRole(user?.role));
}

function isEnabled(value) {
  return !(value === 0 || value === '0' || value === false);
}

function isExpired(expireAt) {
  const value = Number(expireAt || 0);
  return value > 0 && value < Math.floor(Date.now() / 1000);
}

async function loadCurrentActor(db, tokenUser) {
  const userId = Number(tokenUser?.user_id || tokenUser?.id || 0);
  if (!userId) return null;

  const [rows] = await db.query(
    'SELECT * FROM fisher_users WHERE id = ? LIMIT 1',
    [userId]
  );
  const row = rows?.[0];
  if (!row || !isEnabled(row.enabled) || isExpired(row.expire_at)) return null;

  const allowMultiLogin = Object.prototype.hasOwnProperty.call(row, 'allow_multi_login')
    && isEnabled(row.allow_multi_login);
  if (!allowMultiLogin) {
    const sid = String(tokenUser?.sid || '');
    if (!sid) return null;
    const [sessionRows] = await db.query(
      'SELECT value FROM fisher_settings WHERE `key` = ? LIMIT 1',
      [`auth_session_${userId}`]
    );
    if (!sessionRows?.[0]?.value || String(sessionRows[0].value) !== sid) return null;
  }

  return {
    ...tokenUser,
    user_id: row.id,
    username: String(row.username || ''),
    role: normalizeRole(row.role),
    enabled: row.enabled,
    expire_at: row.expire_at,
    allow_multi_login: allowMultiLogin,
  };
}

/**
 * null: superadmin may access every owner.
 * array: exact owner_username values visible to this actor.
 */
async function managedUsernames(db, user) {
  if (isSuperAdmin(user)) return null;

  const username = String(user?.username || '').trim();
  if (!username) return [];
  if (normalizeRole(user?.role) !== 'admin') return [username];

  const [rows] = await db.query(
    'SELECT username FROM fisher_users WHERE parent_username = ? AND enabled = 1',
    [username]
  );
  const children = (rows || []).map(row => String(row.username || '').trim()).filter(Boolean);
  return [...new Set([username, ...children])];
}

async function canAccessDevice(db, user, deviceId) {
  const id = String(deviceId || '').trim();
  if (!id) return false;
  if (isSuperAdmin(user)) return true;

  const scope = await managedUsernames(db, user);
  if (!scope?.length) return false;
  const placeholders = scope.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT device_id FROM fisher_devices WHERE device_id = ? AND owner_username IN (${placeholders}) LIMIT 1`,
    [id, ...scope]
  );
  return !!rows?.[0];
}

async function listAuthorizedDevices(db, user) {
  const scope = await managedUsernames(db, user);
  if (scope === null) {
    const [rows] = await db.query('SELECT * FROM fisher_devices ORDER BY last_seen DESC');
    return { rows: rows || [], scope: null };
  }
  if (!scope.length) return { rows: [], scope };

  const placeholders = scope.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT * FROM fisher_devices WHERE owner_username IN (${placeholders}) ORDER BY last_seen DESC`,
    scope
  );
  return { rows: rows || [], scope };
}

module.exports = {
  normalizeRole,
  isSuperAdmin,
  loadCurrentActor,
  managedUsernames,
  canAccessDevice,
  listAuthorizedDevices,
};
