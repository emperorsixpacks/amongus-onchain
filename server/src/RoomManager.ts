import { ConnectionManager } from "./ConnectionManager.js";
import type { ServerMessage } from "./types.js";
import { createLogger } from "./logger.js";

const logger = createLogger("room-manager");

interface Room {
  gameId: string;
  members: Set<string>; // connection IDs
  createdAt: number;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private connectionManager: ConnectionManager;

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  /**
   * Create or get a room for a game
   */
  getOrCreateRoom(gameId: string): Room {
    if (!this.rooms.has(gameId)) {
      const room: Room = {
        gameId,
        members: new Set(),
        createdAt: Date.now(),
      };
      this.rooms.set(gameId, room);
      logger.info(`Created room for game: ${gameId}`);
    }
    return this.rooms.get(gameId)!;
  }

  /**
   * Check if room exists
   */
  hasRoom(gameId: string): boolean {
    return this.rooms.has(gameId);
  }

  /**
   * Join a connection to a room
   */
  joinRoom(connectionId: string, gameId: string): boolean {
    const room = this.getOrCreateRoom(gameId);

    // Leave previous room if any
    const connection = this.connectionManager.getConnection(connectionId);
    if (connection?.gameId && connection.gameId !== gameId) {
      this.leaveRoom(connectionId, connection.gameId);
    }

    room.members.add(connectionId);
    this.connectionManager.setGameRoom(connectionId, gameId);

    logger.info(`Connection ${connectionId} joined room ${gameId}`);
    return true;
  }

  /**
   * Remove a connection from a room
   */
  leaveRoom(connectionId: string, gameId: string): boolean {
    const room = this.rooms.get(gameId);
    if (!room) return false;

    room.members.delete(connectionId);
    this.connectionManager.setGameRoom(connectionId, undefined);

    // Clean up empty rooms
    if (room.members.size === 0) {
      this.rooms.delete(gameId);
      logger.info(`Room ${gameId} deleted (empty)`);
    }

    logger.info(`Connection ${connectionId} left room ${gameId}`);
    return true;
  }

  /**
   * Remove connection from any room it's in
   */
  leaveAllRooms(connectionId: string): void {
    const connection = this.connectionManager.getConnection(connectionId);
    if (connection?.gameId) {
      this.leaveRoom(connectionId, connection.gameId);
    }
  }

  /**
   * Get all members of a room
   */
  getRoomMembers(gameId: string): string[] {
    const room = this.rooms.get(gameId);
    if (!room) return [];
    return Array.from(room.members);
  }

  /**
   * Get room member count
   */
  getRoomSize(gameId: string): number {
    const room = this.rooms.get(gameId);
    return room?.members.size ?? 0;
  }

  /**
   * Broadcast a message to all members of a room
   */
  broadcast(gameId: string, message: ServerMessage): number {
    const room = this.rooms.get(gameId);
    if (!room) return 0;

    let sent = 0;
    for (const connectionId of room.members) {
      if (this.connectionManager.send(connectionId, message)) {
        sent++;
      }
    }

    logger.debug(`Broadcast to room ${gameId}: ${sent}/${room.members.size} received`);
    return sent;
  }

  /**
   * Broadcast to all members except one (useful for echoing sender's own action)
   */
  broadcastExcept(
    gameId: string,
    message: ServerMessage,
    excludeConnectionId: string
  ): number {
    const room = this.rooms.get(gameId);
    if (!room) return 0;

    let sent = 0;
    for (const connectionId of room.members) {
      if (connectionId !== excludeConnectionId) {
        if (this.connectionManager.send(connectionId, message)) {
          sent++;
        }
      }
    }
    return sent;
  }

  /**
   * Get all active room IDs
   */
  getActiveRooms(): string[] {
    return Array.from(this.rooms.keys());
  }

  /**
   * Get room stats
   */
  getStats(): { rooms: number; totalMembers: number } {
    let totalMembers = 0;
    for (const room of this.rooms.values()) {
      totalMembers += room.members.size;
    }
    return { rooms: this.rooms.size, totalMembers };
  }

  /**
   * Delete a room
   */
  deleteRoom(gameId: string): boolean {
    const room = this.rooms.get(gameId);
    if (!room) return false;

    // Clear game room from all members
    for (const connectionId of room.members) {
      this.connectionManager.setGameRoom(connectionId, undefined);
    }

    this.rooms.delete(gameId);
    logger.info(`Room ${gameId} deleted`);
    return true;
  }
}
