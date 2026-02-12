// ============ AGENT STATS ============

export interface AgentStats {
  address: string;
  name: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  kills: number;           // Total kills as impostor
  tasksCompleted: number;  // Total tasks completed as crewmate
  timesImpostor: number;
  timesCrewmate: number;
  lastSeen: number;        // Timestamp
}

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
  | AgentTaskCompleteMessage
  | AgentReportBodyMessage
  | OperatorWithdrawRequestMessage
  | OperatorCreateAgentMessage
  | OperatorListAgentsMessage
  | AgentDepositMessage
  | AgentSubmitWagerMessage
  | AgentGetBalanceMessage
  | AgentCallMeetingMessage
  | AgentChatMessage
  | AgentSabotageMessage
  | AgentFixSabotageMessage
  | AgentVentMessage
  | AgentUseCamerasMessage;

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
  address?: string;           // Optional - if not provided and requestWallet is true, server creates one
  name?: string;              // Agent display name
  requestWallet?: boolean;    // If true, server will create a Privy wallet for this agent
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

export interface AgentReportBodyMessage {
  type: "agent:report_body";
  gameId: string;
  reporter: string;
  bodyLocation: Location;
  round: number;
}

// ============ WAGER MESSAGES ============

export interface AgentDepositMessage {
  type: "agent:deposit";
  amount: string; // Amount in wei as string
}

export interface AgentSubmitWagerMessage {
  type: "agent:submit_wager";
  gameId: string;
}

export interface AgentGetBalanceMessage {
  type: "agent:get_balance";
}

export interface AgentCallMeetingMessage {
  type: "agent:call_meeting";
  gameId: string;
}

export interface AgentChatMessage {
  type: "agent:chat";
  gameId: string;
  message: string;
}

export interface AgentSabotageMessage {
  type: "agent:sabotage";
  gameId: string;
  sabotageType: SabotageType;
}

export interface AgentFixSabotageMessage {
  type: "agent:fix_sabotage";
  gameId: string;
  location: Location;
}

export interface AgentVentMessage {
  type: "agent:vent";
  gameId: string;
  action: "enter" | "exit" | "move"; // enter vent, exit vent, or move between vents
  targetLocation?: Location; // For "move" action - which vent to move to
}

export interface AgentUseCamerasMessage {
  type: "agent:use_cameras";
  gameId: string;
  action: "start" | "stop"; // start or stop watching cameras
}

// ============ OPERATOR MESSAGES ============

export interface OperatorWithdrawRequestMessage {
  type: "operator:withdraw_request";
  operatorKey: string;        // oper_XXXXXXXXXXXX
  agentAddress: string;       // Target agent wallet address
  amount?: string;            // Amount in ether, or "max" for full balance
}

export interface OperatorCreateAgentMessage {
  type: "operator:create_agent";
  operatorKey: string;        // oper_XXXXXXXXXXXX
}

