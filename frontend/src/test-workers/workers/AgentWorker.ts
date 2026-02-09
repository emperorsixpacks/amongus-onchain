// Agent Worker Thread Entry Point
// This file runs in a worker thread context

import { parentPort, workerData } from 'worker_threads';
import {
  MainToWorkerMessage,
  MainToWorkerMessageType,
  WorkerToMainMessageType,
  WorkerGameState,
  WorkerAction,
  WorkerActionType,
  AvailableAction,
} from './WorkerMessage';
import { WorkerInitConfig, TestLog } from '../config/WorkerConfig';
import { IDecisionEngine, DecisionContext, AgentMemory } from '../ai/DecisionEngine';
import { StrategyFactory } from '../ai/strategies/StrategyFactory';
import { Role, GamePhase, Location } from '@/types/game';

class AgentWorkerRunner {
  private config: WorkerInitConfig | null = null;
  private engine: IDecisionEngine | null = null;
  private role: Role = Role.None;
  private teammates: `0x${string}`[] = [];
  private gameState: WorkerGameState | null = null;
  private running: boolean = false;

  constructor() {
    if (!parentPort) {
      throw new Error('AgentWorker must run in a worker thread');
    }

    parentPort.on('message', (message: MainToWorkerMessage) => {
      this.handleMessage(message);
    });
  }

  private handleMessage(message: MainToWorkerMessage): void {
    switch (message.type) {
      case MainToWorkerMessageType.INIT:
        this.handleInit(message.config);
        break;

      case MainToWorkerMessageType.START:
        this.handleStart();
        break;

      case MainToWorkerMessageType.STOP:
        this.handleStop();
        break;

      case MainToWorkerMessageType.GAME_STATE_UPDATE:
        this.handleGameStateUpdate(message.gameState);
        break;

      case MainToWorkerMessageType.ROLE_ASSIGNED:
        this.handleRoleAssigned(message.role, message.teammates);
        break;

      case MainToWorkerMessageType.REQUEST_ACTION:
        this.handleRequestAction(message.phase, message.availableActions, message.deadline);
        break;

      case MainToWorkerMessageType.VOTING_STARTED:
        this.handleVotingStarted(message.duration, message.alivePlayers);
        break;

      case MainToWorkerMessageType.GAME_ENDED:
        this.handleGameEnded(message.winner, message.reason);
        break;
    }
  }

  private handleInit(config: WorkerInitConfig): void {
    this.config = config;

    // Create decision engine for this agent's strategy
    this.engine = StrategyFactory.create(config.strategy);
    this.engine.init(config.strategy, config.agentAddress);

    this.log('info', `Initialized with strategy: ${config.strategy}`);

    // Send ready message
    this.send({
      type: WorkerToMainMessageType.READY,
      workerId: config.workerId,
    });
  }

  private handleStart(): void {
    if (!this.config) {
      this.sendError('Cannot start: not initialized');
      return;
    }

    this.running = true;
    this.log('info', 'Worker started');
  }

  private handleStop(): void {
    this.running = false;
    this.log('info', 'Worker stopping');

    if (this.config) {
      this.send({
        type: WorkerToMainMessageType.STOPPED,
        workerId: this.config.workerId,
      });
    }
  }

  private handleGameStateUpdate(gameState: WorkerGameState): void {
    this.gameState = gameState;

    // Update engine's memory with new state
    if (this.engine) {
      this.engine.updateMemory(gameState);
    }
  }

  private handleRoleAssigned(role: Role, teammates: `0x${string}`[]): void {
    this.role = role;
    this.teammates = teammates;

    const roleNames: Record<Role, string> = {
      [Role.None]: 'None',
      [Role.Crewmate]: 'Crewmate',
      [Role.Impostor]: 'Impostor',
      [Role.Ghost]: 'Ghost',
    };

    this.log('info', `Role assigned: ${roleNames[role]}${teammates.length > 0 ? ` with ${teammates.length} teammates` : ''}`);
  }

  private handleRequestAction(
    phase: GamePhase,
    availableActions: AvailableAction[],
    deadline: number
  ): void {
    if (!this.config || !this.engine || !this.gameState) {
      this.log('warn', 'Cannot decide: missing config, engine, or game state');
      this.sendAction({ type: WorkerActionType.WAIT });
      return;
    }

    if (!this.running) {
      this.log('warn', 'Not running, sending WAIT');
      this.sendAction({ type: WorkerActionType.WAIT });
      return;
    }

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
      memory: (this.engine as { memory?: AgentMemory }).memory || this.createEmptyMemory(),
    };

    // Make decision
    const startTime = Date.now();
    const result = this.engine.decide(context);
    const decisionTime = Date.now() - startTime;

    // Log decision
    this.sendDecision({
      timestamp: Date.now(),
      agentAddress: this.config.agentAddress,
      phase: GamePhase[phase],
      action: WorkerActionType[result.action.type],
      reasoning: result.reasoning,
      context: {
        confidence: result.confidence,
        decisionTimeMs: decisionTime,
        location: Location[this.gameState.myLocation],
        playersNearby: this.gameState.players.filter(
          (p) => p.isAlive && p.location === this.gameState!.myLocation
        ).length,
      },
    });

    // Send action
    this.sendAction(result.action);
  }

  private handleVotingStarted(duration: number, alivePlayers: `0x${string}`[]): void {
    this.log('info', `Voting started, ${alivePlayers.length} players alive, ${duration}ms to vote`);
  }

  private handleGameEnded(winner: 'crewmates' | 'impostors', reason: string): void {
    const roleNames: Record<Role, string> = {
      [Role.None]: 'None',
      [Role.Crewmate]: 'Crewmate',
      [Role.Impostor]: 'Impostor',
      [Role.Ghost]: 'Ghost',
    };

    const won = (winner === 'crewmates' && this.role === Role.Crewmate) ||
                (winner === 'impostors' && this.role === Role.Impostor);

    this.log('info', `Game ended: ${winner} win (${reason}). I was ${roleNames[this.role]}: ${won ? 'VICTORY' : 'DEFEAT'}`);
    this.running = false;
  }

  private sendAction(action: WorkerAction): void {
    if (!this.config) return;

    this.send({
      type: WorkerToMainMessageType.ACTION,
      workerId: this.config.workerId,
      action,
    });
  }

  private sendDecision(decision: {
    timestamp: number;
    agentAddress: `0x${string}`;
    phase: string;
    action: string;
    reasoning?: string;
    context?: Record<string, unknown>;
  }): void {
    if (!this.config) return;

    this.send({
      type: WorkerToMainMessageType.DECISION,
      workerId: this.config.workerId,
      decision,
    });
  }

  private sendError(error: string, stack?: string): void {
    if (!this.config) {
      console.error('Worker error (no config):', error);
      return;
    }

    this.send({
      type: WorkerToMainMessageType.ERROR,
      workerId: this.config.workerId,
      error,
      stack,
    });
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>): void {
    if (!this.config) {
      console.log(`[Worker] ${message}`);
      return;
    }

    const log: TestLog = {
      timestamp: Date.now(),
      level,
      source: this.config.workerId,
      message,
      data,
    };

    this.send({
      type: WorkerToMainMessageType.LOG,
      workerId: this.config.workerId,
      log,
    });
  }

  private send(message: { type: WorkerToMainMessageType; [key: string]: unknown }): void {
    if (parentPort) {
      parentPort.postMessage(message);
    }
  }

  private createEmptyMemory(): AgentMemory {
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
}

// Start the worker
new AgentWorkerRunner();
