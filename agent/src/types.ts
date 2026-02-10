// ============ ENUMS (Mirror Solidity) ============

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

export enum ActionType {
  None = 0,
  Move = 1,
  DoTask = 2,
  FakeTask = 3,
  Kill = 4,
  Report = 5,
  CallMeeting = 6,
  Vent = 7,
  Sabotage = 8,
  UseCams = 9,
  Skip = 10,
}

export enum SabotageType {
  None = 0,
  Lights = 1,
  Reactor = 2,
  O2 = 3,
  Comms = 4,
}

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

export enum MessageType {
  Accuse = 0,
  Defend = 1,
  Vouch = 2,
  Info = 3,
}

export enum AccuseReason {
  NearBody = 0,
  NoTasks = 1,
  SuspiciousMovement = 2,
  SawVent = 3,
  Inconsistent = 4,
  Following = 5,
  SelfReport = 6,
}

// ============ INTERFACES ============

export interface Player {
  address: `0x${string}`;
  colorId: number;
  role: Role;
  location: Location;
  isAlive: boolean;
  tasksCompleted: number;
  totalTasks: number;
  wagerAmount: bigint;
  hasVoted: boolean;
  lastActionRound: bigint;
}

export interface DeadBody {
  victim: `0x${string}`;
  location: Location;
  round: bigint;
  reported: boolean;
}

export interface GameConfig {
  minPlayers: number;
  maxPlayers: number;
  numImpostors: number;
  wagerAmount: bigint;
  actionTimeout: bigint;
  voteTimeout: bigint;
  discussionTime: bigint;
  tasksPerPlayer: number;
  visualTasks: boolean;
  emergencyMeetings: number;
  killCooldown: bigint;
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
  sabotageEndTime: bigint;
  winner: `0x${string}`;
  crewmatesWon: boolean;
}

export interface DiscussionMessage {
  sender: `0x${string}`;
  msgType: MessageType;
  target: `0x${string}`;
  reason: AccuseReason;
  location: Location;
  timestamp: bigint;
}

export interface Vote {
  voter: `0x${string}`;
  suspect: `0x${string}`;
  timestamp: bigint;
}

// ============ ACTION TYPES ============

export interface Action {
  type: ActionType;
  target?: `0x${string}`;
  destination?: Location;
  taskId?: number;
  sabotage?: SabotageType;
}

export interface ActionCommitment {
  hash: `0x${string}`;
  action: Action;
  salt: `0x${string}`;
}

// ============ AGENT TYPES ============

export interface AgentConfig {
  privateKey: `0x${string}`;
  rpcUrl: string;
  factoryAddress: `0x${string}`;
  agentName: string;
  strategyType: "crewmate" | "impostor" | "adaptive";
  riskTolerance: number; // 0-100
  maxWagerPerGame: bigint;
  minBankroll: bigint;
}


export interface AgentStats {
  gamesPlayed: number;
  gamesWon: number;
  gamesAsCrewmate: number;
  gamesAsImpostor: number;
  crewmateWins: number;
  impostorWins: number;
  totalKills: number;
  tasksCompleted: number;
  correctAccusations: number;
  timesEjected: number;
  rating: number;
  totalWagered: bigint;
  totalWinnings: bigint;
}

export interface SuspicionScore {
  address: `0x${string}`;
  score: number;
  reasons: SuspicionReason[];
}

export interface SuspicionReason {
  type: AccuseReason;
  weight: number;
  round: bigint;
  details?: string;
}

// ============ MAP DATA ============

export const AdjacentRooms: Record<Location, Location[]> = {
  [Location.Cafeteria]: [Location.Admin, Location.MedBay, Location.UpperEngine],
  [Location.Admin]: [Location.Cafeteria, Location.Storage],
  [Location.Storage]: [Location.Admin, Location.Electrical, Location.LowerEngine],
  [Location.Electrical]: [Location.Storage, Location.LowerEngine],
  [Location.MedBay]: [Location.Cafeteria, Location.UpperEngine, Location.Security],
  [Location.UpperEngine]: [Location.Cafeteria, Location.MedBay, Location.Reactor],
  [Location.LowerEngine]: [Location.Storage, Location.Electrical, Location.Security],
  [Location.Security]: [Location.MedBay, Location.LowerEngine, Location.Reactor],
  [Location.Reactor]: [Location.UpperEngine, Location.Security],
};

export const VentConnections: Record<Location, Location | null> = {
  [Location.Cafeteria]: Location.Admin,
  [Location.Admin]: Location.Cafeteria,
  [Location.Storage]: null,
  [Location.Electrical]: Location.MedBay,
  [Location.MedBay]: Location.Electrical,
  [Location.UpperEngine]: null,
  [Location.LowerEngine]: null,
  [Location.Security]: Location.Reactor,
  [Location.Reactor]: Location.Security,
};

// Rooms with tasks
export const TaskRooms: Location[] = [
  Location.Admin,
  Location.Storage,
  Location.Electrical,
  Location.MedBay,
  Location.UpperEngine,
  Location.LowerEngine,
  Location.Reactor,
];

// Dangerous rooms (isolated, good for kills)
export const DangerousRooms: Location[] = [
  Location.Electrical,
  Location.Reactor,
  Location.Security,
];
