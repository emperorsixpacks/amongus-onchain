const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// Types
export interface RoomInfo {
  roomId: string;
  players: Array<{
    address: string;
    colorId: number;
    isAlive: boolean;
  }>;
  spectators: number;
  maxPlayers: number;
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

export interface AgentStats {
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

export interface AgentWallet {
  address: string;
  userId: string;
  createdAt: number;
}

// API Client
export const api = {
  // Get all rooms and stats
  async getRooms(): Promise<{ rooms: RoomInfo[]; stats: ServerStats }> {
    const res = await fetch(`${API_URL}/api/rooms`);
    if (!res.ok) throw new Error("Failed to fetch rooms");
    return res.json();
  },

  // Get specific room
  async getRoom(roomId: string): Promise<RoomInfo> {
    const res = await fetch(`${API_URL}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error("Room not found");
    return res.json();
  },

  // Get leaderboard
  async getLeaderboard(limit = 10): Promise<{ agents: AgentStats[]; timestamp: number }> {
    const res = await fetch(`${API_URL}/api/leaderboard?limit=${limit}`);
    if (!res.ok) throw new Error("Failed to fetch leaderboard");
    return res.json();
  },

  // Get agent stats
  async getAgentStats(address: string): Promise<AgentStats> {
    const res = await fetch(`${API_URL}/api/agents/${address}/stats`);
    if (!res.ok) throw new Error("Agent not found");
    return res.json();
  },

  // Create agent wallet (requires operator key auth)
  async createAgent(operatorKey: string): Promise<{
    success: boolean;
    agentAddress?: string;
    userId?: string;
    error?: string;
  }> {
    const res = await fetch(`${API_URL}/api/agents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${operatorKey}`,
      },
    });
    return res.json();
  },

  // List agents for operator (requires operator key auth)
  async listAgents(operatorKey: string): Promise<{ agents: AgentWallet[]; count: number }> {
    const res = await fetch(`${API_URL}/api/agents`, {
      headers: {
        Authorization: `Bearer ${operatorKey}`,
      },
    });
    if (!res.ok) throw new Error("Failed to fetch agents");
    return res.json();
  },

  // Get server info
  async getServerInfo(): Promise<{
    version: string;
    privy: { enabled: boolean };
    limits: ServerStats["limits"];
    connections: ServerStats["connections"];
    rooms: ServerStats["rooms"];
  }> {
    const res = await fetch(`${API_URL}/api/server`);
    if (!res.ok) throw new Error("Failed to fetch server info");
    return res.json();
  },

  // Health check
  async healthCheck(): Promise<{ status: string; timestamp: number }> {
    const res = await fetch(`${API_URL}/health`);
    if (!res.ok) throw new Error("Server unavailable");
    return res.json();
  },

  // Register an operator key (user provides their own key)
  async registerOperatorKey(
    operatorKey: string,
    walletAddress: string
  ): Promise<{
    success: boolean;
    walletAddress: string;
    createdAt: number;
    error?: string;
  }> {
    const res = await fetch(`${API_URL}/api/operators`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${operatorKey}`,
      },
      body: JSON.stringify({ walletAddress }),
    });

    if (res.status === 409) {
      return { success: false, walletAddress, createdAt: 0, error: "Key already registered" };
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Registration failed" }));
      throw new Error(data.error || "Failed to register operator key");
    }
    return res.json();
  },

  // Validate operator key (check if authenticated)
  async validateOperatorKey(operatorKey: string): Promise<{
    valid: boolean;
    walletAddress?: string;
    createdAt?: number;
  }> {
    const res = await fetch(`${API_URL}/api/operators/me`, {
      headers: {
        Authorization: `Bearer ${operatorKey}`,
      },
    });
    if (res.status === 401) return { valid: false };
    if (!res.ok) throw new Error("Failed to validate operator key");
    return res.json();
  },
};
