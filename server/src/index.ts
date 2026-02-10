import "dotenv/config";
import { WebSocketRelayServer } from "./WebSocketServer.js";
import { createApiServer } from "./api.js";
import { logger } from "./logger.js";

const WS_PORT = parseInt(process.env.WS_PORT || "8082", 10);
const API_PORT = parseInt(process.env.API_PORT || "8080", 10);
const HOST = process.env.WS_HOST || "0.0.0.0";

// Create WebSocket server
const wsServer = new WebSocketRelayServer({ port: WS_PORT, host: HOST });

// Create HTTP API server
const apiServer = createApiServer(wsServer);
const httpServer = apiServer.listen(API_PORT, HOST, () => {
  logger.info(`HTTP API server listening on http://${HOST}:${API_PORT}`);
});

// Handle graceful shutdown
process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down...");
  wsServer.stop();
  httpServer.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down...");
  wsServer.stop();
  httpServer.close();
  process.exit(0);
});

// Start WebSocket server
wsServer.start();

// Log stats periodically
setInterval(() => {
  const stats = wsServer.getStats();
  logger.info(
    `Stats: ${stats.connections.total} connections (${stats.connections.agents} agents, ${stats.connections.spectators} spectators), ` +
    `${stats.rooms.total}/${stats.limits.maxRooms} rooms (${stats.rooms.lobby} lobby, ${stats.rooms.playing} playing), ${stats.rooms.totalPlayers} players`
  );
}, 60000); // Every minute

logger.info("Among Us On-Chain Server starting...");
logger.info(`  WebSocket: ws://${HOST}:${WS_PORT}`);
logger.info(`  HTTP API:  http://${HOST}:${API_PORT}`);
