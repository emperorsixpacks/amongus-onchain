// WebSocket Message Types for Among Us On-Chain

import { GamePhase, Location, Role, SabotageType, Player, DeadBody } from '@/types/game';

// ============ Connection & Authentication ============

export enum ConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Authenticating = 'authenticating',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
  Error = 'error',
}

export interface AuthPayload {
  agentAddress: `0x${string}`;
  gameId: string;
  signature: string;
  timestamp: number;
}

// ============ Server → Agent Events ============

export enum ServerEventType {
  // Connection
  AUTH_SUCCESS = 'AUTH_SUCCESS',
  AUTH_FAILURE = 'AUTH_FAILURE',
  HEARTBEAT = 'HEARTBEAT',
  ERROR = 'ERROR',

  // Game state
  GAME_STATE_UPDATE = 'GAME_STATE_UPDATE',
  PLAYER_UPDATE = 'PLAYER_UPDATE',
  ROLE_ASSIGNED = 'ROLE_ASSIGNED',

  // Game events
  PLAYER_KILLED = 'PLAYER_KILLED',
  BODY_REPORTED = 'BODY_REPORTED',
  VOTING_STARTED = 'VOTING_STARTED',
  VOTING_RESULT = 'VOTING_RESULT',
  PLAYER_EJECTED = 'PLAYER_EJECTED',
  GAME_ENDED = 'GAME_ENDED',

  // Actions
  ACTION_CONFIRMED = 'ACTION_CONFIRMED',
  ACTION_REJECTED = 'ACTION_REJECTED',
}

export interface AuthSuccessEvent {
  type: ServerEventType.AUTH_SUCCESS;
  agentAddress: `0x${string}`;
  gameId: string;
}

export interface AuthFailureEvent {
  type: ServerEventType.AUTH_FAILURE;
  reason: string;
}

export interface HeartbeatEvent {
  type: ServerEventType.HEARTBEAT;
  timestamp: number;
}

export interface ErrorEvent {
  type: ServerEventType.ERROR;
  code: string;
  message: string;
}

export interface GameStateUpdateEvent {
  type: ServerEventType.GAME_STATE_UPDATE;
  gameId: string;
  phase: GamePhase;
  round: number;
  phaseEndTime: number;
  alivePlayers: number;
  aliveCrewmates: number;
  aliveImpostors: number;
  totalTasksCompleted: number;
  totalTasksRequired: number;
  activeSabotage: SabotageType;
}

export interface PlayerUpdateEvent {
  type: ServerEventType.PLAYER_UPDATE;
  players: Player[];
  deadBodies: DeadBody[];
}

export interface RoleAssignedEvent {
  type: ServerEventType.ROLE_ASSIGNED;
  role: Role;
  teammates?: `0x${string}`[]; // Only for impostors
}

export interface PlayerKilledEvent {
  type: ServerEventType.PLAYER_KILLED;
  victim: `0x${string}`;
  location: Location;
  round: number;
}

export interface BodyReportedEvent {
  type: ServerEventType.BODY_REPORTED;
  reporter: `0x${string}`;
  victim: `0x${string}`;
  location: Location;
}

export interface VotingStartedEvent {
  type: ServerEventType.VOTING_STARTED;
  duration: number;
  alivePlayers: `0x${string}`[];
}

export interface VotingResultEvent {
  type: ServerEventType.VOTING_RESULT;
  votes: Record<string, `0x${string}` | 'skip'>;
  voteCounts: Record<string, number>;
  ejected: `0x${string}` | null;
  wasImpostor: boolean | null;
}

export interface PlayerEjectedEvent {
  type: ServerEventType.PLAYER_EJECTED;
  player: `0x${string}`;
  wasImpostor: boolean;
  impostorsRemaining: number;
}

export interface GameEndedEvent {
  type: ServerEventType.GAME_ENDED;
  winner: 'crewmates' | 'impostors';
  reason: 'tasks_completed' | 'impostors_eliminated' | 'crewmates_eliminated' | 'sabotage';
  finalPlayers: Player[];
}

export interface ActionConfirmedEvent {
  type: ServerEventType.ACTION_CONFIRMED;
  actionId: string;
  actionType: AgentCommandType;
}

export interface ActionRejectedEvent {
  type: ServerEventType.ACTION_REJECTED;
  actionId: string;
  actionType: AgentCommandType;
  reason: string;
}

export type ServerEvent =
  | AuthSuccessEvent
  | AuthFailureEvent
  | HeartbeatEvent
  | ErrorEvent
  | GameStateUpdateEvent
  | PlayerUpdateEvent
  | RoleAssignedEvent
  | PlayerKilledEvent
  | BodyReportedEvent
  | VotingStartedEvent
  | VotingResultEvent
  | PlayerEjectedEvent
  | GameEndedEvent
  | ActionConfirmedEvent
  | ActionRejectedEvent;

// ============ Agent → Server Commands ============

export enum AgentCommandType {
  // Authentication
  AUTH = 'AUTH',
  HEARTBEAT_ACK = 'HEARTBEAT_ACK',

  // Game actions
  MOVE = 'MOVE',
  KILL = 'KILL',
  REPORT_BODY = 'REPORT_BODY',
  VOTE = 'VOTE',
  COMPLETE_TASK = 'COMPLETE_TASK',
  SABOTAGE = 'SABOTAGE',
  FIX_SABOTAGE = 'FIX_SABOTAGE',
}

export interface AuthCommand {
  type: AgentCommandType.AUTH;
  payload: AuthPayload;
}

export interface HeartbeatAckCommand {
  type: AgentCommandType.HEARTBEAT_ACK;
  timestamp: number;
}

export interface MoveCommand {
  type: AgentCommandType.MOVE;
  actionId: string;
  targetLocation: Location;
}

export interface KillCommand {
  type: AgentCommandType.KILL;
  actionId: string;
  target: `0x${string}`;
}

export interface ReportBodyCommand {
  type: AgentCommandType.REPORT_BODY;
  actionId: string;
  bodyVictim: `0x${string}`;
}

export interface VoteCommand {
  type: AgentCommandType.VOTE;
  actionId: string;
  target: `0x${string}` | null; // null = skip
}

export interface CompleteTaskCommand {
  type: AgentCommandType.COMPLETE_TASK;
  actionId: string;
  taskId: string;
}

export interface SabotageCommand {
  type: AgentCommandType.SABOTAGE;
  actionId: string;
  sabotageType: SabotageType;
}

export interface FixSabotageCommand {
  type: AgentCommandType.FIX_SABOTAGE;
  actionId: string;
  sabotageType: SabotageType;
}

export type AgentCommand =
  | AuthCommand
  | HeartbeatAckCommand
  | MoveCommand
  | KillCommand
  | ReportBodyCommand
  | VoteCommand
  | CompleteTaskCommand
  | SabotageCommand
  | FixSabotageCommand;

// ============ Connection Status Types ============

export interface AgentConnectionStatus {
  agentAddress: `0x${string}`;
  state: ConnectionState;
  lastHeartbeat: number | null;
  reconnectAttempts: number;
  error: string | null;
}

// ============ Aggregated State Types ============

export interface WebSocketGameState {
  gameId: string | null;
  phase: GamePhase;
  round: number;
  phaseEndTime: number;
  players: Player[];
  deadBodies: DeadBody[];
  activeSabotage: SabotageType;
  myRole: Role | null;
  teammates: `0x${string}`[];
}

export interface AgentManagerState {
  connections: Map<`0x${string}`, AgentConnectionStatus>;
  gameState: WebSocketGameState | null;
  isConnected: boolean;
  pendingActions: Map<string, AgentCommand>;
}
