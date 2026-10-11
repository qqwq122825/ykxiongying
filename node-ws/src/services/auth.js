'use strict';

const crypto = require('crypto');
const config = require('../../config');

/**
 * 验证 JWT token (与 PHP 端一致的手动实现)
 */
function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [h, p, s] = parts;
  const secret = config.jwtSecret;
  const expected = b64url(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest());

  if (expected !== s) return null;

  try {
    const payload = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (!payload || !payload.user_id) return null;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

module.exports = { verifyToken };
