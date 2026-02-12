/**
 * HTTP API Client for Among Us On-Chain
 * Provides read access to game data via the HTTP API
 */

import * as winston from "winston";

// ============ RESPONSE TYPES ============

export interface RoomPlayer {
  address: string;
  colorId: number;
  location: number;
  isAlive: boolean;
  tasksCompleted: number;
  totalTasks: number;
  hasVoted: boolean;
}

export interface RoomInfo {
  roomId: string;
  players: RoomPlayer[];
  spectators: string[];
  maxPlayers: number;
  impostorCount: number;
  phase: "lobby" | "playing" | "ended";
  createdAt: number;
}

export interface RoomSlotInfo {
  id: number;
  state: "active" | "cooldown" | "empty";
  roomId: string | null;
  cooldownEndTime: number | null;
  cooldownRemaining: number | null;
}

export interface ServerStats {
  connections: {
    total: number;
    agents: number;
    spectators: number;
  };
  rooms: {
    total: number;
    maxRooms: number;
    lobby: number;
    playing: number;
    totalPlayers: number;
  };
  limits: {
    maxRooms: number;
    maxPlayersPerRoom: number;
    minPlayersToStart: number;
    fillWaitDuration: number;
    cooldownDuration: number;
  };
  slots: RoomSlotInfo[];
}

export interface ServerAgentStats {
  address: string;
  name: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  kills: number;
  tasksCompleted: number;
  timesImpostor: number;
  timesCrewmate: number;
  lastSeen: number;
}

export interface RoomsResponse {
  rooms: RoomInfo[];
  stats: ServerStats;
}

export interface LeaderboardResponse {
  agents: ServerAgentStats[];
  timestamp: number;
}

export interface AgentStatsResponse extends ServerAgentStats {
  timestamp: number;
}

export interface ServerInfoResponse {
  name: string;
  version: string;
  uptime: number;
  limits: ServerStats["limits"];
  timestamp: number;
}

// ============ CLIENT CONFIG ============

export interface HttpApiClientConfig {
  apiUrl: string;
  agentName?: string;
  timeout?: number;
}

// ============ CLIENT CLASS ============

export class HttpApiClient {
  private config: HttpApiClientConfig;
  private logger: winston.Logger;

  constructor(config: HttpApiClientConfig, logger?: winston.Logger) {
    this.config = {
      timeout: 10000,
      ...config,
    };

    this.logger = logger || winston.createLogger({
      level: "info",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [${config.agentName || "HttpApi"}] ${level.toUpperCase()}: ${message}`;
        })
      ),
      transports: [new winston.transports.Console()],
    });
  }

  /**
   * Make HTTP request with timeout
   */
  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.config.apiUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json() as T;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Request timeout after ${this.config.timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ============ ROOM ENDPOINTS ============

  /**
   * Get all rooms and server statistics
   */
  async getRooms(): Promise<RoomsResponse> {
    this.logger.debug("Fetching rooms...");
    const data = await this.request<RoomsResponse>("/api/rooms");
    this.logger.debug(`Found ${data.rooms.length} rooms`);
    return data;
  }

  /**
   * Get a specific room by ID
   */
  async getRoom(roomId: string): Promise<RoomInfo> {
    this.logger.debug(`Fetching room ${roomId}...`);
    return await this.request<RoomInfo>(`/api/rooms/${roomId}`);
  }

  /**
   * Find a lobby room to join
   * Returns the first available lobby room, or null if none
   */
  async findLobbyRoom(): Promise<RoomInfo | null> {
    const { rooms } = await this.getRooms();
    const lobby = rooms.find(r => r.phase === "lobby");
    if (lobby) {
      this.logger.info(`Found lobby room: ${lobby.roomId} (${lobby.players.length}/${lobby.maxPlayers} players)`);
    } else {
      this.logger.info("No lobby rooms available");
    }
    return lobby || null;
  }

  // ============ LEADERBOARD ENDPOINTS ============

  /**
   * Get leaderboard (top agents by wins)
   */
  async getLeaderboard(limit: number = 10): Promise<LeaderboardResponse> {
    this.logger.debug(`Fetching leaderboard (limit: ${limit})...`);
    return await this.request<LeaderboardResponse>(`/api/leaderboard?limit=${limit}`);
  }

  /**
   * Get stats for a specific agent
   */
  async getAgentStats(address: string): Promise<AgentStatsResponse> {
    this.logger.debug(`Fetching stats for ${address.slice(0, 10)}...`);
    return await this.request<AgentStatsResponse>(`/api/agents/${address}/stats`);
  }

  // ============ SERVER ENDPOINTS ============

  /**
   * Get server info and configuration
   */
  async getServerInfo(): Promise<ServerInfoResponse> {
    this.logger.debug("Fetching server info...");
    return await this.request<ServerInfoResponse>("/api/server");
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request<{ status: string }>("/health");
      return true;
    } catch {
      return false;
    }
  }

  // ============ UTILITY METHODS ============

  /**
   * Wait for a lobby room to become available
   * Polls the API at the specified interval
   */
  async waitForLobbyRoom(pollInterval: number = 5000, maxWait: number = 300000): Promise<RoomInfo | null> {
    const startTime = Date.now();
    this.logger.info("Waiting for a lobby room to become available...");

    while (Date.now() - startTime < maxWait) {
      const lobby = await this.findLobbyRoom();
      if (lobby) {
        return lobby;
      }

      // Check if any slots are in cooldown
      const { stats } = await this.getRooms();
      const cooldownSlot = stats.slots.find(s => s.state === "cooldown" && s.cooldownRemaining);
      if (cooldownSlot && cooldownSlot.cooldownRemaining) {
        const mins = Math.ceil(cooldownSlot.cooldownRemaining / 60000);
        this.logger.info(`Slot ${cooldownSlot.id + 1} in cooldown, ~${mins} min remaining`);
      }

      await this.sleep(pollInterval);
    }

    this.logger.warn(`Timeout waiting for lobby room after ${maxWait}ms`);
    return null;
  }

  /**
   * Get the current game slots status
   */
  async getSlotsStatus(): Promise<RoomSlotInfo[]> {
    const { stats } = await this.getRooms();
    return stats.slots;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
