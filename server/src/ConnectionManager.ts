import type { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import type { Connection, ConnectionType } from "./types.js";
import { createLogger } from "./logger.js";

const logger = createLogger("connection-manager");

export class ConnectionManager {
  // connectionId -> WebSocket
  private connections: Map<string, WebSocket> = new Map();

  // connectionId -> Connection metadata
  private metadata: Map<string, Connection> = new Map();

  // address -> connectionId (for agents only)
  private addressToConnection: Map<string, string> = new Map();

  /**
   * Register a new WebSocket connection
   */
  addConnection(ws: WebSocket, type: ConnectionType = "spectator"): string {
    const id = uuidv4();
    const connection: Connection = {
      id,
      type,
      joinedAt: Date.now(),
    };

    this.connections.set(id, ws);
    this.metadata.set(id, connection);

    logger.info(`New ${type} connection: ${id}`);
    return id;
  }

  /**
   * Remove a connection
   */
  removeConnection(connectionId: string): void {
    const meta = this.metadata.get(connectionId);
    if (meta?.address) {
      this.addressToConnection.delete(meta.address);
    }

    this.connections.delete(connectionId);
    this.metadata.delete(connectionId);
    logger.info(`Connection removed: ${connectionId}`);
  }

  /**
   * Authenticate a connection as an agent
   */
  authenticateAgent(connectionId: string, address: string): boolean {
    const meta = this.metadata.get(connectionId);
    if (!meta) {
      logger.warn(`Cannot authenticate unknown connection: ${connectionId}`);
      return false;
    }

    // Check if address already connected
    if (this.addressToConnection.has(address)) {
      const existingId = this.addressToConnection.get(address)!;
      if (existingId !== connectionId) {
        logger.warn(`Address ${address} already has an active connection`);
        return false;
      }
    }

    meta.type = "agent";
    meta.address = address;
    this.addressToConnection.set(address, connectionId);

    logger.info(`Agent authenticated: ${address} (connection: ${connectionId})`);
    return true;
  }

  /**
   * Get WebSocket by connection ID
   */
  getSocket(connectionId: string): WebSocket | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Get connection metadata
   */
  getConnection(connectionId: string): Connection | undefined {
    return this.metadata.get(connectionId);
  }

  /**
   * Get connection ID by agent address
   */
  getConnectionByAddress(address: string): string | undefined {
    return this.addressToConnection.get(address);
  }

  /**
   * Get socket by agent address
   */
  getSocketByAddress(address: string): WebSocket | undefined {
    const connectionId = this.addressToConnection.get(address);
    if (!connectionId) return undefined;
    return this.connections.get(connectionId);
  }

  /**
   * Set the game room for a connection
   */
  setGameRoom(connectionId: string, gameId: string | undefined): void {
    const meta = this.metadata.get(connectionId);
    if (meta) {
      meta.gameId = gameId;
    }
  }

  /**
   * Get all connections in a specific game
   */
  getConnectionsInGame(gameId: string): string[] {
    const result: string[] = [];
    for (const [id, meta] of this.metadata) {
      if (meta.gameId === gameId) {
        result.push(id);
      }
    }
    return result;
  }

  /**
   * Get all agent connections
   */
  getAgentConnections(): string[] {
    const result: string[] = [];
    for (const [id, meta] of this.metadata) {
      if (meta.type === "agent") {
        result.push(id);
      }
    }
    return result;
  }

  /**
   * Get all spectator connections
   */
  getSpectatorConnections(): string[] {
    const result: string[] = [];
    for (const [id, meta] of this.metadata) {
      if (meta.type === "spectator") {
        result.push(id);
      }
    }
    return result;
  }

  /**
   * Get total connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get connection stats
   */
  getStats(): { total: number; agents: number; spectators: number } {
    let agents = 0;
    let spectators = 0;
    for (const meta of this.metadata.values()) {
      if (meta.type === "agent") agents++;
      else spectators++;
    }
    return { total: this.connections.size, agents, spectators };
  }

  /**
   * Send message to a specific connection
   */
  send(connectionId: string, message: object): boolean {
    const ws = this.connections.get(connectionId);
    if (!ws || ws.readyState !== 1) {
      // 1 = OPEN
      return false;
    }

    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      logger.error(`Failed to send message to ${connectionId}: ${error}`);
      return false;
    }
  }

  /**
   * Broadcast to all connections
   */
  broadcast(message: object): number {
    let sent = 0;
    for (const id of this.connections.keys()) {
      if (this.send(id, message)) sent++;
    }
    return sent;
  }
}
