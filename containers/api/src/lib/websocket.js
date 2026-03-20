/**
 * LINBO Docker - WebSocket Utilities
 * Real-time event broadcasting
 */

const WebSocket = require('ws');

// Store for WebSocket server instance
let wss = null;

/**
 * Initialize WebSocket utilities with server instance
 * @param {WebSocket.Server} server - WebSocket server instance
 */
function init(server) {
  wss = server;
}

/**
 * Get the WebSocket server instance
 */
function getServer() {
  return wss;
}

/**
 * Broadcast message to all connected clients
 * @param {string} event - Event type
 * @param {object} data - Event data
 */
function broadcast(event, data) {
  if (!wss) {
    console.warn('WebSocket server not initialized');
    return;
  }

  const message = JSON.stringify({
    type: event,
    data,
    timestamp: new Date().toISOString(),
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/**
 * Broadcast to clients subscribed to specific channels
 * @param {string} event - Event type
 * @param {object} data - Event data
 * @param {string[]} channels - Target channels
 */
function broadcastToChannels(event, data, channels) {
  if (!wss) {
    console.warn('WebSocket server not initialized');
    return;
  }

  const message = JSON.stringify({
    type: event,
    data,
    timestamp: new Date().toISOString(),
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      // Check if client is subscribed to any of the channels
      const clientChannels = client.channels || [];
      const hasChannel = channels.some(ch => clientChannels.includes(ch));

      if (hasChannel || clientChannels.includes('*')) {
        client.send(message);
      }
    }
  });
}

/**
 * Send message to specific client
 * @param {WebSocket} client - WebSocket client
 * @param {string} event - Event type
 * @param {object} data - Event data
 */
function sendTo(client, event, data) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({
      type: event,
      data,
      timestamp: new Date().toISOString(),
    }));
  }
}

/**
 * Get connected client count
 */
function getClientCount() {
  if (!wss) return 0;
  return wss.clients.size;
}

/**
 * Get client statistics
 */
function getStats() {
  if (!wss) {
    return { connected: 0, channels: {} };
  }

  const channels = {};
  wss.clients.forEach((client) => {
    const clientChannels = client.channels || ['unsubscribed'];
    clientChannels.forEach((ch) => {
      channels[ch] = (channels[ch] || 0) + 1;
    });
  });

  return {
    connected: wss.clients.size,
    channels,
  };
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Broadcast host status change
 * @param {object} host - Host data (id, hostname, status, lastSeen)
 */
function broadcastHostStatus(host) {
  broadcast('host.status.changed', {
    hostId: host.id,
    hostname: host.hostname,
    status: host.status,
    lastSeen: host.lastSeen,
  });

  // Also broadcast to room-specific channel if applicable
  if (host.roomId) {
    broadcastToChannels('host.status.changed', {
      hostId: host.id,
      hostname: host.hostname,
      status: host.status,
    }, [`room:${host.roomId}`]);
  }
}

/**
 * Broadcast sync progress
 * @param {object} params - Progress data
 */
function broadcastSyncProgress(params) {
  const { hostId, hostname, progress, status, message } = params;

  broadcast('sync.progress', {
    hostId,
    hostname,
    progress,
    status,
    message,
  });

  broadcastToChannels('sync.progress', params, [`host:${hostId}`]);
}

/**
 * Broadcast sync completed
 * @param {object} params - Completion data
 */
function broadcastSyncCompleted(params) {
  const { hostId, hostname, success, duration, error } = params;

  broadcast('sync.completed', {
    hostId,
    hostname,
    success,
    duration,
    error,
  });

  broadcastToChannels('sync.completed', params, [`host:${hostId}`]);
}

/**
 * Broadcast operation started
 * @param {object} operation - Operation data
 */
function broadcastOperationStarted(operation) {
  broadcast('operation.started', {
    operationId: operation.id,
    commands: operation.commands,
    hostCount: operation.targetHosts?.length,
    status: 'started',
  });
}

/**
 * Broadcast operation progress
 * @param {object} params - Progress data
 */
function broadcastOperationProgress(params) {
  const { operationId, progress, completedSessions, totalSessions } = params;

  broadcast('operation.progress', {
    operationId,
    progress,
    completedSessions,
    totalSessions,
  });
}

/**
 * Broadcast operation completed
 * @param {object} params - Completion data
 */
function broadcastOperationCompleted(params) {
  const { operationId, status, stats, duration } = params;

  broadcast('operation.completed', {
    operationId,
    status,
    stats,
    duration,
  });
}

/**
 * Broadcast session update
 * @param {object} session - Session data
 */
function broadcastSessionUpdate(session) {
  broadcast('session.updated', {
    operationId: session.operationId,
    sessionId: session.id,
    hostId: session.hostId,
    hostname: session.hostname,
    status: session.status,
    progress: session.progress,
  });
}

/**
 * Broadcast config change
 * @param {string} action - Action (created, updated, deleted)
 * @param {object} config - Config data
 */
function broadcastConfigChange(action, config) {
  broadcast(`config.${action}`, {
    configId: config.id,
    name: config.name,
    action,
  });
}

/**
 * Broadcast image change
 * @param {string} action - Action (created, updated, deleted)
 * @param {object} image - Image data
 */
function broadcastImageChange(action, image) {
  broadcast(`image.${action}`, {
    imageId: image.id,
    filename: image.filename,
    action,
  });
}

/**
 * Broadcast system notification
 * @param {string} level - Notification level (info, warning, error)
 * @param {string} message - Notification message
 * @param {object} details - Additional details
 */
function broadcastNotification(level, message, details = {}) {
  broadcast('notification', {
    level,
    message,
    details,
  });
}

module.exports = {
  init,
  getServer,
  broadcast,
  broadcastToChannels,
  sendTo,
  getClientCount,
  getStats,
  // Specific events
  broadcastHostStatus,
  broadcastSyncProgress,
  broadcastSyncCompleted,
  broadcastOperationStarted,
  broadcastOperationProgress,
  broadcastOperationCompleted,
  broadcastSessionUpdate,
  broadcastConfigChange,
  broadcastImageChange,
  broadcastNotification,
};
