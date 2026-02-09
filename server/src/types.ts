// ============ ENUMS (Mirror from game) ============

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

// ============ CONNECTION TYPES ============

export type ConnectionType = "agent" | "spectator";

export interface Connection {
  id: string;
  type: ConnectionType;
  address?: string; // Agent wallet address (only for agents)
  gameId?: string; // Current game room
  joinedAt: number;
}

// ============ PLAYER STATE ============

export interface PlayerState {
  address: string;
  colorId: number;
  location: Location;
  isAlive: boolean;
  tasksCompleted: number;
  totalTasks: number;
  hasVoted: boolean;
}

export interface DeadBodyState {
  victim: string;
  location: Location;
  round: number;
  reported: boolean;
}

export interface GameStateSnapshot {
  gameId: string;
  phase: GamePhase;
  round: number;
  phaseEndTime: number;
  players: PlayerState[];
  deadBodies: DeadBodyState[];
  alivePlayers: number;
  totalTasksCompleted: number;
  totalTasksRequired: number;
  activeSabotage: SabotageType;
}

// ============ MESSAGE TYPES ============

// Client → Server Messages
export type ClientMessage =
  | ClientAuthenticateMessage
  | ClientCreateRoomMessage
  | ClientJoinRoomMessage
  | ClientLeaveRoomMessage
  | ClientStartGameMessage
  | AgentAuthenticateMessage
  | AgentJoinGameMessage
  | AgentLeaveGameMessage
  | AgentPositionUpdateMessage
  | AgentActionResultMessage
  | AgentPhaseChangeMessage
  | AgentKillMessage
  | AgentVoteMessage
  | AgentTaskCompleteMessage;

// Kept for backwards compat
export type AgentMessage = ClientMessage;

export interface ClientAuthenticateMessage {
  type: "client:authenticate";
  address?: string; // Optional for spectators
  name?: string;
}

export interface ClientCreateRoomMessage {
  type: "client:create_room";
  maxPlayers?: number;
  impostorCount?: number;
}

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

export interface ClientStartGameMessage {
  type: "client:start_game";
  roomId: string;
}

// Legacy aliases
export interface AgentAuthenticateMessage {
  type: "agent:authenticate";
  address: string;
  signature?: string;
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
  target: string | null; // null = skip
  round: number;
}

export interface AgentTaskCompleteMessage {
  type: "agent:task_complete";
  gameId: string;
  player: string;
  tasksCompleted: number;
  totalTasks: number;
}

// Room state
export interface RoomState {
  roomId: string;
  players: PlayerState[];
  spectators: string[]; // connection IDs
  maxPlayers: number;
  impostorCount: number;
  phase: "lobby" | "playing" | "ended";
  createdAt: number;
}

// Server → Client Messages
export type ServerMessage =
  | ServerWelcomeMessage
  | ServerErrorMessage
  | ServerRoomCreatedMessage
  | ServerRoomListMessage
  | ServerRoomUpdateMessage
  | ServerPlayerJoinedMessage
  | ServerPlayerLeftMessage
  | ServerPlayerMovedMessage
  | ServerGameStateMessage
  | ServerKillOccurredMessage
  | ServerPhaseChangedMessage
  | ServerVoteCastMessage
  | ServerPlayerEjectedMessage
  | ServerTaskCompletedMessage
  | ServerGameEndedMessage;

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

export interface ServerRoomCreatedMessage {
  type: "server:room_created";
  room: RoomState;
}

export interface ServerRoomListMessage {
  type: "server:room_list";
  rooms: RoomState[];
}

export interface ServerRoomUpdateMessage {
  type: "server:room_update";
  room: RoomState;
}

export interface ServerPlayerJoinedMessage {
  type: "server:player_joined";
  gameId: string;
  player: PlayerState;
}

export interface ServerPlayerLeftMessage {
  type: "server:player_left";
  gameId: string;
  address: string;
}

export interface ServerPlayerMovedMessage {
  type: "server:player_moved";
  gameId: string;
  address: string;
  from: Location;
  to: Location;
  round: number;
  timestamp: number;
}

export interface ServerGameStateMessage {
  type: "server:game_state";
  gameId: string;
  state: GameStateSnapshot;
}

export interface ServerKillOccurredMessage {
  type: "server:kill_occurred";
  gameId: string;
  killer: string;
  victim: string;
  location: Location;
  round: number;
  timestamp: number;
}

export interface ServerPhaseChangedMessage {
  type: "server:phase_changed";
  gameId: string;
  phase: GamePhase;
  previousPhase: GamePhase;
  round: number;
  phaseEndTime: number;
  timestamp: number;
}

export interface ServerVoteCastMessage {
  type: "server:vote_cast";
  gameId: string;
  voter: string;
  target: string | null;
  round: number;
  timestamp: number;
}

export interface ServerPlayerEjectedMessage {
  type: "server:player_ejected";
  gameId: string;
  ejected: string;
  wasImpostor: boolean;
  round: number;
  timestamp: number;
}

export interface ServerTaskCompletedMessage {
  type: "server:task_completed";
  gameId: string;
  player: string;
  tasksCompleted: number;
  totalTasks: number;
  totalProgress: number; // Percentage
  timestamp: number;
}

export interface ServerGameEndedMessage {
  type: "server:game_ended";
  gameId: string;
  crewmatesWon: boolean;
  reason: "tasks" | "votes" | "kills";
  timestamp: number;
}

// Union type for all messages
export type WebSocketMessage = AgentMessage | ServerMessage;
