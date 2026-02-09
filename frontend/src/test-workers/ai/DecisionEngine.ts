// AI Decision Engine Interface

import { Role, Location, GamePhase, Player, DeadBody } from '@/types/game';
import { StrategyType } from '../config/WorkerConfig';
import {
  WorkerGameState,
  WorkerAction,
  WorkerActionType,
  AvailableAction,
} from '../workers/WorkerMessage';

// ============ Decision Context ============

export interface DecisionContext {
  // Agent info
  agentAddress: `0x${string}`;
  role: Role;
  teammates: `0x${string}`[];
  location: Location;

  // Game state
  gameState: WorkerGameState;
  phase: GamePhase;
  round: number;

  // Available options
  availableActions: AvailableAction[];

  // Memory/tracking
  memory: AgentMemory;
}

export interface AgentMemory {
  // Movement tracking
  playerLastSeen: Map<`0x${string}`, { location: Location; timestamp: number }>;

  // Suspicion tracking (for crewmates)
  suspicionLevels: Map<`0x${string}`, number>; // 0-100

  // Kill tracking (for impostors)
  lastKillTimestamp: number | null;
  killCooldownRemaining: number;

  // Vote history
  voteHistory: Array<{
    round: number;
    target: `0x${string}` | null;
    result: `0x${string}` | null;
  }>;

  // Task progress
  tasksRemaining: string[];

  // Discovery tracking
  bodiesFound: `0x${string}`[];

  // Custom data
  custom: Record<string, unknown>;
}

// ============ Decision Result ============

export interface DecisionResult {
  action: WorkerAction;
  reasoning: string;
  confidence: number; // 0-1
}

// ============ Decision Engine Interface ============

export interface IDecisionEngine {
  // Initialize with strategy
  init(strategy: StrategyType, agentAddress: `0x${string}`): void;

  // Make a decision given context
  decide(context: DecisionContext): DecisionResult;

  // Update memory with new information
  updateMemory(gameState: WorkerGameState): void;

  // Reset for new game
  reset(): void;
}

// ============ Base Decision Engine ============

export abstract class BaseDecisionEngine implements IDecisionEngine {
  protected strategy: StrategyType = 'random';
  protected agentAddress: `0x${string}` | null = null;
  protected memory: AgentMemory;

  constructor() {
    this.memory = this.createEmptyMemory();
  }

  init(strategy: StrategyType, agentAddress: `0x${string}`): void {
    this.strategy = strategy;
    this.agentAddress = agentAddress;
    this.reset();
  }

  abstract decide(context: DecisionContext): DecisionResult;

  updateMemory(gameState: WorkerGameState): void {
    // Update player last seen locations
    for (const player of gameState.players) {
      if (player.isAlive && player.location === gameState.myLocation) {
        this.memory.playerLastSeen.set(player.address, {
          location: player.location,
          timestamp: Date.now(),
        });
      }
    }

    // Track new bodies
    for (const body of gameState.deadBodies) {
      if (!this.memory.bodiesFound.includes(body.victim)) {
        const player = gameState.players.find((p) => p.address === body.victim);
        if (player && player.location === gameState.myLocation) {
          this.memory.bodiesFound.push(body.victim);
        }
      }
    }
  }

  reset(): void {
    this.memory = this.createEmptyMemory();
  }

  protected createEmptyMemory(): AgentMemory {
    return {
      playerLastSeen: new Map(),
      suspicionLevels: new Map(),
      lastKillTimestamp: null,
      killCooldownRemaining: 0,
      voteHistory: [],
      tasksRemaining: [],
      bodiesFound: [],
      custom: {},
    };
  }

  // ============ Helper Methods ============

  protected findActionOfType(
    actions: AvailableAction[],
    type: WorkerActionType
  ): AvailableAction | undefined {
    return actions.find((a) => a.type === type);
  }

  protected canPerformAction(
    actions: AvailableAction[],
    type: WorkerActionType
  ): boolean {
    return actions.some((a) => a.type === type);
  }

  protected getAdjacentRooms(location: Location): Location[] {
    // Room connections matching The Skeld layout
    const ADJACENT_ROOMS: Record<Location, Location[]> = {
      [Location.UpperEngine]: [Location.MedBay, Location.Reactor],
      [Location.MedBay]: [Location.UpperEngine, Location.Cafeteria],
      [Location.Cafeteria]: [Location.MedBay, Location.Admin],
      [Location.Reactor]: [Location.UpperEngine, Location.Security],
      [Location.Admin]: [Location.Cafeteria, Location.Storage],
      [Location.Security]: [Location.Reactor, Location.LowerEngine],
      [Location.Storage]: [Location.Admin, Location.Electrical],
      [Location.LowerEngine]: [Location.Security, Location.Electrical],
      [Location.Electrical]: [Location.LowerEngine, Location.Storage],
    };

    return ADJACENT_ROOMS[location] || [];
  }

  protected getPlayersInLocation(
    players: Player[],
    location: Location,
    excludeAddress?: `0x${string}`
  ): Player[] {
    return players.filter(
      (p) =>
        p.isAlive &&
        p.location === location &&
        p.address !== excludeAddress
    );
  }

  protected getAlivePlayers(players: Player[], excludeAddress?: `0x${string}`): Player[] {
    return players.filter(
      (p) => p.isAlive && p.address !== excludeAddress
    );
  }

  protected pickRandom<T>(array: T[]): T | undefined {
    if (array.length === 0) return undefined;
    return array[Math.floor(Math.random() * array.length)];
  }

  protected pickRandomWithWeight<T>(items: Array<{ item: T; weight: number }>): T | undefined {
    const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
    if (totalWeight === 0) return items[0]?.item;

    let random = Math.random() * totalWeight;
    for (const { item, weight } of items) {
      random -= weight;
      if (random <= 0) return item;
    }

    return items[items.length - 1]?.item;
  }

  protected createWaitAction(): WorkerAction {
    return { type: WorkerActionType.WAIT };
  }

  protected createMoveAction(location: Location): WorkerAction {
    return { type: WorkerActionType.MOVE, targetLocation: location };
  }

  protected createKillAction(target: `0x${string}`): WorkerAction {
    return { type: WorkerActionType.KILL, targetPlayer: target };
  }

  protected createReportAction(victim: `0x${string}`): WorkerAction {
    return { type: WorkerActionType.REPORT_BODY, targetPlayer: victim };
  }

  protected createVoteAction(target: `0x${string}` | null): WorkerAction {
    return { type: WorkerActionType.VOTE, targetPlayer: target ?? undefined };
  }

  protected createTaskAction(taskId: string): WorkerAction {
    return { type: WorkerActionType.COMPLETE_TASK, taskId };
  }

  protected createSkipAction(): WorkerAction {
    return { type: WorkerActionType.SKIP };
  }
}
