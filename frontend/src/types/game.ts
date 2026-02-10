// Game Types for Among Us On-Chain

export enum Role {
  None = 0,
  Crewmate = 1,
  Impostor = 2,
  Ghost = 3,
}

export enum Location {
  Cafeteria = 0,
  Admin = 1,
  Storage = 2,
  Electrical = 3,
  MedBay = 4,
  UpperEngine = 5,
  LowerEngine = 6,
  Security = 7,
  Reactor = 8,
}

export const LocationNames: Record<Location, string> = {
  [Location.Cafeteria]: "Cafeteria",
  [Location.Admin]: "Admin",
  [Location.Storage]: "Storage",
  [Location.Electrical]: "Electrical",
  [Location.MedBay]: "MedBay",
  [Location.UpperEngine]: "Upper Engine",
  [Location.LowerEngine]: "Lower Engine",
  [Location.Security]: "Security",
  [Location.Reactor]: "Reactor",
};

export enum GamePhase {
  Lobby = 0,
  Starting = 1,
  ActionCommit = 2,
  ActionReveal = 3,
  Discussion = 4,
  Voting = 5,
  VoteResult = 6,
  Ended = 7,
}

export const PhaseNames: Record<GamePhase, string> = {
  [GamePhase.Lobby]: "Lobby",
  [GamePhase.Starting]: "Starting",
  [GamePhase.ActionCommit]: "Action Phase",
  [GamePhase.ActionReveal]: "Revealing",
  [GamePhase.Discussion]: "Discussion",
  [GamePhase.Voting]: "Voting",
  [GamePhase.VoteResult]: "Results",
  [GamePhase.Ended]: "Game Over",
};

export enum SabotageType {
  None = 0,
  Lights = 1,
  Reactor = 2,
  O2 = 3,
  Comms = 4,
}

export interface Player {
  address: `0x${string}`;
  colorId: number;
  role: Role;
  location: Location;
  isAlive: boolean;
  tasksCompleted: number;
  totalTasks: number;
  hasVoted: boolean;
}

export interface GameState {
  gameId: bigint;
  phase: GamePhase;
  round: bigint;
  phaseEndTime: bigint;
  alivePlayers: number;
  aliveCrewmates: number;
  aliveImpostors: number;
  totalTasksCompleted: number;
  totalTasksRequired: number;
  activeSabotage: SabotageType;
  crewmatesWon: boolean;
}

export interface GameConfig {
  minPlayers: number;
  maxPlayers: number;
  numImpostors: number;
  wagerAmount: bigint;
  actionTimeout: bigint;
  tasksPerPlayer: number;
}

export interface DeadBody {
  victim: `0x${string}`;
  location: Location;
  round: bigint;
  reported: boolean;
}

export interface GameLog {
  type: "kill" | "report" | "meeting" | "vote" | "eject" | "task" | "sabotage" | "join" | "start";
  message: string;
  timestamp: number;
  round?: bigint;
}

// Player colors matching Among Us
export const PlayerColors: Record<number, { name: string; hex: string; light: string }> = {
  0: { name: "Red", hex: "#C51111", light: "#FF4D4D" },
  1: { name: "Blue", hex: "#132ED1", light: "#4D6DFF" },
  2: { name: "Green", hex: "#117F2D", light: "#4DFF7F" },
  3: { name: "Pink", hex: "#ED54BA", light: "#FF8DD9" },
  4: { name: "Orange", hex: "#EF7D0D", light: "#FFAB4D" },
  5: { name: "Yellow", hex: "#F5F557", light: "#FFFF8D" },
  6: { name: "Black", hex: "#3F474E", light: "#6B7580" },
  7: { name: "White", hex: "#D6E0F0", light: "#FFFFFF" },
  8: { name: "Purple", hex: "#6B2FBB", light: "#9B5FEB" },
  9: { name: "Brown", hex: "#71491E", light: "#A17B4E" },
  10: { name: "Cyan", hex: "#38FEDC", light: "#7AFFEC" },
  11: { name: "Lime", hex: "#50EF39", light: "#8AFF6D" },
};

