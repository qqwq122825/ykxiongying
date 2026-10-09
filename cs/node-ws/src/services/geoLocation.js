'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { getPool } = require('./commandPoller');

const inFlight = new Map();
const lastAttempt = new Map();
const REQUEST_TIMEOUT_MS = 3500;
const RETRY_COOLDOWN_MS = 5 * 60 * 1000;
const ATTEMPT_STATE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPT_STATES = 5000;

function pruneAttempts(now = Date.now()) {
  if (lastAttempt.size <= MAX_ATTEMPT_STATES) return;
  for (const [key, timestamp] of lastAttempt) {
    if (!inFlight.has(key) && now - timestamp > ATTEMPT_STATE_TTL_MS) lastAttempt.delete(key);
  }
  if (lastAttempt.size <= MAX_ATTEMPT_STATES) return;
  for (const key of lastAttempt.keys()) {
    if (!inFlight.has(key)) lastAttempt.delete(key);
    if (lastAttempt.size <= MAX_ATTEMPT_STATES) break;
  }
}

function formatLocation(data) {
  const country = data.country || '';
  const countryCode = data.countryCode || '';
  const region = data.regionName || '';
  const city = data.city || '';
  if (countryCode === 'CN') return region && city ? `${region}-${city}` : (region || city || country);
  return country && city && country !== city ? `${country}-${city}` : (country || city || region);
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.get(parsed, {
      headers: { Accept: 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        if (body.length < 64 * 1024) body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
  });
}

function refreshDeviceGeo(deviceId, ip) {
  if (!deviceId || !ip) return Promise.resolve('');
  pruneAttempts();
  const key = `${deviceId}:${ip}`;
  if (inFlight.has(key)) return inFlight.get(key);
  if (Date.now() - (lastAttempt.get(key) || 0) < RETRY_COOLDOWN_MS) return Promise.resolve('');
  lastAttempt.set(key, Date.now());

  const task = (async () => {
    const base = (process.env.IP_API_URL || 'http://ip-api.com/json').replace(/\/$/, '');
    const url = `${base}/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,regionName,city&lang=zh-CN`;
    const data = await requestJson(url);
    if (data.status && data.status !== 'success') throw new Error(data.message || 'geolocation lookup failed');
    const location = formatLocation(data);
    if (!location) return '';

    const db = getPool();
    await db.query(
      'UPDATE fisher_devices SET geo_location=? WHERE device_id=? AND public_ip=?',
      [location, deviceId, ip]
    );
    lastAttempt.delete(key);
    return location;
  })().catch(error => {
    console.warn(`[Geo] ${deviceId} ${ip}: ${error.message}`);
    return '';
  }).finally(() => inFlight.delete(key));

  inFlight.set(key, task);
  return task;
}

module.exports = { refreshDeviceGeo };
