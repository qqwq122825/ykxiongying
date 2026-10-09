'use strict';

const BRIDGE_ONLY_COMMANDS = new Set([
  'adb_shell',
  'adb_tunnel',
  'INSTALL_APK',
  'FILE_PUSH',
  'FILE_PULL',
]);

function getCommandName(data) {
  if (data && data.command) return data.command;
  if (data && data.data && data.data.command) return data.data.command;
  return '';
}

function getCommandRoute(data) {
  return BRIDGE_ONLY_COMMANDS.has(getCommandName(data)) ? 'bridge' : 'device';
}

module.exports = {
  BRIDGE_ONLY_COMMANDS,
  getCommandName,
  getCommandRoute,
};
