import WebSocket from "ws";
import type { Address } from "viem";
import * as winston from "winston";
import {
  Location,
  ActionType,
  GamePhase,
  Action,
} from "../types.js";

// ============ MESSAGE TYPES ============

export interface AgentAuthenticateMessage {
  type: "agent:authenticate";
  address: string;
}

export interface AgentJoinGameMessage {
  type: "agent:join_game";
  gameId: string;
  colorId: number;
}

export interface AgentLeaveGameMessage {
  type: "agent:leave_game";
  gameId: string;
}

// New relay server protocol messages
export interface ClientJoinRoomMessage {
  type: "client:join_room";
  roomId: string;
  colorId?: number;
  asSpectator?: boolean;
}

export interface ClientLeaveRoomMessage {
  type: "client:leave_room";
  roomId: string;
}

export interface AgentPositionUpdateMessage {
  type: "agent:position_update";
  gameId: string;
  location: Location;
  round: number;
}

export interface AgentActionResultMessage {
  type: "agent:action_result";
  gameId: string;
  actionType: ActionType;
  target?: string;
  destination?: Location;
  round: number;
}

export interface AgentPhaseChangeMessage {
  type: "agent:phase_change";
  gameId: string;
  phase: GamePhase;
  round: number;
  phaseEndTime: number;
}

export interface AgentKillMessage {
  type: "agent:kill";
  gameId: string;
  killer: string;
  victim: string;
  location: Location;
  round: number;
}

export interface AgentVoteMessage {
  type: "agent:vote";
  gameId: string;
  voter: string;
  target: string | null;
  round: number;
}

export interface AgentTaskCompleteMessage {
  type: "agent:task_complete";
  gameId: string;
  player: string;
  tasksCompleted: number;
  totalTasks: number;
}

type AgentMessage =
  | AgentAuthenticateMessage
  | AgentJoinGameMessage
  | AgentLeaveGameMessage
  | AgentPositionUpdateMessage
  | AgentActionResultMessage
  | AgentPhaseChangeMessage
  | AgentKillMessage
  | AgentVoteMessage
  | AgentTaskCompleteMessage
  | ClientJoinRoomMessage
  | ClientLeaveRoomMessage;

// Server message types (for receiving)
export interface ServerWelcomeMessage {
  type: "server:welcome";
  connectionId: string;
  timestamp: number;
}

export interface ServerErrorMessage {
  type: "server:error";
  code: string;
  message: string;
}

export type ServerMessage = ServerWelcomeMessage | ServerErrorMessage | { type: string; [key: string]: any };

// ============ CLIENT CLASS ============

export interface WebSocketClientConfig {
  serverUrl: string;
  agentAddress: Address;
  agentName: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private config: WebSocketClientConfig;
  private logger: winston.Logger;
  private connectionId: string | null = null;
  private currentGameId: string | null = null;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private shouldReconnect: boolean = true;

