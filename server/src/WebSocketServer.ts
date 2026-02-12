import { WebSocketServer as WSServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import type {
  ClientMessage,
  ServerMessage,
  RoomState,
  PlayerState,
  Location,
  GamePhase,
  DeadBodyState,
  AgentStats,
  SabotageType,
} from "./types.js";
import { createLogger } from "./logger.js";
import { GameStateManager, WinConditionResult } from "./GameStateManager.js";
import { privyWalletService } from "./PrivyWalletService.js";
import { wagerService } from "./WagerService.js";
import { contractService } from "./ContractService.js";
import { databaseService } from "./DatabaseService.js";

const logger = createLogger("websocket-server");

// Phase timing constants
const DISCUSSION_DURATION = 30000; // 30 seconds
const VOTING_DURATION = 30000; // 30 seconds
const EJECTION_DURATION = 5000; // 5 seconds

// Room management constants
const MAX_ROOMS = 3;
const MAX_PLAYERS_PER_ROOM = 10;
const MIN_PLAYERS_TO_START = 6;
const FILL_WAIT_DURATION = 30000; // 30 seconds to wait for room to fill after min players
const MIN_PLAYERS_WAIT_DURATION = 120000; // 2 minutes to wait for min players before deleting room
const COOLDOWN_DURATION = 600000; // 10 minutes cooldown after game ends

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

// Room slot state for automatic management
type RoomSlotState = "active" | "cooldown" | "empty";

interface RoomSlot {
  id: number;
  state: RoomSlotState;
  roomId: string | null;
  cooldownEndTime: number | null;
  fillTimer: NodeJS.Timeout | null;
  minPlayersTimer: NodeJS.Timeout | null;
}

// Extended room state with game mechanics
interface ExtendedRoomState extends RoomState {
  impostors: Set<string>;
  votes: Map<string, string | null>;
  deadBodies: DeadBodyState[];
  currentRound: number;
  currentPhase: GamePhase;
  phaseTimer: NodeJS.Timeout | null;
  slotId: number; // Which slot this room belongs to
}

export class WebSocketRelayServer {
  private wss: WSServer | null = null;
  private clients: Map<string, Client> = new Map();
  private rooms: Map<string, RoomState> = new Map();
  private extendedState: Map<string, ExtendedRoomState> = new Map();
  private roomSlots: RoomSlot[] = [];
  private agentStats: Map<string, AgentStats> = new Map(); // Track agent statistics
  private gameStateManager: GameStateManager;
  private config: WebSocketServerConfig;

  constructor(config: WebSocketServerConfig) {
    this.config = config;
    this.gameStateManager = new GameStateManager();

    // Initialize room slots
    for (let i = 0; i < MAX_ROOMS; i++) {
      this.roomSlots.push({
        id: i,
        state: "empty",
        roomId: null,
        cooldownEndTime: null,
        fillTimer: null,
        minPlayersTimer: null,
      });
    }
  }

  start(): void {
    this.wss = new WSServer({
      port: this.config.port,
      host: this.config.host || "0.0.0.0",
    });

    this.wss.on("listening", () => {
      logger.info(`WebSocket server listening on ${this.config.host || "0.0.0.0"}:${this.config.port}`);
      // Auto-create rooms for all slots on server start
      this.initializeRoomSlots();
    });

    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws);
    });

    this.wss.on("error", (error) => {
      logger.error(`Server error: ${error}`);
    });
  }

  // ============ AUTOMATIC ROOM MANAGEMENT ============

  private initializeRoomSlots(): void {
    logger.info("Initializing room slots...");
    for (const slot of this.roomSlots) {
      this.createRoomForSlot(slot.id);
    }
  }

  private createRoomForSlot(slotId: number): void {
    const slot = this.roomSlots[slotId];
    if (!slot || slot.state !== "empty") return;

    const roomId = `game-${slotId + 1}-${uuidv4().slice(0, 6)}`;
    const room: RoomState = {
      roomId,
      players: [],
      spectators: [],
      maxPlayers: MAX_PLAYERS_PER_ROOM,
      impostorCount: 2,
      phase: "lobby",
      createdAt: Date.now(),
    };

    this.rooms.set(roomId, room);
    slot.state = "active";
    slot.roomId = roomId;
    slot.cooldownEndTime = null;

    // Persist to database (background)
    databaseService.createGame(roomId);

    logger.info(`Room ${roomId} created for slot ${slotId}`);

    // Start timer to check for minimum players
    slot.minPlayersTimer = setTimeout(() => {
      this.checkMinPlayers(slotId);
    }, MIN_PLAYERS_WAIT_DURATION);

    this.broadcastRoomList();

    // Broadcast new room available to all agents
    this.broadcastToAll({
      type: "server:room_available",
      roomId,
      slotId,
    } as any);
  }

  private checkMinPlayers(slotId: number): void {
    const slot = this.roomSlots[slotId];
    if (!slot || !slot.roomId) return;

    const room = this.rooms.get(slot.roomId);
    if (!room || room.phase !== "lobby") return;

    if (room.players.length < MIN_PLAYERS_TO_START) {
      logger.info(`Room ${slot.roomId} has ${room.players.length} players (need ${MIN_PLAYERS_TO_START}), deleting and starting cooldown`);
      this.deleteRoomAndCooldown(slotId);
    }
  }

  private startFillTimer(slotId: number): void {
    const slot = this.roomSlots[slotId];
    if (!slot || slot.fillTimer) return;

    logger.info(`Starting fill timer for slot ${slotId} (${FILL_WAIT_DURATION / 1000}s to reach max players)`);

    slot.fillTimer = setTimeout(() => {
      this.onFillTimerExpired(slotId);
    }, FILL_WAIT_DURATION);
  }

  private onFillTimerExpired(slotId: number): void {
    const slot = this.roomSlots[slotId];
    if (!slot || !slot.roomId) return;

    const room = this.rooms.get(slot.roomId);
    if (!room || room.phase !== "lobby") return;

    slot.fillTimer = null;

    if (room.players.length >= MIN_PLAYERS_TO_START) {
      logger.info(`Fill timer expired for slot ${slotId}, starting game with ${room.players.length} players`);
      this.autoStartGame(slot.roomId);
    }
  }

  private deleteRoomAndCooldown(slotId: number): void {
    const slot = this.roomSlots[slotId];
    if (!slot) return;

    // Clear timers
    if (slot.fillTimer) {
      clearTimeout(slot.fillTimer);
      slot.fillTimer = null;
    }
    if (slot.minPlayersTimer) {
      clearTimeout(slot.minPlayersTimer);
      slot.minPlayersTimer = null;
    }

    // Delete the room
    if (slot.roomId) {
      const room = this.rooms.get(slot.roomId);
      if (room) {
        // Refund wagers if game hasn't ended (i.e., room closed before game started)
        if (room.phase !== "ended") {
          const refunded = wagerService.refundGame(slot.roomId);
          if (refunded) {
            logger.info(`Refunded wagers for cancelled room ${slot.roomId}`);
          }

          // Cancel game on-chain if it was playing
          if (room.phase === "playing") {
            const roomIdToCancel = slot.roomId;
            contractService.cancelGame(roomIdToCancel)
              .then(success => {
                if (success) {
                  logger.info(`Game ${roomIdToCancel} cancelled on-chain successfully`);
                } else {
                  logger.warn(`Failed to cancel game ${roomIdToCancel} on-chain`);
                }
              })
              .catch(err => {
                logger.error(`Error cancelling game ${roomIdToCancel} on-chain:`, err);
              });
          }
        }

        // Notify players
        this.broadcastToRoom(slot.roomId, {
          type: "server:error",
          code: "ROOM_CLOSED",
          message: "Room closed due to insufficient players. Wagers have been refunded.",
        });

        // Remove players from room
        for (const player of room.players) {
          const client = this.findClientByAddress(player.address);
          if (client) {
            client.roomId = undefined;
            // Send updated balance after refund
            this.send(client, {
              type: "server:balance",
              address: player.address,
              balance: wagerService.getBalance(player.address).toString(),
              wagerAmount: wagerService.getWagerAmount().toString(),
              timestamp: Date.now(),
            });
          }
        }
        for (const specId of room.spectators) {
          const client = this.clients.get(specId);
          if (client) {
            client.roomId = undefined;
          }
        }
      }

      this.rooms.delete(slot.roomId);
      this.extendedState.delete(slot.roomId);
    }

    // Start cooldown
    slot.state = "cooldown";
    slot.roomId = null;
    slot.cooldownEndTime = Date.now() + COOLDOWN_DURATION;

    logger.info(`Slot ${slotId} entering cooldown until ${new Date(slot.cooldownEndTime).toISOString()}`);

    this.broadcastRoomList();

    // Schedule room creation after cooldown
    setTimeout(() => {
      this.onCooldownExpired(slotId);
    }, COOLDOWN_DURATION);
  }

  private onCooldownExpired(slotId: number): void {
    const slot = this.roomSlots[slotId];
    if (!slot || slot.state !== "cooldown") return;

    logger.info(`Cooldown expired for slot ${slotId}, creating new room`);
    slot.state = "empty";
    slot.cooldownEndTime = null;
    this.createRoomForSlot(slotId);
  }

  private onPlayerJoinedRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.phase !== "lobby") return;

    // Find slot for this room
    const slot = this.roomSlots.find(s => s.roomId === roomId);
    if (!slot) return;

    // Clear min players timer since we have activity
    if (slot.minPlayersTimer) {
      clearTimeout(slot.minPlayersTimer);
      slot.minPlayersTimer = null;
    }

    // Check if we should start the game
    if (room.players.length >= MAX_PLAYERS_PER_ROOM) {
      // Room is full, start immediately
      logger.info(`Room ${roomId} is full (${room.players.length} players), starting game`);
      if (slot.fillTimer) {
        clearTimeout(slot.fillTimer);
        slot.fillTimer = null;
      }
      this.autoStartGame(roomId);
    } else if (room.players.length >= MIN_PLAYERS_TO_START) {
      // Start fill timer if not already running
      if (!slot.fillTimer) {
        this.startFillTimer(slot.id);
      }
    } else {
      // Reset min players timer
      slot.minPlayersTimer = setTimeout(() => {
        this.checkMinPlayers(slot.id);
      }, MIN_PLAYERS_WAIT_DURATION);
    }
  }

  private autoStartGame(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.phase !== "lobby") return;

    if (room.players.length < MIN_PLAYERS_TO_START) {
      logger.warn(`Cannot auto-start ${roomId}: only ${room.players.length} players (need ${MIN_PLAYERS_TO_START})`);
      return;
    }

    // Find and clear slot timers
    const slot = this.roomSlots.find(s => s.roomId === roomId);
    if (slot) {
      if (slot.fillTimer) {
        clearTimeout(slot.fillTimer);
        slot.fillTimer = null;
      }
      if (slot.minPlayersTimer) {
        clearTimeout(slot.minPlayersTimer);
        slot.minPlayersTimer = null;
      }
    }

    this.startGameInternal(roomId);
  }

  private broadcastToAll(message: ServerMessage): void {
    for (const client of this.clients.values()) {
      this.send(client, message);
    }
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

    // Send welcome + room list + leaderboard
    this.send(client, {
      type: "server:welcome",
      connectionId: clientId,
      timestamp: Date.now(),
    });

    this.send(client, {
      type: "server:room_list",
      rooms: Array.from(this.rooms.values()),
    });

    // Send current leaderboard
    this.send(client, {
      type: "server:leaderboard",
      agents: this.getLeaderboard(10),
      timestamp: Date.now(),
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
        // Manual room creation disabled - server manages rooms automatically
        this.sendError(client, "MANUAL_CREATION_DISABLED", "Rooms are created automatically by the server");
        break;

      case "client:join_room":
        this.handleJoinRoom(client, message.roomId, message.colorId, message.asSpectator);
        break;

      case "client:leave_room":
        this.handleLeaveRoom(client, message.roomId);
        break;

      case "client:start_game":
        // Manual game start disabled - games start automatically
        this.sendError(client, "MANUAL_START_DISABLED", "Games start automatically when enough players join");
        break;

      // Legacy agent messages (for backwards compat)
      case "agent:authenticate":
        this.handleAgentAuthenticate(client, message.address, message.name, message.requestWallet);
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

      case "agent:report_body":
        this.handleReportBody(client, message.gameId, message.reporter, message.bodyLocation, message.round);
        break;

      // Operator messages
      case "operator:create_agent":
        this.handleCreateAgent(client, message.operatorKey);
        break;

      case "operator:list_agents":
        this.handleListAgents(client, message.operatorKey);
        break;

      case "operator:withdraw_request":
        this.handleWithdrawRequest(client, message.operatorKey, message.agentAddress, message.amount);
        break;

      // Wager messages
      case "agent:deposit":
        this.handleDeposit(client, message.amount);
        break;

      case "agent:submit_wager":
        this.handleSubmitWager(client, message.gameId);
        break;

      case "agent:get_balance":
        this.handleGetBalance(client);
        break;

      case "agent:call_meeting":
        this.handleCallMeeting(client, message.gameId);
        break;

      case "agent:chat":
        this.handleChat(client, message.gameId, message.message);
        break;

      case "agent:sabotage":
        this.handleSabotage(client, message.gameId, message.sabotageType);
        break;

      case "agent:fix_sabotage":
        this.handleFixSabotage(client, message.gameId, message.location);
        break;

      case "agent:vent":
        this.handleVent(client, message.gameId, message.action, message.targetLocation);
        break;

      case "agent:use_cameras":
        this.handleUseCameras(client, message.gameId, message.action);
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

    // Track agent in stats
    if (address) {
      this.getOrCreateAgentStats(address, client.name);
    }
  }

  /**
   * Handle agent authentication with optional automatic wallet creation
   */
  private async handleAgentAuthenticate(
    client: Client,
    address?: string,
    name?: string,
    requestWallet?: boolean
  ): Promise<void> {
    // If agent already has an address, use normal authentication
    if (address) {
      this.handleAuthenticate(client, address, name);
      this.send(client, {
        type: "server:authenticated",
        success: true,
        address,
        name: client.name || address.slice(0, 8),
        isNewWallet: false,
        timestamp: Date.now(),
      });
      return;
    }

    // If no address and requestWallet is true, create a new wallet
    if (requestWallet) {
      if (!privyWalletService.isEnabled()) {
        this.send(client, {
          type: "server:wallet_assigned",
          success: false,
          error: "Wallet creation service not available. Please provide your own wallet address.",
          timestamp: Date.now(),
        });
        return;
      }

      try {
        // Generate a unique identifier for this agent
        const agentIdentifier = `auto_${client.id}_${Date.now()}`;

        logger.info(`Creating automatic wallet for agent: ${name || client.id}`);

        const result = await privyWalletService.createAgentWallet(agentIdentifier);

        if (result) {
          // Authenticate the client with the new wallet
          client.address = result.address;
          client.name = name || `Agent-${result.address.slice(0, 8)}`;
          client.isAgent = true;

          // Track in stats
          this.getOrCreateAgentStats(result.address, client.name);

          logger.info(`Auto-created wallet for agent ${client.name}: ${result.address}`);

          // Send success response with the new wallet
          this.send(client, {
            type: "server:wallet_assigned",
            success: true,
            address: result.address,
            userId: result.userId,
            timestamp: Date.now(),
          });

          // Also send authenticated confirmation
          this.send(client, {
            type: "server:authenticated",
            success: true,
            address: result.address,
            name: client.name,
            isNewWallet: true,
            timestamp: Date.now(),
          });
        } else {
          this.send(client, {
            type: "server:wallet_assigned",
            success: false,
            error: "Failed to create wallet. Please try again or provide your own wallet address.",
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        logger.error("Error creating automatic wallet:", error);
        this.send(client, {
          type: "server:wallet_assigned",
          success: false,
          error: error instanceof Error ? error.message : "Unknown error creating wallet",
          timestamp: Date.now(),
        });
      }
      return;
    }

    // No address and no wallet request - authenticate as spectator
    this.handleAuthenticate(client, undefined, name);
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
      // Join as player - enforce both room.maxPlayers and global limit
      const effectiveMaxPlayers = Math.min(room.maxPlayers, MAX_PLAYERS_PER_ROOM);
      if (room.players.length >= effectiveMaxPlayers) {
        this.sendError(client, "ROOM_FULL", `Room is full (max ${effectiveMaxPlayers} players)`);
        return;
      }

      // Check if agent has wagered (in-memory first, then on-chain)
      const hasInMemoryWager = wagerService.hasWagered(roomId, client.address || "");
      if (!hasInMemoryWager) {
        // Check on-chain wager asynchronously
        this.checkOnChainWagerAndJoin(client, room, roomId, colorId);
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
      logger.info(`Player ${client.name} joined room ${roomId} (color: ${playerState.colorId}, wagered)`);

      // Broadcast player joined to room
      this.broadcastToRoom(roomId, {
        type: "server:player_joined",
        gameId: roomId,
        player: playerState,
      });

      // Trigger auto-start logic
      this.onPlayerJoinedRoom(roomId);
    }

    // Send current room state to the joining client
    this.send(client, { type: "server:room_update", room });

    // Broadcast room list update
    this.broadcastRoomList();
  }

  /**
   * Check on-chain wager and complete join if valid
   */
  private async checkOnChainWagerAndJoin(
    client: Client,
    room: RoomState,
    roomId: string,
    colorId?: number
  ): Promise<void> {
    try {
      // Check on-chain wager
      const hasOnChainWager = await contractService.hasWagered(roomId, client.address || "");

      if (hasOnChainWager) {
        logger.info(`Player ${client.name} has on-chain wager for room ${roomId}`);

        // Sync to in-memory tracker
        wagerService.syncOnChainWager(roomId, client.address || "");

        // Complete the join
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
        logger.info(`Player ${client.name} joined room ${roomId} (color: ${playerState.colorId}, on-chain wager verified)`);

        // Broadcast player joined to room
        this.broadcastToRoom(roomId, {
          type: "server:player_joined",
          gameId: roomId,
          player: playerState,
        });

        // Send room state to joining client
        this.send(client, { type: "server:room_update", room });

        // Trigger auto-start logic
        this.onPlayerJoinedRoom(roomId);
      } else {
        // No wager found - send wager required message
        this.send(client, {
          type: "server:wager_required",
          gameId: roomId,
          amount: wagerService.getWagerAmount().toString(),
          currentBalance: wagerService.getBalance(client.address || "").toString(),
          canAfford: wagerService.canAffordWager(client.address || ""),
          vaultAddress: contractService.getVaultAddress() || "",
          timestamp: Date.now(),
        });
        logger.info(`Player ${client.name} needs to wager before joining room ${roomId}`);
      }
    } catch (error) {
      logger.error(`Error checking on-chain wager for ${client.name}:`, error);
      // Fall back to in-memory check failure
      this.send(client, {
        type: "server:wager_required",
        gameId: roomId,
        amount: wagerService.getWagerAmount().toString(),
        currentBalance: wagerService.getBalance(client.address || "").toString(),
        canAfford: wagerService.canAffordWager(client.address || ""),
        vaultAddress: contractService.getVaultAddress() || "",
        timestamp: Date.now(),
      });
    }
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

    // Don't delete rooms when empty - keep them visible for reconnecting
    // Only delete rooms that have ended (handled in endGame)
    // But clean up extended state if the game ended and no one is in the room
    if (room.players.length === 0 && room.spectators.length === 0 && room.phase === "ended") {
      this.rooms.delete(roomId);
      this.extendedState.delete(roomId);
      logger.info(`Room ${roomId} deleted (ended and empty)`);
    }

    this.broadcastRoomList();
  }

  private startGameInternal(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    if (room.players.length < MIN_PLAYERS_TO_START) {
      logger.warn(`Cannot start ${roomId}: only ${room.players.length} players`);
      return;
    }

    room.phase = "playing";

    // Assign impostors randomly
    const impostorCount = Math.min(room.impostorCount, Math.floor(room.players.length / 3));
    const impostorIndices = new Set<number>();
    while (impostorIndices.size < impostorCount) {
      impostorIndices.add(Math.floor(Math.random() * room.players.length));
    }

    const impostorAddresses: string[] = [];
    for (const idx of impostorIndices) {
      impostorAddresses.push(room.players[idx].address);
    }

    // Find the slot for this room
    const slot = this.roomSlots.find(s => s.roomId === roomId);
    const slotId = slot?.id ?? -1;

    // Initialize extended room state
    const extended: ExtendedRoomState = {
      ...room,
      impostors: new Set(impostorAddresses.map(a => a.toLowerCase())),
      votes: new Map(),
      deadBodies: [],
      currentRound: 1,
      currentPhase: 2, // ActionCommit
      phaseTimer: null,
      slotId,
    };
    this.extendedState.set(roomId, extended);

    // Also register with GameStateManager
    this.gameStateManager.getOrCreateGame(roomId);
    this.gameStateManager.assignImpostors(roomId, impostorAddresses);

    // Assign tasks to players (locations 1-8, excluding cafeteria which is 0)
    for (const player of room.players) {
      if (!extended.impostors.has(player.address.toLowerCase())) {
        const taskLocations = this.generateTaskLocations(5);
        this.gameStateManager.assignTasks(roomId, player.address, taskLocations);
      }
    }

    logger.info(`Game started in room ${roomId} with ${room.players.length} players, ${impostorCount} impostors: ${impostorAddresses.join(", ")}`);

    // Persist game start to database (background)
    const wagerAmount = wagerService.getWagerAmount();
    databaseService.startGame(roomId, room.players.map(p => ({
      walletAddress: p.address,
      isImpostor: extended.impostors.has(p.address.toLowerCase()),
      colorId: p.colorId,
      wagerAmount,
    })));

    // Create game on-chain (async, don't block game flow)
    const playerAddresses = room.players.map(p => p.address);
    contractService.createGame(roomId, playerAddresses, impostorAddresses)
      .then(success => {
        if (success) {
          logger.info(`Game ${roomId} created on-chain successfully`);
        } else {
          logger.warn(`Failed to create game ${roomId} on-chain (continuing in off-chain mode)`);
        }
      })
      .catch(err => {
        logger.error(`Error creating game ${roomId} on-chain:`, err);
      });

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

  private generateTaskLocations(count: number): number[] {
    const locations: number[] = [];
    const available = [1, 2, 3, 4, 5, 6, 7, 8]; // All rooms except Cafeteria
    for (let i = 0; i < count && available.length > 0; i++) {
      const idx = Math.floor(Math.random() * available.length);
      locations.push(available.splice(idx, 1)[0]);
    }
    return locations;
  }

  private handlePositionUpdate(client: Client, roomId: string, location: Location, round: number): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const player = room.players.find((p) => p.address === client.address);
    if (!player) return;

    const previousLocation = player.location;

    // Validate movement (skip if same location)
    if (previousLocation !== location) {
      const validation = this.gameStateManager.validateMovement(
        roomId,
        client.address!,
        previousLocation,
        location,
        false // not a vent
      );

      if (!validation.valid) {
        this.send(client, {
          type: "server:error",
          code: "INVALID_MOVE",
          message: validation.reason || "Invalid movement",
        });
        return;
      }
    }

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
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return;

    // Validate killer is an impostor
    if (!this.gameStateManager.isImpostor(roomId, killer)) {
      this.send(client, {
        type: "server:error",
        code: "KILL_NOT_IMPOSTOR",
        message: "Only impostors can kill",
      });
      return;
    }

    // Check kill cooldown
    if (!this.gameStateManager.canKill(roomId, killer, round)) {
      const cooldown = this.gameStateManager.getKillCooldown(roomId, killer, round);
      this.send(client, {
        type: "server:error",
        code: "KILL_COOLDOWN",
        message: `Kill on cooldown. Wait ${cooldown} more round(s).`,
      });
      return;
    }

    const victimPlayer = room.players.find((p) => p.address === victim);
    if (victimPlayer) {
      victimPlayer.isAlive = false;
    }

    // Track dead body
    const body: DeadBodyState = {
      victim,
      location,
      round,
      reported: false,
    };
    extended.deadBodies.push(body);

    // Record kill for cooldown tracking
    this.gameStateManager.recordKill(roomId, killer, round);

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

    // Record kill for agent stats
    this.recordKill(killer);

    // Check win condition
    this.checkAndHandleWinCondition(roomId);
  }

  private handleVote(client: Client, roomId: string, voter: string, target: string | null, round: number): void {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return;

    // Only accept votes during voting phase
    if (extended.currentPhase !== 5) {
      logger.warn(`Vote rejected: not in voting phase (current: ${extended.currentPhase})`);
      return;
    }

    const voterPlayer = room.players.find((p) => p.address === voter);
    if (!voterPlayer || !voterPlayer.isAlive) return;

    // Record the vote
    extended.votes.set(voter.toLowerCase(), target ? target.toLowerCase() : null);
    voterPlayer.hasVoted = true;

    this.broadcastToRoom(roomId, {
      type: "server:vote_cast",
      gameId: roomId,
      voter,
      target,
      round,
      timestamp: Date.now(),
    });

    // Check if all votes are in
    const alivePlayers = room.players.filter(p => p.isAlive);
    const votedCount = alivePlayers.filter(p => p.hasVoted).length;

    if (votedCount >= alivePlayers.length) {
      // All votes are in, resolve immediately
      if (extended.phaseTimer) {
        clearTimeout(extended.phaseTimer);
        extended.phaseTimer = null;
      }
      this.resolveVoting(roomId);
    }
  }

  private handleTaskComplete(client: Client, roomId: string, player: string, tasksCompleted: number, totalTasks: number, location?: Location): void {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return;

    // Only allow during ActionCommit phase
    if (extended.currentPhase !== 2) {
      return;
    }

    const playerState = room.players.find((p) => p.address === player);
    if (!playerState) return;

    // Impostors cannot complete real tasks (they can only fake)
    if (this.gameStateManager.isImpostor(roomId, player)) {
      this.send(client, {
        type: "server:error",
        code: "IMPOSTOR_CANNOT_TASK",
        message: "Impostors cannot complete real tasks",
      });
      return;
    }

    // Both alive crewmates and ghost crewmates can complete tasks
    playerState.tasksCompleted = tasksCompleted;
    playerState.totalTasks = totalTasks;

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

    // Check if all tasks are done
    if (progress >= 100) {
      this.endGame(roomId, true, "tasks");
    }
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
    const stats = this.getStats();
    for (const client of this.clients.values()) {
      this.send(client, { type: "server:room_list", rooms: roomList, stats });
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

  // ============ BODY REPORTING ============

  private handleReportBody(client: Client, roomId: string, reporter: string, bodyLocation: Location, round: number): void {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return;

    // Only allow during ActionCommit phase
    if (extended.currentPhase !== 2) {
      this.send(client, {
        type: "server:error",
        code: "INVALID_PHASE",
        message: "Can only report bodies during action phase",
      });
      return;
    }

    // Validate reporter is alive
    const reporterPlayer = room.players.find(
      p => p.address.toLowerCase() === reporter.toLowerCase()
    );
    if (!reporterPlayer || !reporterPlayer.isAlive) {
      this.send(client, {
        type: "server:error",
        code: "REPORTER_DEAD",
        message: "Dead players cannot report bodies",
      });
      return;
    }

    // Validate reporter is at the body location
    if (reporterPlayer.location !== bodyLocation) {
      this.send(client, {
        type: "server:error",
        code: "NOT_AT_BODY",
        message: "You must be at the body's location to report it",
      });
      return;
    }

    // Find unreported body at this location
    const body = extended.deadBodies.find(
      b => b.location === bodyLocation && !b.reported
    );

    if (!body) {
      this.send(client, {
        type: "server:error",
        code: "NO_BODY",
        message: "No unreported body at this location",
      });
      return;
    }

    // Mark body as reported
    body.reported = true;

    // Broadcast body reported
    this.broadcastToRoom(roomId, {
      type: "server:body_reported",
      gameId: roomId,
      reporter,
      victim: body.victim,
      location: bodyLocation,
      round,
      timestamp: Date.now(),
    });

    logger.info(`Body reported in room ${roomId}: ${reporter} found ${body.victim}`);

    // Start discussion phase
    this.startDiscussionPhase(roomId);
  }

  private handleCallMeeting(client: Client, roomId: string): void {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return;

    if (!client.address) {
      this.send(client, {
        type: "server:error",
        code: "NOT_AUTHENTICATED",
        message: "Must be authenticated to call meeting",
      });
      return;
    }

    // Only allow during ActionCommit phase
    if (extended.currentPhase !== 2) {
      this.send(client, {
        type: "server:error",
        code: "INVALID_PHASE",
        message: "Can only call meetings during action phase",
      });
      return;
    }

    // Check if player can call meeting
    const canCall = this.gameStateManager.canCallMeeting(roomId, client.address);
    if (!canCall.canCall) {
      this.send(client, {
        type: "server:error",
        code: "CANNOT_CALL_MEETING",
        message: canCall.reason || "Cannot call emergency meeting",
      });
      return;
    }

    // Use the meeting
    const remaining = this.gameStateManager.useEmergencyMeeting(roomId, client.address);

    // Broadcast meeting called
    this.broadcastToRoom(roomId, {
      type: "server:meeting_called",
      gameId: roomId,
      caller: client.address,
      meetingsRemaining: remaining,
      timestamp: Date.now(),
    });

    logger.info(`Emergency meeting called in room ${roomId} by ${client.address}`);

    // Start discussion phase
    this.startDiscussionPhase(roomId);
  }

  private handleChat(client: Client, roomId: string, message: string): void {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return;

    if (!client.address) {
      this.send(client, {
        type: "server:error",
        code: "NOT_AUTHENTICATED",
        message: "Must be authenticated to chat",
      });
      return;
    }

    // Only allow during Discussion or Voting phase
    if (extended.currentPhase !== 4 && extended.currentPhase !== 5) {
      this.send(client, {
        type: "server:error",
        code: "INVALID_PHASE",
        message: "Chat is only available during discussion and voting phases",
      });
      return;
    }

    // Find sender player
    const senderPlayer = room.players.find(
      p => p.address.toLowerCase() === client.address!.toLowerCase()
    );
    if (!senderPlayer) return;

    // Sanitize message (limit length, remove dangerous content)
    const sanitizedMessage = message.slice(0, 200).trim();
    if (!sanitizedMessage) return;

    const isGhostChat = !senderPlayer.isAlive;
    const senderName = client.name || client.address.slice(0, 8);

    // Broadcast to appropriate players
    if (isGhostChat) {
      // Ghost chat - only send to other dead players and spectators
      for (const [clientId, targetClient] of this.clients) {
        if (targetClient.roomId !== roomId) continue;

        const targetPlayer = room.players.find(
          p => p.address?.toLowerCase() === targetClient.address?.toLowerCase()
        );

        // Send to dead players or spectators (non-players)
        if (!targetPlayer || !targetPlayer.isAlive) {
          this.send(targetClient, {
            type: "server:chat",
            gameId: roomId,
            sender: client.address,
            senderName,
            message: sanitizedMessage,
            isGhostChat: true,
            timestamp: Date.now(),
          });
        }
      }
    } else {
      // Living player chat - broadcast to everyone
      this.broadcastToRoom(roomId, {
        type: "server:chat",
        gameId: roomId,
        sender: client.address,
        senderName,
        message: sanitizedMessage,
        isGhostChat: false,
        timestamp: Date.now(),
      });
    }

    logger.debug(`Chat in room ${roomId} from ${senderName}: ${sanitizedMessage.slice(0, 50)}...`);
  }

  // ============ SABOTAGE SYSTEM ============

  private handleSabotage(client: Client, roomId: string, sabotageType: SabotageType): void {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return;

    if (!client.address) {
      this.send(client, {
        type: "server:error",
        code: "NOT_AUTHENTICATED",
        message: "Must be authenticated to sabotage",
      });
      return;
    }

    // Only allow during ActionCommit phase
    if (extended.currentPhase !== 2) {
      this.send(client, {
        type: "server:error",
        code: "INVALID_PHASE",
        message: "Can only sabotage during action phase",
      });
      return;
    }

    // Check if can sabotage
    const canSabotage = this.gameStateManager.canSabotage(roomId, client.address);
    if (!canSabotage.canSabotage) {
      this.send(client, {
        type: "server:error",
        code: "CANNOT_SABOTAGE",
        message: canSabotage.reason || "Cannot sabotage",
      });
      return;
    }

    // Get sabotage config
    const config = this.gameStateManager.getSabotageConfig(sabotageType);
    if (!config) {
      this.send(client, {
        type: "server:error",
        code: "INVALID_SABOTAGE",
        message: "Invalid sabotage type",
      });
      return;
    }

    // Start sabotage
    const sabotage = this.gameStateManager.startSabotage(roomId, client.address, sabotageType);
    if (!sabotage) {
      this.send(client, {
        type: "server:error",
        code: "SABOTAGE_FAILED",
        message: "Failed to start sabotage",
      });
      return;
    }

    // Broadcast sabotage started
    this.broadcastToRoom(roomId, {
      type: "server:sabotage_started",
      gameId: roomId,
      sabotageType,
      sabotager: client.address,
      timeLimit: config.timeLimit,
      fixLocations: config.fixLocations as Location[],
      timestamp: Date.now(),
    });

    logger.info(`Sabotage started in room ${roomId}: type ${sabotageType} by ${client.address}`);

    // Set up critical sabotage timer
    if (config.isCritical && config.timeLimit > 0) {
      setTimeout(() => {
        this.checkCriticalSabotage(roomId);
      }, config.timeLimit * 1000);
    }
  }

  private handleFixSabotage(client: Client, roomId: string, location: Location): void {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return;

    if (!client.address) {
      this.send(client, {
        type: "server:error",
        code: "NOT_AUTHENTICATED",
        message: "Must be authenticated to fix sabotage",
      });
      return;
    }

    // Only allow during ActionCommit phase
    if (extended.currentPhase !== 2) {
      this.send(client, {
        type: "server:error",
        code: "INVALID_PHASE",
        message: "Can only fix sabotage during action phase",
      });
      return;
    }

    // Get player and verify they're alive and at the right location
    const player = room.players.find(
      p => p.address.toLowerCase() === client.address!.toLowerCase()
    );
    if (!player || !player.isAlive) {
      this.send(client, {
        type: "server:error",
        code: "PLAYER_DEAD",
        message: "Dead players cannot fix sabotage",
      });
      return;
    }

    if (player.location !== location) {
      this.send(client, {
        type: "server:error",
        code: "WRONG_LOCATION",
        message: "Must be at the fix location to repair sabotage",
      });
      return;
    }

    // Attempt to fix
    const sabotage = this.gameStateManager.getActiveSabotage(roomId);
    if (!sabotage) {
      this.send(client, {
        type: "server:error",
        code: "NO_SABOTAGE",
        message: "No active sabotage to fix",
      });
      return;
    }

    const result = this.gameStateManager.fixSabotage(roomId, client.address, location);

    if (result.fixed) {
      // Sabotage fully fixed
      this.broadcastToRoom(roomId, {
        type: "server:sabotage_fixed",
        gameId: roomId,
        sabotageType: sabotage.type as SabotageType,
        fixedBy: client.address,
        location,
        timestamp: Date.now(),
      });
      logger.info(`Sabotage fixed in room ${roomId} by ${client.address}`);
    } else if (result.partialFix) {
      // Partial fix (e.g., for Reactor)
      logger.debug(`Partial sabotage fix in room ${roomId} by ${client.address} at location ${location}`);
    } else if (result.reason) {
      this.send(client, {
        type: "server:error",
        code: "FIX_FAILED",
        message: result.reason,
      });
    }
  }

  private checkCriticalSabotage(roomId: string): void {
    const timedOut = this.gameStateManager.checkSabotageTimeout(roomId);
    if (timedOut) {
      const sabotage = this.gameStateManager.getActiveSabotage(roomId);
      if (sabotage) {
        // Impostors win by critical sabotage
        this.broadcastToRoom(roomId, {
          type: "server:sabotage_failed",
          gameId: roomId,
          sabotageType: sabotage.type as SabotageType,
          reason: "timeout",
          timestamp: Date.now(),
        });
        logger.info(`Critical sabotage timed out in room ${roomId} - Impostors win`);
        this.endGame(roomId, false, "kills"); // Impostors win
      }
    }
  }

  // ============ VENT SYSTEM ============

  private handleVent(client: Client, roomId: string, action: "enter" | "exit" | "move", targetLocation?: Location): void {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return;

    if (!client.address) {
      this.send(client, {
        type: "server:error",
        code: "NOT_AUTHENTICATED",
        message: "Must be authenticated to use vents",
      });
      return;
    }

    // Only allow during ActionCommit phase
    if (extended.currentPhase !== 2) {
      this.send(client, {
        type: "server:error",
        code: "INVALID_PHASE",
        message: "Can only use vents during action phase",
      });
      return;
    }

    // Get player
    const player = room.players.find(
      p => p.address.toLowerCase() === client.address!.toLowerCase()
    );
    if (!player || !player.isAlive) {
      this.send(client, {
        type: "server:error",
        code: "PLAYER_DEAD",
        message: "Dead players cannot use vents",
      });
      return;
    }

    const currentLocation = player.location;

    switch (action) {
      case "enter": {
        const canEnter = this.gameStateManager.canEnterVent(roomId, client.address, currentLocation);
        if (!canEnter.canEnter) {
          this.send(client, {
            type: "server:error",
            code: "CANNOT_VENT",
            message: canEnter.reason || "Cannot enter vent",
          });
          return;
        }

        this.gameStateManager.enterVent(roomId, client.address);

        // Broadcast to impostors and spectators only
        this.broadcastVentAction(roomId, client.address, "enter", currentLocation);
        logger.info(`Player ${client.address} entered vent at ${currentLocation} in room ${roomId}`);
        break;
      }

      case "exit": {
        if (!this.gameStateManager.isInVent(roomId, client.address)) {
          this.send(client, {
            type: "server:error",
            code: "NOT_IN_VENT",
            message: "Not currently in a vent",
          });
          return;
        }

        this.gameStateManager.exitVent(roomId, client.address);

        // Broadcast to impostors and spectators only
        this.broadcastVentAction(roomId, client.address, "exit", currentLocation);
        logger.info(`Player ${client.address} exited vent at ${currentLocation} in room ${roomId}`);
        break;
      }

      case "move": {
        if (!this.gameStateManager.isInVent(roomId, client.address)) {
          this.send(client, {
            type: "server:error",
            code: "NOT_IN_VENT",
            message: "Must be in a vent to move between vents",
          });
          return;
        }

        if (targetLocation === undefined) {
          this.send(client, {
            type: "server:error",
            code: "NO_TARGET",
            message: "Must specify target vent location",
          });
          return;
        }

        // Validate vent connection
        const validation = this.gameStateManager.validateMovement(
          roomId,
          client.address,
          currentLocation,
          targetLocation,
          true // isVent = true
        );

        if (!validation.valid) {
          this.send(client, {
            type: "server:error",
            code: "INVALID_VENT",
            message: validation.reason || "Cannot move to that vent",
          });
          return;
        }

        // Update player location
        player.location = targetLocation;

        // Broadcast to impostors and spectators only
        this.broadcastVentAction(roomId, client.address, "move", currentLocation, targetLocation);
        logger.info(`Player ${client.address} moved through vent from ${currentLocation} to ${targetLocation} in room ${roomId}`);
        break;
      }
    }
  }

  private broadcastVentAction(
    roomId: string,
    player: string,
    action: "enter" | "exit" | "move",
    fromLocation: Location,
    toLocation?: Location
  ): void {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return;

    const message = {
      type: "server:player_vented" as const,
      gameId: roomId,
      player,
      action,
      fromLocation,
      toLocation,
      timestamp: Date.now(),
    };

    // Only send to impostors and spectators (not crewmates)
    for (const [clientId, targetClient] of this.clients) {
      if (targetClient.roomId !== roomId) continue;

      const isImpostor = targetClient.address &&
        extended.impostors.has(targetClient.address.toLowerCase());
      const isSpectator = !targetClient.address ||
        !room.players.find(p => p.address.toLowerCase() === targetClient.address?.toLowerCase());

      if (isImpostor || isSpectator) {
        this.send(targetClient, message);
      }
    }
  }

  // ============ CAMERA SYSTEM ============

  private handleUseCameras(client: Client, roomId: string, action: "start" | "stop"): void {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return;

    if (!client.address) {
      this.send(client, {
        type: "server:error",
        code: "NOT_AUTHENTICATED",
        message: "Must be authenticated to use cameras",
      });
      return;
    }

    // Only allow during ActionCommit phase
    if (extended.currentPhase !== 2) {
      this.send(client, {
        type: "server:error",
        code: "INVALID_PHASE",
        message: "Can only use cameras during action phase",
      });
      return;
    }

    // Get player and verify they're alive and at Security
    const player = room.players.find(
      p => p.address.toLowerCase() === client.address!.toLowerCase()
    );
    if (!player || !player.isAlive) {
      this.send(client, {
        type: "server:error",
        code: "PLAYER_DEAD",
        message: "Dead players cannot use cameras",
      });
      return;
    }

    // Must be at Security (location 7) to use cameras
    if (player.location !== 7) {
      this.send(client, {
        type: "server:error",
        code: "WRONG_LOCATION",
        message: "Must be at Security to use cameras",
      });
      return;
    }

    if (action === "start") {
      this.gameStateManager.startWatchingCameras(roomId, client.address);

      // Send initial camera feed
      this.sendCameraFeed(client, roomId);

      logger.info(`Player ${client.address} started watching cameras in room ${roomId}`);
    } else {
      this.gameStateManager.stopWatchingCameras(roomId, client.address);
      logger.info(`Player ${client.address} stopped watching cameras in room ${roomId}`);
    }

    // Broadcast camera status change (red light indicator)
    this.broadcastCameraStatus(roomId);
  }

  private sendCameraFeed(client: Client, roomId: string): void {
    const playersVisible = this.gameStateManager.getPlayersOnCameras(roomId);

    this.send(client, {
      type: "server:camera_feed",
      gameId: roomId,
      playersVisible: playersVisible.map(p => ({
        address: p.address,
        location: p.location as Location,
        isAlive: p.isAlive,
      })),
      timestamp: Date.now(),
    });
  }

  private broadcastCameraStatus(roomId: string): void {
    const camerasInUse = this.gameStateManager.areCamerasInUse(roomId);
    const watcherCount = this.gameStateManager.getCameraWatcherCount(roomId);

    this.broadcastToRoom(roomId, {
      type: "server:camera_status",
      gameId: roomId,
      camerasInUse,
      watcherCount,
      timestamp: Date.now(),
    });
  }

  // ============ PHASE MANAGEMENT ============

  private startDiscussionPhase(roomId: string): void {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return;

    // Clear any existing timer
    if (extended.phaseTimer) {
      clearTimeout(extended.phaseTimer);
    }

    // Clear any active sabotage (meetings reset sabotages)
    this.gameStateManager.clearSabotage(roomId);

    // Force all players out of vents
    this.gameStateManager.clearAllVents(roomId);

    // Stop all camera watchers
    this.gameStateManager.clearAllCameraWatchers(roomId);

    const previousPhase = extended.currentPhase;
    extended.currentPhase = 4; // Discussion

    const phaseEndTime = Date.now() + DISCUSSION_DURATION;

    this.broadcastToRoom(roomId, {
      type: "server:phase_changed",
      gameId: roomId,
      phase: 4,
      previousPhase,
      round: extended.currentRound,
      phaseEndTime,
      timestamp: Date.now(),
    });

    logger.info(`Discussion phase started in room ${roomId}`);

    // Set timer to transition to voting
    extended.phaseTimer = setTimeout(() => {
      this.startVotingPhase(roomId);
    }, DISCUSSION_DURATION);
  }

  private startVotingPhase(roomId: string): void {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return;

    // Clear any existing timer
    if (extended.phaseTimer) {
      clearTimeout(extended.phaseTimer);
    }

    const previousPhase = extended.currentPhase;
    extended.currentPhase = 5; // Voting

    // Initialize voting
    extended.votes.clear();
    for (const player of room.players) {
      player.hasVoted = false;
    }

    const phaseEndTime = Date.now() + VOTING_DURATION;

    this.broadcastToRoom(roomId, {
      type: "server:phase_changed",
      gameId: roomId,
      phase: 5,
      previousPhase,
      round: extended.currentRound,
      phaseEndTime,
      timestamp: Date.now(),
    });

    logger.info(`Voting phase started in room ${roomId}`);

    // Set timer to resolve voting
    extended.phaseTimer = setTimeout(() => {
      this.resolveVoting(roomId);
    }, VOTING_DURATION);
  }

  private resolveVoting(roomId: string): void {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return;

    // Clear any existing timer
    if (extended.phaseTimer) {
      clearTimeout(extended.phaseTimer);
      extended.phaseTimer = null;
    }

    // Tally votes
    const voteCounts = new Map<string, number>();
    let skipCount = 0;

    for (const target of extended.votes.values()) {
      if (target === null) {
        skipCount++;
      } else {
        voteCounts.set(target, (voteCounts.get(target) || 0) + 1);
      }
    }

    // Find max votes
    let maxVotes = skipCount;
    let ejected: string | null = null;
    let isTie = false;

    for (const [target, count] of voteCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        ejected = target;
        isTie = false;
      } else if (count === maxVotes && ejected !== null) {
        isTie = true;
      }
    }

    if (isTie) {
      ejected = null;
      logger.info(`Voting tie in room ${roomId}, no ejection`);
    }

    const previousPhase = extended.currentPhase;
    extended.currentPhase = 6; // VoteResult

    // Eject player if there was a majority
    let wasImpostor = false;
    if (ejected) {
      const ejectedPlayer = room.players.find(
        p => p.address.toLowerCase() === ejected!.toLowerCase()
      );
      if (ejectedPlayer) {
        ejectedPlayer.isAlive = false;
        wasImpostor = extended.impostors.has(ejected.toLowerCase());
      }

      this.broadcastToRoom(roomId, {
        type: "server:player_ejected",
        gameId: roomId,
        ejected,
        wasImpostor,
        round: extended.currentRound,
        timestamp: Date.now(),
      });

      logger.info(`Player ejected in room ${roomId}: ${ejected} (${wasImpostor ? "Impostor" : "Crewmate"})`);
    }

    // Check win condition
    const winResult = this.checkWinCondition(roomId);
    if (winResult.winner) {
      // Delay game end to show ejection
      setTimeout(() => {
        this.endGame(roomId, winResult.winner === "crewmates", winResult.reason!);
      }, EJECTION_DURATION);
      return;
    }

    // Return to ActionCommit phase after ejection screen
    setTimeout(() => {
      this.returnToActionPhase(roomId);
    }, EJECTION_DURATION);
  }

  private returnToActionPhase(roomId: string): void {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return;

    // Clear bodies that were reported
    extended.deadBodies = extended.deadBodies.filter(b => !b.reported);

    // Increment round
    extended.currentRound++;

    const previousPhase = extended.currentPhase;
    extended.currentPhase = 2; // ActionCommit

    // Reset vote states
    extended.votes.clear();
    for (const player of room.players) {
      player.hasVoted = false;
    }

    this.broadcastToRoom(roomId, {
      type: "server:phase_changed",
      gameId: roomId,
      phase: 2,
      previousPhase,
      round: extended.currentRound,
      phaseEndTime: Date.now() + 60000,
      timestamp: Date.now(),
    });

    logger.info(`Returned to ActionCommit phase in room ${roomId}, round ${extended.currentRound}`);
  }

  // ============ WIN CONDITIONS ============

  private checkWinCondition(roomId: string): WinConditionResult {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return { winner: null };

    const alivePlayers = room.players.filter(p => p.isAlive);
    const aliveImpostors = alivePlayers.filter(p => extended.impostors.has(p.address.toLowerCase()));
    const aliveCrewmates = alivePlayers.filter(p => !extended.impostors.has(p.address.toLowerCase()));

    // Impostors win if they equal or outnumber crewmates
    if (aliveImpostors.length >= aliveCrewmates.length && aliveCrewmates.length > 0) {
      logger.info(`Win condition: Impostors (${aliveImpostors.length}) >= Crewmates (${aliveCrewmates.length})`);
      return { winner: "impostors", reason: "kills" };
    }

    // Crewmates win if all impostors are ejected
    if (aliveImpostors.length === 0) {
      logger.info(`Win condition: All impostors eliminated`);
      return { winner: "crewmates", reason: "votes" };
    }

    // Crewmates win if all tasks are completed
    const totalTasksCompleted = room.players.reduce((sum, p) => sum + p.tasksCompleted, 0);
    const totalTasksRequired = room.players.reduce((sum, p) => sum + p.totalTasks, 0);

    if (totalTasksRequired > 0 && totalTasksCompleted >= totalTasksRequired) {
      logger.info(`Win condition: All tasks completed (${totalTasksCompleted}/${totalTasksRequired})`);
      return { winner: "crewmates", reason: "tasks" };
    }

    return { winner: null };
  }

  private checkAndHandleWinCondition(roomId: string): void {
    const winResult = this.checkWinCondition(roomId);
    if (winResult.winner) {
      this.endGame(roomId, winResult.winner === "crewmates", winResult.reason!);
    }
  }

  private endGame(roomId: string, crewmatesWon: boolean, reason: "tasks" | "votes" | "kills"): void {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room) return;

    // Clear any timers
    if (extended?.phaseTimer) {
      clearTimeout(extended.phaseTimer);
      extended.phaseTimer = null;
    }

    // Record game stats for all players BEFORE changing phase
    this.recordGameEnd(roomId, crewmatesWon);

    // Distribute wager winnings
    const winners: string[] = [];
    const losers: string[] = [];

    for (const player of room.players) {
      const isImpostor = extended?.impostors.has(player.address.toLowerCase()) ?? false;
      const playerWon = (crewmatesWon && !isImpostor) || (!crewmatesWon && isImpostor);

      if (playerWon) {
        winners.push(player.address);
      } else {
        losers.push(player.address);
      }
    }

    const wagerResult = wagerService.distributeWinnings(roomId, winners, losers);
    const totalPot = wagerService.getGamePot(roomId);

    // Settle game on-chain (async, don't block game flow)
    const playerAddresses = room.players.map(p => p.address);
    const playerKills = room.players.map(p => {
      const stats = this.agentStats.get(p.address.toLowerCase());
      return stats?.kills ?? 0;
    });
    const playerTasks = room.players.map(p => p.tasksCompleted);

    // Persist game end to database (background)
    databaseService.endGame(roomId, {
      crewmatesWon,
      winReason: reason,
      winners,
      playerStats: room.players.map(p => ({
        walletAddress: p.address,
        kills: this.agentStats.get(p.address.toLowerCase())?.kills ?? 0,
        tasksCompleted: p.tasksCompleted,
        isAlive: p.isAlive,
      })),
      winningsPerPlayer: wagerResult.winningsPerPlayer,
    });

    contractService.settleGame(roomId, crewmatesWon, winners, playerAddresses, playerKills, playerTasks)
      .then(success => {
        if (success) {
          logger.info(`Game ${roomId} settled on-chain successfully`);
          // Update database with settlement tx hash
          // (would need to modify settleGame to return tx hash)
        } else {
          logger.warn(`Failed to settle game ${roomId} on-chain`);
        }
      })
      .catch(err => {
        logger.error(`Error settling game ${roomId} on-chain:`, err);
      });

    room.phase = "ended";
    if (extended) {
      extended.currentPhase = 7; // Ended
    }

    // Find slot
    const slotId = extended?.slotId ?? this.roomSlots.findIndex(s => s.roomId === roomId);

    // Broadcast game ended with wager info
    this.broadcastToRoom(roomId, {
      type: "server:game_ended",
      gameId: roomId,
      crewmatesWon,
      reason,
      winners,
      losers,
      totalPot: totalPot.toString(),
      winningsPerPlayer: wagerResult.winningsPerPlayer.toString(),
      timestamp: Date.now(),
    });

    // Send individual balance updates to each player
    for (const player of room.players) {
      const client = this.findClientByAddress(player.address);
      if (client) {
        this.send(client, {
          type: "server:balance",
          address: player.address,
          balance: wagerService.getBalance(player.address).toString(),
          wagerAmount: wagerService.getWagerAmount().toString(),
          timestamp: Date.now(),
        });
      }
    }

    logger.info(`Game ended in room ${roomId}: ${crewmatesWon ? "Crewmates" : "Impostors"} win by ${reason}. Pot: ${totalPot.toString()} distributed to ${winners.length} winners.`);

    // Start cooldown for this slot after a short delay (let players see the end screen)
    setTimeout(() => {
      if (slotId >= 0) {
        this.deleteRoomAndCooldown(slotId);
      } else {
        // Fallback: just delete the room
        this.rooms.delete(roomId);
        this.extendedState.delete(roomId);
        this.broadcastRoomList();
      }
    }, 10000); // 10 second delay before cooldown starts
  }

  // ============ HELPER METHODS ============

  getExtendedState(roomId: string): ExtendedRoomState | undefined {
    return this.extendedState.get(roomId);
  }

  getStats() {
    let totalAgents = 0;
    let totalSpectators = 0;
    let totalPlayers = 0;
    let activeGames = 0;
    let lobbyRooms = 0;

    for (const client of this.clients.values()) {
      if (client.isAgent) {
        totalAgents++;
      } else {
        totalSpectators++;
      }
    }

    for (const room of this.rooms.values()) {
      totalPlayers += room.players.length;
      if (room.phase === "playing") {
        activeGames++;
      } else if (room.phase === "lobby") {
        lobbyRooms++;
      }
    }

    // Build slot info with cooldown times
    const slots = this.roomSlots.map(slot => ({
      id: slot.id,
      state: slot.state,
      roomId: slot.roomId,
      cooldownEndTime: slot.cooldownEndTime,
      cooldownRemaining: slot.cooldownEndTime ? Math.max(0, slot.cooldownEndTime - Date.now()) : null,
    }));

    return {
      connections: {
        total: this.clients.size,
        agents: totalAgents,
        spectators: totalSpectators
      },
      rooms: {
        total: this.rooms.size,
        maxRooms: MAX_ROOMS,
        lobby: lobbyRooms,
        playing: activeGames,
        totalPlayers
      },
      limits: {
        maxRooms: MAX_ROOMS,
        maxPlayersPerRoom: MAX_PLAYERS_PER_ROOM,
        minPlayersToStart: MIN_PLAYERS_TO_START,
        fillWaitDuration: FILL_WAIT_DURATION,
        cooldownDuration: COOLDOWN_DURATION,
      },
      slots,
    };
  }

  // Get all rooms (for external access)
  getRooms(): RoomState[] {
    return Array.from(this.rooms.values());
  }

  // Get a specific room by ID
  getRoom(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId);
  }

  // Get agent stats by address (for external access)
  getAgentStats(address: string): AgentStats | undefined {
    return this.agentStats.get(address.toLowerCase());
  }

  // ============ AGENT STATS & LEADERBOARD ============

  private getOrCreateAgentStats(address: string, name?: string): AgentStats {
    const key = address.toLowerCase();
    let stats = this.agentStats.get(key);
    if (!stats) {
      stats = {
        address: key,
        name: name || address.slice(0, 8),
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        kills: 0,
        tasksCompleted: 0,
        timesImpostor: 0,
        timesCrewmate: 0,
        lastSeen: Date.now(),
      };
      this.agentStats.set(key, stats);
    }
    // Update name if provided
    if (name) {
      stats.name = name;
    }
    stats.lastSeen = Date.now();
    return stats;
  }

  private recordKill(killerAddress: string): void {
    const stats = this.getOrCreateAgentStats(killerAddress);
    stats.kills++;
    logger.info(`Kill recorded for ${stats.name}: ${stats.kills} total kills`);
  }

  private recordGameEnd(roomId: string, crewmatesWon: boolean): void {
    const room = this.rooms.get(roomId);
    const extended = this.extendedState.get(roomId);
    if (!room || !extended) return;

    for (const player of room.players) {
      const stats = this.getOrCreateAgentStats(player.address);
      stats.gamesPlayed++;

      const isImpostor = extended.impostors.has(player.address.toLowerCase());

      if (isImpostor) {
        stats.timesImpostor++;
        if (!crewmatesWon) {
          stats.wins++;
        } else {
          stats.losses++;
        }
      } else {
        stats.timesCrewmate++;
        stats.tasksCompleted += player.tasksCompleted;
        if (crewmatesWon) {
          stats.wins++;
        } else {
          stats.losses++;
        }
      }
    }

    logger.info(`Game stats recorded for ${room.players.length} players in room ${roomId}`);
    this.broadcastLeaderboard();
  }

  getLeaderboard(limit: number = 10): AgentStats[] {
    const allStats = Array.from(this.agentStats.values());

    // Sort by wins, then by win rate, then by games played
    allStats.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      const aWinRate = a.gamesPlayed > 0 ? a.wins / a.gamesPlayed : 0;
      const bWinRate = b.gamesPlayed > 0 ? b.wins / b.gamesPlayed : 0;
      if (bWinRate !== aWinRate) return bWinRate - aWinRate;
      return b.gamesPlayed - a.gamesPlayed;
    });

    return allStats.slice(0, limit);
  }

  private broadcastLeaderboard(): void {
    const leaderboard = this.getLeaderboard(10);
    const message: ServerMessage = {
      type: "server:leaderboard",
      agents: leaderboard,
      timestamp: Date.now(),
    };
    for (const client of this.clients.values()) {
      this.send(client, message);
    }
  }

  // Delete a room manually (for admin purposes or cleanup)
  deleteRoom(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    // Clear any timers
    const extended = this.extendedState.get(roomId);
    if (extended?.phaseTimer) {
      clearTimeout(extended.phaseTimer);
    }

    // Cancel game on-chain if it was playing
    if (room.phase === "playing") {
      contractService.cancelGame(roomId)
        .then(success => {
          if (success) {
            logger.info(`Game ${roomId} cancelled on-chain (manual delete)`);
          }
        })
        .catch(err => {
          logger.error(`Error cancelling game ${roomId} on-chain:`, err);
        });
    }

    // Notify all clients in the room
    this.broadcastToRoom(roomId, {
      type: "server:error",
      code: "ROOM_DELETED",
      message: "Room has been deleted",
    });

    // Remove all clients from the room
    for (const player of room.players) {
      const client = this.findClientByAddress(player.address);
      if (client) {
        client.roomId = undefined;
      }
    }
    for (const specId of room.spectators) {
      const client = this.clients.get(specId);
      if (client) {
        client.roomId = undefined;
      }
    }

    this.rooms.delete(roomId);
    this.extendedState.delete(roomId);
    this.broadcastRoomList();
    logger.info(`Room ${roomId} manually deleted`);
    return true;
  }

  // ============ OPERATOR / PRIVY HANDLERS ============

  private async handleCreateAgent(client: Client, operatorKey: string): Promise<void> {
    if (!privyWalletService.isEnabled()) {
      this.send(client, {
        type: "server:agent_created",
        success: false,
        error: "Privy wallet service not configured. Set PRIVY_APP_ID and PRIVY_APP_SECRET.",
        timestamp: Date.now(),
      });
      return;
    }

    // Validate operator key format
    if (!operatorKey || !operatorKey.startsWith("oper_")) {
      this.send(client, {
        type: "server:agent_created",
        success: false,
        error: "Invalid operator key format. Must start with 'oper_'",
        timestamp: Date.now(),
      });
      return;
    }

    try {
      const result = await privyWalletService.createAgentWallet(operatorKey);

      if (result) {
        this.send(client, {
          type: "server:agent_created",
          success: true,
          agentAddress: result.address,
          userId: result.userId,
          timestamp: Date.now(),
        });
        logger.info(`Agent wallet created for operator ${operatorKey}: ${result.address}`);
      } else {
        this.send(client, {
          type: "server:agent_created",
          success: false,
          error: "Failed to create agent wallet",
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      logger.error("Error creating agent wallet:", error);
      this.send(client, {
        type: "server:agent_created",
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: Date.now(),
      });
    }
  }

  private handleListAgents(client: Client, operatorKey: string): void {
    // Validate operator key format
    if (!operatorKey || !operatorKey.startsWith("oper_")) {
      this.send(client, {
        type: "server:agent_list",
        agents: [],
        timestamp: Date.now(),
      });
      return;
    }

    const agents = privyWalletService.getAgentWalletsForOperator(operatorKey);

    this.send(client, {
      type: "server:agent_list",
      agents: agents.map((a) => ({
        address: a.address,
        userId: a.userId,
        createdAt: a.createdAt,
      })),
      timestamp: Date.now(),
    });
  }

  private handleWithdrawRequest(client: Client, operatorKey: string, agentAddress: string, amount?: string): void {
    // Validate operator key format
    if (!operatorKey || !operatorKey.startsWith("oper_")) {
      this.send(client, {
        type: "server:withdraw_result",
        success: false,
        agentAddress,
        error: "Invalid operator key",
        timestamp: Date.now(),
      });
      return;
    }

    // Verify operator owns this agent
    const agents = privyWalletService.getAgentWalletsForOperator(operatorKey);
    const ownsAgent = agents.some(a => a.address.toLowerCase() === agentAddress.toLowerCase());

    if (!ownsAgent) {
      this.send(client, {
        type: "server:withdraw_result",
        success: false,
        agentAddress,
        error: "Agent not owned by this operator",
        timestamp: Date.now(),
      });
      return;
    }

    // Get agent's balance
    const balance = wagerService.getBalance(agentAddress);
    if (balance <= BigInt(0)) {
      this.send(client, {
        type: "server:withdraw_result",
        success: false,
        agentAddress,
        error: "No balance to withdraw",
        timestamp: Date.now(),
      });
      return;
    }

    // For now, just return success - actual on-chain withdrawal would go here
    // In production, this would trigger a Privy wallet transfer
    logger.info(`Withdraw request: ${agentAddress} for ${amount || "max"} (balance: ${balance})`);

    this.send(client, {
      type: "server:withdraw_result",
      success: true,
      agentAddress,
      txHash: "pending_implementation",
      timestamp: Date.now(),
    });
  }

  // ============ WAGER HANDLERS ============

  /**
   * Handle deposit request
   * In production, this would be triggered by on-chain deposit events
   * For now, agents can self-deposit for testing
   */
  private handleDeposit(client: Client, amount: string): void {
    if (!client.address) {
      this.sendError(client, "NOT_AUTHENTICATED", "Must authenticate before depositing");
      return;
    }

    try {
      const amountBigInt = BigInt(amount);
      if (amountBigInt <= 0) {
        this.sendError(client, "INVALID_AMOUNT", "Deposit amount must be positive");
        return;
      }

      wagerService.deposit(client.address, amountBigInt);

      const balance = wagerService.getBalance(client.address);

      this.send(client, {
        type: "server:deposit_confirmed",
        address: client.address,
        amount: amount,
        newBalance: balance.toString(),
        timestamp: Date.now(),
      });

      logger.info(`Deposit confirmed for ${client.address}: ${amount} wei`);
    } catch (error) {
      this.sendError(client, "DEPOSIT_FAILED", "Invalid deposit amount");
    }
  }

  /**
   * Handle wager submission to join a game
   */
  private handleSubmitWager(client: Client, gameId: string): void {
    if (!client.address) {
      this.sendError(client, "NOT_AUTHENTICATED", "Must authenticate before wagering");
      return;
    }

    const room = this.rooms.get(gameId);
    if (!room) {
      this.sendError(client, "ROOM_NOT_FOUND", `Room ${gameId} not found`);
      return;
    }

    if (room.phase !== "lobby") {
      this.sendError(client, "GAME_STARTED", "Cannot wager after game has started");
      return;
    }

    // Submit wager
    const result = wagerService.submitWager(gameId, client.address);

    if (!result.success) {
      this.send(client, {
        type: "server:wager_failed",
        gameId,
        error: result.error || "Wager failed",
        requiredAmount: wagerService.getWagerAmount().toString(),
        currentBalance: wagerService.getBalance(client.address).toString(),
        timestamp: Date.now(),
      });
      return;
    }

    // Wager accepted
    this.send(client, {
      type: "server:wager_accepted",
      gameId,
      amount: wagerService.getWagerAmount().toString(),
      newBalance: wagerService.getBalance(client.address).toString(),
      totalPot: wagerService.getGamePot(gameId).toString(),
      timestamp: Date.now(),
    });

    // Broadcast updated pot to room
    this.broadcastToRoom(gameId, {
      type: "server:pot_updated",
      gameId,
      totalPot: wagerService.getGamePot(gameId).toString(),
      playerCount: wagerService.getGameWager(gameId)?.wagers.size || 0,
      timestamp: Date.now(),
    });

    logger.info(`Wager accepted for ${client.address} in game ${gameId}`);
  }

  /**
   * Handle balance query
   */
  private handleGetBalance(client: Client): void {
    if (!client.address) {
      this.sendError(client, "NOT_AUTHENTICATED", "Must authenticate to check balance");
      return;
    }

    const balanceInfo = wagerService.getBalanceInfo(client.address);

    this.send(client, {
      type: "server:balance",
      address: client.address,
      balance: wagerService.getBalance(client.address).toString(),
      totalDeposited: balanceInfo?.totalDeposited.toString() || "0",
      totalWon: balanceInfo?.totalWon.toString() || "0",
      totalLost: balanceInfo?.totalLost.toString() || "0",
      wagerAmount: wagerService.getWagerAmount().toString(),
      timestamp: Date.now(),
    });
  }
}