export interface OperatorListAgentsMessage {
  type: "operator:list_agents";
  operatorKey: string;        // oper_XXXXXXXXXXXX
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
  | ServerRoomAvailableMessage
  | ServerLeaderboardMessage
  | ServerPlayerJoinedMessage
  | ServerPlayerLeftMessage
  | ServerPlayerMovedMessage
  | ServerGameStateMessage
  | ServerKillOccurredMessage
  | ServerPhaseChangedMessage
  | ServerVoteCastMessage
  | ServerPlayerEjectedMessage
  | ServerTaskCompletedMessage
  | ServerGameEndedMessage
  | ServerBodyReportedMessage
  | ServerWithdrawResultMessage
  | ServerAgentCreatedMessage
  | ServerAgentListMessage
  | ServerWalletAssignedMessage
  | ServerAuthenticatedMessage
  | ServerBalanceMessage
  | ServerWagerRequiredMessage
  | ServerWagerAcceptedMessage
  | ServerWagerFailedMessage
  | ServerDepositConfirmedMessage
  | ServerPotUpdatedMessage
  | ServerMeetingCalledMessage
  | ServerChatBroadcastMessage
  | ServerSabotageStartedMessage
  | ServerSabotageFixedMessage
  | ServerSabotageFailedMessage
  | ServerPlayerVentedMessage
  | ServerCameraFeedMessage
  | ServerCameraStatusMessage;

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

export interface ServerRoomListMessage {
  type: "server:room_list";
  rooms: RoomState[];
  stats?: ServerStats;
}

export interface ServerRoomUpdateMessage {
  type: "server:room_update";
  room: RoomState;
}

export interface ServerRoomAvailableMessage {
  type: "server:room_available";
  roomId: string;
  slotId: number;
}

export interface ServerLeaderboardMessage {
  type: "server:leaderboard";
  agents: AgentStats[];
  timestamp: number;
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
  winners: string[];
  losers: string[];
  totalPot: string;
  winningsPerPlayer: string;
  timestamp: number;
}

export interface ServerBodyReportedMessage {
  type: "server:body_reported";
  gameId: string;
  reporter: string;
  victim: string;
  location: Location;
  round: number;
  timestamp: number;
}

export interface ServerWithdrawResultMessage {
  type: "server:withdraw_result";
  success: boolean;
  agentAddress: string;
  txHash?: string;
  error?: string;
  timestamp: number;
}

export interface ServerAgentCreatedMessage {
  type: "server:agent_created";
  success: boolean;
  agentAddress?: string;
  userId?: string;
  error?: string;
  timestamp: number;
}

export interface ServerAgentListMessage {
  type: "server:agent_list";
  agents: Array<{
    address: string;
    userId: string;
    createdAt: number;
  }>;
  timestamp: number;
}

export interface ServerWalletAssignedMessage {
  type: "server:wallet_assigned";
  success: boolean;
  address?: string;           // The newly created wallet address
  userId?: string;            // Privy user ID
  error?: string;             // Error message if failed
  timestamp: number;
}

export interface ServerAuthenticatedMessage {
  type: "server:authenticated";
  success: boolean;
  address: string;            // The authenticated wallet address
  name: string;               // Display name
  isNewWallet: boolean;       // True if wallet was just created
  timestamp: number;
}

// ============ SERVER WAGER MESSAGES ============

export interface ServerBalanceMessage {
  type: "server:balance";
  address: string;
  balance: string;            // Balance in wei as string
  totalDeposited?: string;
  totalWon?: string;
  totalLost?: string;
  wagerAmount?: string;       // Required wager amount
  canAfford?: boolean;        // Whether agent can afford the wager
  timestamp: number;
}

export interface ServerWagerRequiredMessage {
  type: "server:wager_required";
  gameId: string;
  amount: string;             // Required wager amount in wei
  currentBalance: string;     // Agent's current balance
  canAfford: boolean;         // Whether agent can afford the wager
  vaultAddress?: string;      // WagerVault contract address for on-chain wagering
  timestamp: number;
}

export interface ServerWagerAcceptedMessage {
  type: "server:wager_accepted";
  gameId: string;
  amount: string;             // Amount wagered
  newBalance: string;         // Balance after wager
  totalPot: string;           // Total pot for the game
  timestamp: number;
}

export interface ServerWagerFailedMessage {
  type: "server:wager_failed";
  gameId: string;
  reason?: string;
  error?: string;             // Detailed error message
  requiredAmount: string;
  currentBalance: string;
  timestamp: number;
}

export interface ServerDepositConfirmedMessage {
  type: "server:deposit_confirmed";
  address: string;
  amount: string;
  newBalance: string;
  timestamp: number;
}

export interface ServerPotUpdatedMessage {
  type: "server:pot_updated";
  gameId: string;
  totalPot: string;
  playerCount: number;
  timestamp: number;
}

export interface ServerMeetingCalledMessage {
  type: "server:meeting_called";
  gameId: string;
  caller: string;
  meetingsRemaining: number;
  timestamp: number;
}

export interface ServerChatBroadcastMessage {
  type: "server:chat";
  gameId: string;
  sender: string;
  senderName: string;
  message: string;
  isGhostChat: boolean; // True if from/to dead players only
  timestamp: number;
}

export interface ServerSabotageStartedMessage {
  type: "server:sabotage_started";
  gameId: string;
  sabotageType: SabotageType;
  sabotager: string;
  timeLimit: number; // Seconds until critical failure (0 if not critical)
  fixLocations: Location[]; // Where to go to fix
  timestamp: number;
}

export interface ServerSabotageFixedMessage {
  type: "server:sabotage_fixed";
  gameId: string;
  sabotageType: SabotageType;
  fixedBy: string;
  location: Location;
  timestamp: number;
}

export interface ServerSabotageFailedMessage {
  type: "server:sabotage_failed";
  gameId: string;
  sabotageType: SabotageType;
  reason: string; // "timeout" for critical sabotages
  timestamp: number;
}

export interface ServerPlayerVentedMessage {
  type: "server:player_vented";
  gameId: string;
  player: string;
  action: "enter" | "exit" | "move";
  fromLocation: Location;
  toLocation?: Location; // For move action
  timestamp: number;
}

export interface CameraPlayerInfo {
  address: string;
  location: Location;
  isAlive: boolean;
}

export interface ServerCameraFeedMessage {
  type: "server:camera_feed";
  gameId: string;
  playersVisible: CameraPlayerInfo[]; // Players in camera-monitored locations
  timestamp: number;
}

export interface ServerCameraStatusMessage {
  type: "server:camera_status";
  gameId: string;
  camerasInUse: boolean; // Whether anyone is watching cameras (for red light)
  watcherCount: number;
  timestamp: number;
}

// Union type for all messages
export type WebSocketMessage = AgentMessage | ServerMessage;
