'use strict';

const { broadcastToAdmins } = require('./admin');

/**
 * ADB Agent WebSocket handler
 * 路径: /ws/agent/:device_id
 */
function handleAgent(ws, deviceId, connections) {
  connections.agents.set(deviceId, { ws, deviceId });
  console.log(`[WS-Agent] Connected: ${deviceId}`);

  broadcastToAdmins(connections, {
    type: 'agent_connected',
    deviceId,
    data: { adbConnected: true },
  });

  ws.on('message', (data) => {
    if (Buffer.isBuffer(data)) {
      // 二进制数据（可能是 ADB 流），转发给管理端
      for (const [, conn] of connections.admins) {
        if (conn.ws.readyState === 1) {
          conn.ws.send(data);
        }
      }
      return;
    }

    try {
      const msg = JSON.parse(data.toString());
      handleAgentMessage(ws, msg, deviceId, connections);
    } catch {}
  });

  ws.on('close', () => {
    connections.agents.delete(deviceId);
    broadcastToAdmins(connections, {
      type: 'agent_disconnected',
      deviceId,
      data: { adbConnected: false },
    });
    console.log(`[WS-Agent] Disconnected: ${deviceId}`);
  });

  ws.on('error', () => {
    connections.agents.delete(deviceId);
  });
}

function handleAgentMessage(ws, msg, deviceId, connections) {
  const { type } = msg;

  switch (type) {
    case 'adb_result':
    case 'shell_output':
      broadcastToAdmins(connections, { ...msg, deviceId });
      break;

    case 'status':
      broadcastToAdmins(connections, {
        type: 'agent_status',
        deviceId,
        data: msg.data || msg,
      });
      break;

    default:
      broadcastToAdmins(connections, { ...msg, deviceId });
  }
}

module.exports = { handleAgent };
