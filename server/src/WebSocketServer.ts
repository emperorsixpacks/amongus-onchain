import { WebSocketServer as WSServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import type {
  ClientMessage,
  ServerMessage,
  RoomState,
  PlayerState,
  Location,
  GamePhase,
} from "./types.js";
import { createLogger } from "./logger.js";

const logger = createLogger("websocket-server");

interface Client {
  id: string;
  ws: WebSocket;
  address?: string;
  name?: string;
  roomId?: string;
  isAgent: boolean;
  colorId?: number;
}

export interface WebSocketServerConfig {
  port: number;
  host?: string;
}

export class WebSocketRelayServer {
  private wss: WSServer | null = null;
  private clients: Map<string, Client> = new Map();
  private rooms: Map<string, RoomState> = new Map();
  private config: WebSocketServerConfig;

  constructor(config: WebSocketServerConfig) {
    this.config = config;
  }

  start(): void {
    this.wss = new WSServer({
      port: this.config.port,
      host: this.config.host || "0.0.0.0",
    });

    this.wss.on("listening", () => {
      logger.info(`WebSocket server listening on ${this.config.host || "0.0.0.0"}:${this.config.port}`);
    });

    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws);
    });

    this.wss.on("error", (error) => {
      logger.error(`Server error: ${error}`);
    });
  }

  stop(): void {
    if (this.wss) {
      this.wss.close();
      logger.info("Server stopped");
    }
  }

  private handleConnection(ws: WebSocket): void {
    const clientId = uuidv4();
    const client: Client = {
      id: clientId,
      ws,
      isAgent: false,
    };
    this.clients.set(clientId, client);

    logger.info(`Client connected: ${clientId}`);

    // Send welcome + room list
    this.send(client, {
      type: "server:welcome",
      connectionId: clientId,
      timestamp: Date.now(),
    });

    this.send(client, {
      type: "server:room_list",
      rooms: Array.from(this.rooms.values()),
    });

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString()) as ClientMessage;
        this.handleMessage(client, message);
      } catch (error) {
        logger.error(`Invalid message from ${clientId}: ${error}`);
        this.sendError(client, "INVALID_MESSAGE", "Failed to parse message");
      }
    });

    ws.on("close", () => {
      this.handleDisconnect(client);
    });

    ws.on("error", (error) => {
      logger.error(`Client error ${clientId}: ${error}`);
    });
  }

  private handleMessage(client: Client, message: ClientMessage): void {
    logger.debug(`Message from ${client.id}: ${message.type}`);

    switch (message.type) {
      // New client messages
      case "client:authenticate":
        this.handleAuthenticate(client, message.address, message.name);
        break;

      case "client:create_room":
        this.handleCreateRoom(client, message.maxPlayers, message.impostorCount);
        break;

      case "client:join_room":
        this.handleJoinRoom(client, message.roomId, message.colorId, message.asSpectator);
        break;

      case "client:leave_room":
        this.handleLeaveRoom(client, message.roomId);
        break;

      case "client:start_game":
        this.handleStartGame(client, message.roomId);
        break;

      // Legacy agent messages (for backwards compat)
      case "agent:authenticate":
        this.handleAuthenticate(client, message.address);
        break;

      case "agent:join_game":
        this.handleJoinRoom(client, message.gameId, message.colorId, false);
        break;

      case "agent:leave_game":
        this.handleLeaveRoom(client, message.gameId);
        break;

      // Game action messages
      case "agent:position_update":
        this.handlePositionUpdate(client, message.gameId, message.location, message.round);
        break;

      case "agent:kill":
        this.handleKill(client, message.gameId, message.killer, message.victim, message.location, message.round);
        break;

      case "agent:vote":
        this.handleVote(client, message.gameId, message.voter, message.target, message.round);
        break;

      case "agent:task_complete":
        this.handleTaskComplete(client, message.gameId, message.player, message.tasksCompleted, message.totalTasks);
        break;

      case "agent:phase_change":
        this.handlePhaseChange(client, message.gameId, message.phase, message.round, message.phaseEndTime);
        break;

      default:
        logger.warn(`Unknown message type from ${client.id}`);
    }
  }

  private handleAuthenticate(client: Client, address?: string, name?: string): void {
    client.address = address;
    client.name = name || address?.slice(0, 8) || `Client-${client.id.slice(0, 6)}`;
    client.isAgent = !!address;
    logger.info(`Client ${client.id} authenticated as ${client.name} (agent: ${client.isAgent})`);
  }

  private handleCreateRoom(client: Client, maxPlayers?: number, impostorCount?: number): void {
    const roomId = `room-${uuidv4().slice(0, 8)}`;
    const room: RoomState = {
      roomId,
      players: [],
      spectators: [],
      maxPlayers: maxPlayers || 10,
      impostorCount: impostorCount || 2,
      phase: "lobby",
      createdAt: Date.now(),
    };

    this.rooms.set(roomId, room);
    logger.info(`Room created: ${roomId} by ${client.name}`);

    // Notify creator
    this.send(client, { type: "server:room_created", room });

    // Broadcast room list update to all clients
    this.broadcastRoomList();
  }

  private handleJoinRoom(client: Client, roomId: string, colorId?: number, asSpectator?: boolean): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      this.sendError(client, "ROOM_NOT_FOUND", `Room ${roomId} not found`);
      return;
    }

    // Leave previous room if any
    if (client.roomId && client.roomId !== roomId) {
      this.handleLeaveRoom(client, client.roomId);
    }

    client.roomId = roomId;
    client.colorId = colorId;

    if (asSpectator || !client.isAgent) {
      // Join as spectator
      if (!room.spectators.includes(client.id)) {
        room.spectators.push(client.id);
      }
      logger.info(`Spectator ${client.name} joined room ${roomId}`);
    } else {
      // Join as player
      if (room.players.length >= room.maxPlayers) {
        this.sendError(client, "ROOM_FULL", "Room is full");
        return;
      }

      const playerState: PlayerState = {
        address: client.address || client.id,
        colorId: colorId ?? room.players.length,
        location: 0, // Cafeteria
        isAlive: true,
        tasksCompleted: 0,
        totalTasks: 5,
        hasVoted: false,
      };

      room.players.push(playerState);
      logger.info(`Player ${client.name} joined room ${roomId} (color: ${playerState.colorId})`);

      // Broadcast player joined to room
      this.broadcastToRoom(roomId, {
        type: "server:player_joined",
        gameId: roomId,
        player: playerState,
      });
    }

    // Send current room state to the joining client
    this.send(client, { type: "server:room_update", room });

    // Broadcast room list update
    this.broadcastRoomList();
  }

  private handleLeaveRoom(client: Client, roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Remove from spectators
    room.spectators = room.spectators.filter((id) => id !== client.id);

    // Remove from players
    const playerIndex = room.players.findIndex(
      (p) => p.address === client.address || p.address === client.id
    );
    if (playerIndex >= 0) {
      room.players.splice(playerIndex, 1);

      // Broadcast player left
      this.broadcastToRoom(roomId, {
        type: "server:player_left",
        gameId: roomId,
        address: client.address || client.id,
      });
    }

    client.roomId = undefined;
    logger.info(`Client ${client.name} left room ${roomId}`);

    // Delete empty rooms
    if (room.players.length === 0 && room.spectators.length === 0) {
      this.rooms.delete(roomId);
      logger.info(`Room ${roomId} deleted (empty)`);
    }

    this.broadcastRoomList();
  }

  private handleStartGame(client: Client, roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      this.sendError(client, "ROOM_NOT_FOUND", "Room not found");
      return;
    }

    if (room.players.length < 4) {
      this.sendError(client, "NOT_ENOUGH_PLAYERS", "Need at least 4 players to start");
      return;
    }

    room.phase = "playing";

    // Assign impostors randomly
    const impostorIndices = new Set<number>();
    while (impostorIndices.size < Math.min(room.impostorCount, Math.floor(room.players.length / 3))) {
      impostorIndices.add(Math.floor(Math.random() * room.players.length));
    }

    logger.info(`Game started in room ${roomId} with ${room.players.length} players`);

    // Broadcast game start (phase change)
    this.broadcastToRoom(roomId, {
      type: "server:phase_changed",
      gameId: roomId,
      phase: 2, // ActionCommit
      previousPhase: 0,
      round: 1,
      phaseEndTime: Date.now() + 60000,
      timestamp: Date.now(),
    });

    // Send room update
    this.broadcastToRoom(roomId, { type: "server:room_update", room });
    this.broadcastRoomList();
  }

  private handlePositionUpdate(client: Client, roomId: string, location: Location, round: number): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const player = room.players.find((p) => p.address === client.address);
    if (!player) return;

    const previousLocation = player.location;
    player.location = location;

    this.broadcastToRoom(roomId, {
      type: "server:player_moved",
      gameId: roomId,
      address: client.address!,
      from: previousLocation,
      to: location,
      round,
      timestamp: Date.now(),
    });
  }

  private handleKill(client: Client, roomId: string, killer: string, victim: string, location: Location, round: number): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const victimPlayer = room.players.find((p) => p.address === victim);
    if (victimPlayer) {
      victimPlayer.isAlive = false;
    }

    this.broadcastToRoom(roomId, {
      type: "server:kill_occurred",
      gameId: roomId,
      killer,
      victim,
      location,
      round,
      timestamp: Date.now(),
    });

    logger.info(`Kill in room ${roomId}: ${killer} killed ${victim}`);
  }

  private handleVote(client: Client, roomId: string, voter: string, target: string | null, round: number): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const voterPlayer = room.players.find((p) => p.address === voter);
    if (voterPlayer) {
      voterPlayer.hasVoted = true;
    }

    this.broadcastToRoom(roomId, {
      type: "server:vote_cast",
      gameId: roomId,
      voter,
      target,
      round,
      timestamp: Date.now(),
    });
  }

  private handleTaskComplete(client: Client, roomId: string, player: string, tasksCompleted: number, totalTasks: number): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const playerState = room.players.find((p) => p.address === player);
    if (playerState) {
      playerState.tasksCompleted = tasksCompleted;
      playerState.totalTasks = totalTasks;
    }

    // Calculate total progress
    const totalDone = room.players.reduce((sum, p) => sum + p.tasksCompleted, 0);
    const totalRequired = room.players.reduce((sum, p) => sum + p.totalTasks, 0);
    const progress = totalRequired > 0 ? (totalDone / totalRequired) * 100 : 0;

    this.broadcastToRoom(roomId, {
      type: "server:task_completed",
      gameId: roomId,
      player,
      tasksCompleted,
      totalTasks,
      totalProgress: progress,
      timestamp: Date.now(),
    });
  }

  private handlePhaseChange(client: Client, roomId: string, phase: GamePhase, round: number, phaseEndTime: number): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const previousPhase = room.phase === "lobby" ? 0 : 2;

    if (phase === 7) {
      room.phase = "ended";
    }

    this.broadcastToRoom(roomId, {
      type: "server:phase_changed",
      gameId: roomId,
      phase,
      previousPhase,
      round,
      phaseEndTime,
      timestamp: Date.now(),
    });
  }

  private handleDisconnect(client: Client): void {
    if (client.roomId) {
      this.handleLeaveRoom(client, client.roomId);
    }
    this.clients.delete(client.id);
    logger.info(`Client disconnected: ${client.id}`);
  }

  private send(client: Client, message: ServerMessage): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  private sendError(client: Client, code: string, message: string): void {
    this.send(client, { type: "server:error", code, message });
  }

  private broadcastToRoom(roomId: string, message: ServerMessage): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Send to all players
    for (const player of room.players) {
      const client = this.findClientByAddress(player.address);
      if (client) this.send(client, message);
    }

    // Send to all spectators
    for (const specId of room.spectators) {
      const client = this.clients.get(specId);
      if (client) this.send(client, message);
    }
  }

  private broadcastRoomList(): void {
    const roomList = Array.from(this.rooms.values());
    for (const client of this.clients.values()) {
      this.send(client, { type: "server:room_list", rooms: roomList });
    }
  }

  private findClientByAddress(address: string): Client | undefined {
    for (const client of this.clients.values()) {
      if (client.address === address || client.id === address) {
        return client;
      }
    }
    return undefined;
  }

  getStats() {
    return {
      connections: { total: this.clients.size, agents: 0, spectators: 0 },
      rooms: { rooms: this.rooms.size, totalMembers: 0 },
      games: { games: 0, players: 0 },
    };
  }
}