// Map layout coordinates for visualization - The Skeld layout
// Layout:
//   Upper Engine ---- MedBay ---- Cafeteria
//        |                            |
//     Reactor                       Admin
//        |                            |
//    Security                      Storage
//        |                            |
//   Lower Engine -- Electrical -------+
//
export const MapLayout: Record<Location, { x: number; y: number; width: number; height: number }> = {
  // Top row
  [Location.UpperEngine]: { x: 50, y: 40, width: 100, height: 80 },
  [Location.MedBay]: { x: 200, y: 40, width: 100, height: 80 },
  [Location.Cafeteria]: { x: 350, y: 40, width: 110, height: 80 },
  // Second row
  [Location.Reactor]: { x: 50, y: 155, width: 100, height: 70 },
  [Location.Admin]: { x: 380, y: 155, width: 80, height: 70 },
  // Third row
  [Location.Security]: { x: 50, y: 260, width: 100, height: 70 },
  [Location.Storage]: { x: 350, y: 260, width: 110, height: 80 },
  // Bottom row
  [Location.LowerEngine]: { x: 50, y: 365, width: 100, height: 70 },
  [Location.Electrical]: { x: 200, y: 365, width: 100, height: 70 },
};

// Room connections for drawing paths - matches The Skeld
export const RoomConnections: [Location, Location][] = [
  // Top horizontal corridor
  [Location.UpperEngine, Location.MedBay],
  [Location.MedBay, Location.Cafeteria],
  // Left vertical corridor (engine column)
  [Location.UpperEngine, Location.Reactor],
  [Location.Reactor, Location.Security],
  [Location.Security, Location.LowerEngine],
  // Right vertical corridor
  [Location.Cafeteria, Location.Admin],
  [Location.Admin, Location.Storage],
  // Bottom horizontal corridor
  [Location.LowerEngine, Location.Electrical],
  [Location.Electrical, Location.Storage],
];

// ============ Lobby Types ============

export enum RoomStatus {
  Open = 0,
  Full = 1,
  InGame = 2,
  Closed = 3,
}

export const RoomStatusNames: Record<RoomStatus, string> = {
  [RoomStatus.Open]: "Open",
  [RoomStatus.Full]: "Full",
  [RoomStatus.InGame]: "In Game",
  [RoomStatus.Closed]: "Closed",
};

export interface Agent {
  address: `0x${string}`;
  name: string;
  balance: bigint;
  isRegistered: boolean;
  colorId: number;
  gamesPlayed: number;
  wins: number;
}

export interface GameRoom {
  roomId: number;
  creator: `0x${string}`;
  players: Agent[];
  wagerAmount: bigint;
  maxPlayers: number;
  status: RoomStatus;
  createdAt: number;
}

export interface LobbyState {
  rooms: GameRoom[];
  currentAgent: Agent | null;
  canCreateRoom: boolean;
  roomCreator: `0x${string}` | null;
  registeredAgents: Agent[];
}

// ============ WebSocket Types ============

export enum AgentConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Authenticating = 'authenticating',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
  Error = 'error',
}

export interface AgentConnectionInfo {
  agentAddress: `0x${string}`;
  state: AgentConnectionState;
  lastHeartbeat: number | null;
  reconnectAttempts: number;
  error: string | null;
}

export interface WebSocketConfig {
  url: string;
  autoReconnect: boolean;
  maxReconnectAttempts: number;
  heartbeatInterval: number;
}

// ============ Test Worker Types ============

export type StrategyType =
  | 'aggressive'
  | 'stealth'
  | 'passive'
  | 'task-focused'
  | 'detective'
  | 'random';

export interface TestAgentConfig {
  colorId: number;
  strategy: StrategyType;
  forcedRole?: 'Crewmate' | 'Impostor';
  name?: string;
}
