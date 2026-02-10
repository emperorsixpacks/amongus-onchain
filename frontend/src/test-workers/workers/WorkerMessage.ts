// Worker Thread IPC Message Types

import { WorkerInitConfig, TestLog, AgentDecision, StrategyType } from '../config/WorkerConfig';
import { Location, GamePhase, Role, Player, DeadBody } from '@/types/game';

// ============ Main Thread → Worker Messages ============

export enum MainToWorkerMessageType {
  INIT = 'INIT',
  START = 'START',
  STOP = 'STOP',
  GAME_STATE_UPDATE = 'GAME_STATE_UPDATE',
  ROLE_ASSIGNED = 'ROLE_ASSIGNED',
  REQUEST_ACTION = 'REQUEST_ACTION',
  VOTING_STARTED = 'VOTING_STARTED',
  GAME_ENDED = 'GAME_ENDED',
}

export interface InitMessage {
  type: MainToWorkerMessageType.INIT;
  config: WorkerInitConfig;
}

export interface StartMessage {
  type: MainToWorkerMessageType.START;
}

export interface StopMessage {
  type: MainToWorkerMessageType.STOP;
}

export interface GameStateUpdateMessage {
  type: MainToWorkerMessageType.GAME_STATE_UPDATE;
  gameState: WorkerGameState;
}

export interface RoleAssignedMessage {
  type: MainToWorkerMessageType.ROLE_ASSIGNED;
  role: Role;
  teammates: `0x${string}`[];
}

export interface RequestActionMessage {
  type: MainToWorkerMessageType.REQUEST_ACTION;
  phase: GamePhase;
  availableActions: AvailableAction[];
  deadline: number;
}

export interface VotingStartedMessage {
  type: MainToWorkerMessageType.VOTING_STARTED;
  duration: number;
  alivePlayers: `0x${string}`[];
}

export interface GameEndedMessage {
  type: MainToWorkerMessageType.GAME_ENDED;
  winner: 'crewmates' | 'impostors';
  reason: string;
}

export type MainToWorkerMessage =
  | InitMessage
  | StartMessage
  | StopMessage
  | GameStateUpdateMessage
  | RoleAssignedMessage
  | RequestActionMessage
  | VotingStartedMessage
  | GameEndedMessage;

// ============ Worker → Main Thread Messages ============

export enum WorkerToMainMessageType {
  READY = 'READY',
  ACTION = 'ACTION',
  LOG = 'LOG',
  DECISION = 'DECISION',
  ERROR = 'ERROR',
  STOPPED = 'STOPPED',
}

export interface ReadyMessage {
  type: WorkerToMainMessageType.READY;
  workerId: string;
}

export interface ActionMessage {
  type: WorkerToMainMessageType.ACTION;
  workerId: string;
  action: WorkerAction;
}

export interface LogMessage {
  type: WorkerToMainMessageType.LOG;
  workerId: string;
  log: TestLog;
}

export interface DecisionMessage {
  type: WorkerToMainMessageType.DECISION;
  workerId: string;
  decision: AgentDecision;
}

export interface ErrorMessage {
  type: WorkerToMainMessageType.ERROR;
  workerId: string;
  error: string;
  stack?: string;
}

export interface StoppedMessage {
  type: WorkerToMainMessageType.STOPPED;
  workerId: string;
}

export type WorkerToMainMessage =
  | ReadyMessage
  | ActionMessage
  | LogMessage
  | DecisionMessage
  | ErrorMessage
  | StoppedMessage;

// ============ Shared Types ============

export interface WorkerGameState {
  gameId: string;
  phase: GamePhase;
  round: number;
  phaseEndTime: number;
  players: Player[];
  deadBodies: DeadBody[];
  myLocation: Location;
  activeSabotage: number;
}

export interface AvailableAction {
  type: WorkerActionType;
  targets?: `0x${string}`[];
  locations?: Location[];
  taskIds?: string[];
}

export enum WorkerActionType {
  MOVE = 'MOVE',
  KILL = 'KILL',
  REPORT_BODY = 'REPORT_BODY',
  VOTE = 'VOTE',
  COMPLETE_TASK = 'COMPLETE_TASK',
  SABOTAGE = 'SABOTAGE',
  SKIP = 'SKIP',
  WAIT = 'WAIT',
}

export interface WorkerAction {
  type: WorkerActionType;
  targetPlayer?: `0x${string}`;
  targetLocation?: Location;
  taskId?: string;
  sabotageType?: number;
}

// ============ Helper Functions ============

export function createInitMessage(config: WorkerInitConfig): InitMessage {
  return { type: MainToWorkerMessageType.INIT, config };
}

export function createStartMessage(): StartMessage {
  return { type: MainToWorkerMessageType.START };
}

export function createStopMessage(): StopMessage {
  return { type: MainToWorkerMessageType.STOP };
}

export function createGameStateUpdateMessage(gameState: WorkerGameState): GameStateUpdateMessage {
  return { type: MainToWorkerMessageType.GAME_STATE_UPDATE, gameState };
}

export function createRoleAssignedMessage(role: Role, teammates: `0x${string}`[] = []): RoleAssignedMessage {
  return { type: MainToWorkerMessageType.ROLE_ASSIGNED, role, teammates };
}

export function createRequestActionMessage(
  phase: GamePhase,
  availableActions: AvailableAction[],
  deadline: number
): RequestActionMessage {
  return {
    type: MainToWorkerMessageType.REQUEST_ACTION,
    phase,
    availableActions,
    deadline,
  };
}

export function createVotingStartedMessage(duration: number, alivePlayers: `0x${string}`[]): VotingStartedMessage {
  return {
    type: MainToWorkerMessageType.VOTING_STARTED,
    duration,
    alivePlayers,
  };
}

export function createGameEndedMessage(winner: 'crewmates' | 'impostors', reason: string): GameEndedMessage {
  return { type: MainToWorkerMessageType.GAME_ENDED, winner, reason };
}
