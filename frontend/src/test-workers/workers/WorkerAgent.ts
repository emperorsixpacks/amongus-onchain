// WorkerAgent - Game loop and decision-making for a single agent
// This can be used both in worker threads and in the main thread for testing

import {
  WorkerGameState,
  WorkerAction,
  WorkerActionType,
  AvailableAction,
} from './WorkerMessage';
import { WorkerInitConfig, TestLog, AgentDecision } from '../config/WorkerConfig';
import { IDecisionEngine, DecisionContext, AgentMemory } from '../ai/DecisionEngine';
import { StrategyFactory } from '../ai/strategies/StrategyFactory';
import { Role, GamePhase, Location, RoomConnections } from '@/types/game';

export interface WorkerAgentCallbacks {
  onAction: (action: WorkerAction) => void;
  onDecision: (decision: AgentDecision) => void;
  onLog: (log: TestLog) => void;
  onError: (error: string) => void;
}

export class WorkerAgent {
  private config: WorkerInitConfig;
  private engine: IDecisionEngine;
  private role: Role = Role.None;
  private teammates: `0x${string}`[] = [];
  private gameState: WorkerGameState | null = null;
  private running: boolean = false;
  private callbacks: WorkerAgentCallbacks;

  constructor(config: WorkerInitConfig, callbacks: WorkerAgentCallbacks) {
    this.config = config;
    this.callbacks = callbacks;

    // Create decision engine
    this.engine = StrategyFactory.create(config.strategy);
    this.engine.init(config.strategy, config.agentAddress);

    this.log('info', `WorkerAgent initialized: ${config.strategy} strategy`);
  }

  // ============ Public API ============

  start(): void {
    this.running = true;
    this.log('info', 'Agent started');
  }

  stop(): void {
    this.running = false;
    this.log('info', 'Agent stopped');
  }

  setRole(role: Role, teammates: `0x${string}`[] = []): void {
    this.role = role;
    this.teammates = teammates;
    this.log('info', `Role set: ${Role[role]}`);
  }

  updateGameState(gameState: WorkerGameState): void {
    this.gameState = gameState;
    this.engine.updateMemory(gameState);
  }

  requestAction(phase: GamePhase, deadline: number): WorkerAction {
    if (!this.running || !this.gameState) {
      return { type: WorkerActionType.WAIT };
    }

    // Build available actions based on current state
    const availableActions = this.buildAvailableActions(phase);

    // Build decision context
    const context: DecisionContext = {
      agentAddress: this.config.agentAddress,
      role: this.role,
      teammates: this.teammates,
      location: this.gameState.myLocation,
      gameState: this.gameState,
      phase,
      round: this.gameState.round,
      availableActions,
      memory: this.getEngineMemory(),
    };

    // Make decision
    const startTime = Date.now();
    const result = this.engine.decide(context);
    const decisionTime = Date.now() - startTime;

    // Log decision
    const decision: AgentDecision = {
      timestamp: Date.now(),
      agentAddress: this.config.agentAddress,
      phase: GamePhase[phase],
      action: WorkerActionType[result.action.type],
      reasoning: result.reasoning,
      context: {
        confidence: result.confidence,
        decisionTimeMs: decisionTime,
      },
    };

    this.callbacks.onDecision(decision);
    this.callbacks.onAction(result.action);

    return result.action;
  }

  reset(): void {
    this.role = Role.None;
    this.teammates = [];
    this.gameState = null;
    this.engine.reset();
    this.log('info', 'Agent reset');
  }

  // ============ Private Methods ============

  private buildAvailableActions(phase: GamePhase): AvailableAction[] {
    if (!this.gameState) return [];

    const actions: AvailableAction[] = [];
    const myLocation = this.gameState.myLocation;

    if (phase === GamePhase.Voting) {
      // Voting phase - can vote or skip
      const alivePlayers = this.gameState.players
        .filter((p) => p.isAlive && p.address !== this.config.agentAddress)
        .map((p) => p.address);

      actions.push({
        type: WorkerActionType.VOTE,
        targets: alivePlayers,
      });

      actions.push({ type: WorkerActionType.SKIP });

      return actions;
    }

    // Action phase

    // 1. Movement - can move to adjacent rooms
    const adjacentRooms = this.getAdjacentRooms(myLocation);
    if (adjacentRooms.length > 0) {
      actions.push({
        type: WorkerActionType.MOVE,
        locations: adjacentRooms,
      });
    }

    // 2. Report body - if there's an unreported body in current location
    const unreportedBodies = this.gameState.deadBodies.filter(
      (b) => !b.reported && b.location === myLocation
    );
    if (unreportedBodies.length > 0) {
      actions.push({
        type: WorkerActionType.REPORT_BODY,
        targets: unreportedBodies.map((b) => b.victim),
      });
    }

    // 3. Complete task - crewmates can do tasks
    if (this.role === Role.Crewmate) {
      // Simplified: always have tasks available at any location
      actions.push({
        type: WorkerActionType.COMPLETE_TASK,
        taskIds: [`task-${myLocation}-${Date.now()}`],
      });
    }

    // 4. Kill - impostors can kill crewmates in same location
    if (this.role === Role.Impostor) {
      const targets = this.gameState.players
        .filter(
          (p) =>
            p.isAlive &&
            p.location === myLocation &&
            p.address !== this.config.agentAddress &&
            p.role !== Role.Impostor
        )
        .map((p) => p.address);

      if (targets.length > 0) {
        actions.push({
          type: WorkerActionType.KILL,
          targets,
        });
      }

      // Sabotage - impostors can sabotage
      actions.push({ type: WorkerActionType.SABOTAGE });
    }

    // Always can wait
    actions.push({ type: WorkerActionType.WAIT });

    return actions;
  }

  private getAdjacentRooms(location: Location): Location[] {
    const adjacent: Location[] = [];

    for (const [loc1, loc2] of RoomConnections) {
      if (loc1 === location) {
        adjacent.push(loc2);
      } else if (loc2 === location) {
        adjacent.push(loc1);
      }
    }

    return adjacent;
  }

  private getEngineMemory(): AgentMemory {
    // Type assertion since we know the engine has memory
    const engineWithMemory = this.engine as { memory?: AgentMemory };
    return engineWithMemory.memory || {
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

  private log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>
  ): void {
    this.callbacks.onLog({
      timestamp: Date.now(),
      level,
      source: this.config.workerId,
      message,
      data,
    });
  }
}
