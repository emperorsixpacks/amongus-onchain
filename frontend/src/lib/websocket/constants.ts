// WebSocket Configuration Constants

export const WS_CONFIG = {
  // Connection settings
  DEFAULT_URL: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080',

  // Reconnection settings
  RECONNECT_INTERVAL_BASE: 1000, // 1 second base
  RECONNECT_INTERVAL_MAX: 30000, // 30 seconds max
  RECONNECT_MULTIPLIER: 1.5,     // Exponential backoff multiplier
  MAX_RECONNECT_ATTEMPTS: 10,

  // Heartbeat settings
  HEARTBEAT_INTERVAL: 30000,     // 30 seconds
  HEARTBEAT_TIMEOUT: 10000,      // 10 seconds to receive heartbeat response

  // Message queue settings
  MAX_QUEUE_SIZE: 100,
  QUEUE_RETRY_INTERVAL: 5000,    // 5 seconds between queue flushes

  // Authentication
  AUTH_TIMEOUT: 10000,           // 10 seconds to complete auth

  // Action settings
  ACTION_TIMEOUT: 30000,         // 30 seconds for action confirmation
} as const;

// WebSocket close codes
export const WS_CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  INVALID_DATA: 1003,
  POLICY_VIOLATION: 1008,
  MESSAGE_TOO_BIG: 1009,
  INTERNAL_ERROR: 1011,

  // Custom codes (4000-4999)
  AUTH_FAILED: 4001,
  GAME_ENDED: 4002,
  KICKED: 4003,
  DUPLICATE_CONNECTION: 4004,
} as const;

// Error messages
export const WS_ERRORS = {
  CONNECTION_FAILED: 'Failed to connect to game server',
  AUTH_FAILED: 'Authentication failed',
  AUTH_TIMEOUT: 'Authentication timed out',
  HEARTBEAT_TIMEOUT: 'Connection lost (heartbeat timeout)',
  MAX_RECONNECT: 'Maximum reconnection attempts reached',
  INVALID_MESSAGE: 'Received invalid message from server',
  SEND_FAILED: 'Failed to send message',
  NOT_CONNECTED: 'Not connected to server',
} as const;