  constructor(config: WebSocketClientConfig, logger?: winston.Logger) {
    this.config = {
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      ...config,
    };

    this.logger = logger || winston.createLogger({
      level: "info",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [${config.agentName}:WS] ${level.toUpperCase()}: ${message}`;
        })
      ),
      transports: [new winston.transports.Console()],
    });
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.serverUrl);

        this.ws.on("open", () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.logger.info(`Connected to ${this.config.serverUrl}`);

          // Authenticate immediately
          this.authenticate();
          resolve();
        });

        this.ws.on("message", (data) => {
          this.handleMessage(data.toString());
        });

        this.ws.on("close", () => {
          this.isConnected = false;
          this.connectionId = null;
          this.logger.info("Disconnected from server");

          if (this.shouldReconnect) {
            this.attemptReconnect();
          }
        });

        this.ws.on("error", (error) => {
          this.logger.error(`WebSocket error: ${error.message}`);
          if (!this.isConnected) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.connectionId = null;
    this.currentGameId = null;
    this.logger.info("Disconnected");
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts || 10)) {
      this.logger.error("Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;
    this.logger.info(
      `Reconnecting in ${this.config.reconnectInterval}ms (attempt ${this.reconnectAttempts})`
    );

    setTimeout(() => {
      this.connect().catch((error) => {
        this.logger.error(`Reconnect failed: ${error.message}`);
      });
    }, this.config.reconnectInterval);
  }

  /**
   * Handle incoming message from server
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as ServerMessage;

      switch (message.type) {
        case "server:welcome":
          this.connectionId = (message as ServerWelcomeMessage).connectionId;
          this.logger.info(`Received welcome, connectionId: ${this.connectionId}`);
          break;

        case "server:error":
          const errorMsg = message as ServerErrorMessage;
          this.logger.error(`Server error: ${errorMsg.code} - ${errorMsg.message}`);
          break;

        default:
          this.logger.debug(`Received: ${message.type}`);
      }
    } catch (error) {
      this.logger.error(`Failed to parse message: ${error}`);
    }
  }

  /**
   * Send message to server
   */
  private send(message: AgentMessage): boolean {
    if (!this.ws || !this.isConnected) {
      this.logger.warn("Cannot send: not connected");
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.logger.error(`Failed to send message: ${error}`);
      return false;
    }
  }

  /**
   * Authenticate with server
   */
  private authenticate(): void {
    this.send({
      type: "agent:authenticate",
      address: this.config.agentAddress,
    });
  }

  /**
   * Join a game room
   */
  joinGame(gameId: bigint, colorId: number): void {
    const gameIdStr = gameId.toString();
    this.currentGameId = gameIdStr;
    this.send({
      type: "agent:join_game",
      gameId: gameIdStr,
      colorId,
    });
    this.logger.info(`Joined game room: ${gameIdStr}`);
  }

  /**
   * Leave current game room
   */
  leaveGame(): void {
    if (this.currentGameId) {
      this.send({
        type: "agent:leave_game",
        gameId: this.currentGameId,
      });
      this.logger.info(`Left game room: ${this.currentGameId}`);
      this.currentGameId = null;
    }
  }

  /**
   * Join a room using the relay server protocol
   * Use this for WebSocket relay server rooms (not on-chain games)
   */
  joinRoom(roomId: string, colorId?: number): void {
    this.currentGameId = roomId;
    this.send({
      type: "client:join_room",
      roomId,
      colorId,
      asSpectator: false,
    });
    this.logger.info(`Joining room: ${roomId}`);
  }

  /**
   * Leave a room using the relay server protocol
   */
  leaveRoom(): void {
    if (this.currentGameId) {
      this.send({
        type: "client:leave_room",
        roomId: this.currentGameId,
      });
      this.logger.info(`Left room: ${this.currentGameId}`);
      this.currentGameId = null;
    }
  }

  /**
   * Send position update after reveal
   */
  sendPositionUpdate(location: Location, round: bigint): void {
    if (!this.currentGameId) {
      this.logger.warn("Cannot send position update: not in a game");
      return;
    }

    this.send({
      type: "agent:position_update",
      gameId: this.currentGameId,
      location,
      round: Number(round),
    });
  }

  /**
   * Send action result after reveal
   */
  sendActionResult(action: Action, round: bigint): void {
    if (!this.currentGameId) {
      this.logger.warn("Cannot send action result: not in a game");
      return;
    }

    this.send({
      type: "agent:action_result",
      gameId: this.currentGameId,
      actionType: action.type,
      target: action.target,
      destination: action.destination,
      round: Number(round),
    });
  }

  /**
   * Send phase change notification
   */
  sendPhaseChange(phase: GamePhase, round: bigint, phaseEndTime: bigint): void {
    if (!this.currentGameId) return;

    this.send({
      type: "agent:phase_change",
      gameId: this.currentGameId,
      phase,
      round: Number(round),
      phaseEndTime: Number(phaseEndTime),
    });
  }

  /**
   * Send kill notification
   */
  sendKill(killer: Address, victim: Address, location: Location, round: bigint): void {
    if (!this.currentGameId) return;

    this.send({
      type: "agent:kill",
      gameId: this.currentGameId,
      killer,
      victim,
      location,
      round: Number(round),
    });
  }

  /**
   * Send vote notification
   */
  sendVote(voter: Address, target: Address | null, round: bigint): void {
    if (!this.currentGameId) return;

    this.send({
      type: "agent:vote",
      gameId: this.currentGameId,
      voter,
      target,
      round: Number(round),
    });
  }

  /**
   * Send task completion notification
   */
  sendTaskComplete(player: Address, tasksCompleted: number, totalTasks: number): void {
    if (!this.currentGameId) return;

    this.send({
      type: "agent:task_complete",
      gameId: this.currentGameId,
      player,
      tasksCompleted,
      totalTasks,
    });
  }

  /**
   * Check if connected
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get connection ID
   */
  getConnectionId(): string | null {
    return this.connectionId;
  }

  /**
   * Get current game ID
   */
  getCurrentGameId(): string | null {
    return this.currentGameId;
  }
}
