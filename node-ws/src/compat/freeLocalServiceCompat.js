'use strict';

// Endpoints present in the Free APK's bundled liblocal-service.so/libdxs.so.
// These actions use the reverse-tunnel HTTP channel after FULL_DEPLOY/DEPLOY_DXS.
const FREE_LOCAL_SERVICE_ENDPOINTS = new Set([
  'tap', 'swipe', 'keyevent', 'back', 'home', 'recents',
  // Frontend spelling; TunnelController maps this to the original /input endpoint.
  'inputText',
  'wakeUpScreen', 'lockScreen', 'keepScreenOnTimer', 'setBrightness',
  'mute', 'volumeUp', 'volumeDown', 'enterCipher',
  'enableAccessibility', 'disableAccessibility', 'accessibilityState',
  'resumeAccessibility', 'pauseAccessibility',
  'isDeviceOwner', 'deviceAdmin', 'setActiveAdmin', 'removeActiveAdmin',
  'setDeviceOwner', 'clearDeviceOwner', 'removeAllAccounts', 'listAccounts',
  'getNotifications', 'getAppList', 'getAppInfo', 'installApp', 'uninstall',
  'disableApp', 'enableApp', 'clearAppCache', 'clearAppData',
  'forceStopApp', 'factoryReset',
  'screenState', 'getConfig',
  'windowListener/start', 'windowListener/stop', 'windowListener/status',
  'windowListener/getRules', 'windowListener/addRule', 'windowListener/updateRule',
  'windowListener/removeRule', 'windowListener/enableRule',
  'windowListener/disableRule', 'windowListener/saveRules',
  'windowListener/loadRules', 'windowListener/clearRules',
  'windowListener/testRule',
]);

const FREE_LOCAL_SERVICE_HTTP_ENDPOINTS = new Set([
  'execShell', 'screenshot', 'minicap/stream', 'blackScreen',
]);

const FREE_LOCAL_SERVICE_ACTION_ALIASES = Object.freeze({
  inputText: 'input',
  uninstall: 'uninstallApp',
  isActiveDeviceOwner: 'isDeviceOwner',
});

const FREE_LOCAL_SERVICE_QUERY_FIELDS = Object.freeze({
  tap: ['x', 'y'],
  swipe: ['x1', 'y1', 'x2', 'y2', 'duration'],
  keyevent: ['keycode'],
  input: ['text'],
  keepScreenOnTimer: ['duration'],
  setBrightness: ['value', 'brightness'],
  enterCipher: ['cipher', 'type'],
  getAppInfo: ['package', 'packageName'],
  installApp: ['path', 'url'],
  uninstallApp: ['package', 'packageName'],
  forceStopApp: ['package', 'packageName'],
  disableApp: ['package', 'packageName'],
  enableApp: ['package', 'packageName'],
  clearAppCache: ['package', 'packageName'],
  clearAppData: ['package', 'packageName'],
});

const FREE_LOCAL_SERVICE_GET_ACTIONS = new Set([
  'isDeviceOwner', 'deviceAdmin', 'listAccounts', 'getNotifications',
  'accessibilityState', 'screenState', 'getConfig',
  'windowListener/status', 'windowListener/getRules',
]);

function normalizeFreeLocalServiceParams(action, params = {}) {
  const normalized = params && typeof params === 'object' && !Array.isArray(params)
    ? { ...params }
    : {};

  if (action === 'setBrightness') {
    const brightness = normalized.brightness ?? normalized.value;
    if (brightness !== undefined) {
      normalized.value = brightness;
      normalized.brightness = brightness;
    }
  }

  if (action === 'installApp') {
    const path = normalized.path ?? normalized.url;
    if (path !== undefined) {
      normalized.path = path;
      normalized.url = path;
    }
  }

  if (['getAppInfo', 'uninstallApp', 'forceStopApp', 'disableApp', 'enableApp', 'clearAppCache', 'clearAppData'].includes(action)) {
    const packageName = normalized.package ?? normalized.packageName;
    if (packageName !== undefined) {
      normalized.package = packageName;
      normalized.packageName = packageName;
    }
  }

  return normalized;
}

function buildFreeLocalServiceRequest(action, params = {}) {
  const frontendAction = String(action || '');
  const endpoint = FREE_LOCAL_SERVICE_ACTION_ALIASES[frontendAction] || frontendAction;
  const normalizedParams = normalizeFreeLocalServiceParams(endpoint, params);
  const query = {};

  for (const field of FREE_LOCAL_SERVICE_QUERY_FIELDS[endpoint] || []) {
    const value = normalizedParams[field];
    if (value !== undefined && value !== null && value !== '') query[field] = value;
  }

  return {
    frontendAction,
    endpoint,
    method: FREE_LOCAL_SERVICE_GET_ACTIONS.has(endpoint) ? 'GET' : 'POST',
    query,
    body: normalizedParams,
  };
}

function buildFreeLocalServicePath(request) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(request?.query || {})) {
    query.append(key, String(value));
  }
  const suffix = query.toString();
  return `/${request.endpoint}${suffix ? `?${suffix}` : ''}`;
}

function isKnownFreeLocalServiceEndpoint(action) {
  return FREE_LOCAL_SERVICE_ENDPOINTS.has(String(action || ''));
}

module.exports = {
  FREE_LOCAL_SERVICE_ENDPOINTS,
  FREE_LOCAL_SERVICE_HTTP_ENDPOINTS,
  FREE_LOCAL_SERVICE_ACTION_ALIASES,
  FREE_LOCAL_SERVICE_QUERY_FIELDS,
  FREE_LOCAL_SERVICE_GET_ACTIONS,
  normalizeFreeLocalServiceParams,
  buildFreeLocalServiceRequest,
  buildFreeLocalServicePath,
  isKnownFreeLocalServiceEndpoint,
};
