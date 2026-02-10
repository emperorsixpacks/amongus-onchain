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

  // Create agent wallet
  async createAgent(operatorKey: string): Promise<{
    success: boolean;
    agentAddress?: string;
    userId?: string;
    error?: string;
  }> {
    const res = await fetch(`${API_URL}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operatorKey }),
    });
    return res.json();
  },

  // List agents for operator
  async listAgents(operatorKey: string): Promise<{ agents: AgentWallet[]; count: number }> {
    const res = await fetch(`${API_URL}/api/agents?operatorKey=${encodeURIComponent(operatorKey)}`);
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

  // Get or create operator key for a wallet
  async getOrCreateOperatorKey(walletAddress: string): Promise<{
    operatorKey: string;
    walletAddress: string;
    createdAt: number;
  }> {
    // First try to get existing
    let res = await fetch(`${API_URL}/api/operators/${walletAddress}`);

    if (res.status === 404) {
      // Create new
      res = await fetch(`${API_URL}/api/operators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress }),
      });
    }

    if (!res.ok) throw new Error("Failed to get operator key");
    return res.json();
  },

  // Get operator key by wallet
  async getOperatorKey(walletAddress: string): Promise<{
    operatorKey: string;
    walletAddress: string;
    createdAt: number;
  } | null> {
    const res = await fetch(`${API_URL}/api/operators/${walletAddress}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("Failed to get operator key");
    return res.json();
  },

  // Validate operator key
  async validateOperatorKey(operatorKey: string): Promise<{
    valid: boolean;
    walletAddress?: string;
  }> {
    const res = await fetch(`${API_URL}/api/operators/validate/${operatorKey}`);
    if (res.status === 404) return { valid: false };
    if (!res.ok) throw new Error("Failed to validate operator key");
    return res.json();
  },
};
