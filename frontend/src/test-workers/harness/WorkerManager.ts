// Worker Manager - Manages pool of worker threads

import { Worker } from 'worker_threads';
import {
  MainToWorkerMessage,
  WorkerToMainMessage,
  WorkerToMainMessageType,
  MainToWorkerMessageType,
  createInitMessage,
  createStartMessage,
  createStopMessage,
  createGameStateUpdateMessage,
  createRoleAssignedMessage,
  createRequestActionMessage,
  createGameEndedMessage,
  WorkerAction,
  WorkerGameState,
} from '../workers/WorkerMessage';
import { WorkerInitConfig, WorkerPoolConfig, DEFAULT_WORKER_POOL_CONFIG, TestLog, AgentDecision } from '../config/WorkerConfig';
import { Role, GamePhase } from '@/types/game';

export interface WorkerInfo {
  workerId: string;
  agentAddress: `0x${string}`;
  worker: Worker;
  ready: boolean;
  stopped: boolean;
}

export interface WorkerManagerCallbacks {
  onWorkerReady: (workerId: string) => void;
  onWorkerAction: (workerId: string, action: WorkerAction) => void;
  onWorkerLog: (workerId: string, log: TestLog) => void;
  onWorkerDecision: (workerId: string, decision: AgentDecision) => void;
  onWorkerError: (workerId: string, error: string) => void;
  onWorkerStopped: (workerId: string) => void;
}

export class WorkerManager {
  private workers: Map<string, WorkerInfo> = new Map();
  private config: WorkerPoolConfig;
  private callbacks: WorkerManagerCallbacks;
  private workerScriptPath: string;

  constructor(
    workerScriptPath: string,
    callbacks: WorkerManagerCallbacks,
    config: Partial<WorkerPoolConfig> = {}
  ) {
    this.workerScriptPath = workerScriptPath;
    this.callbacks = callbacks;
    this.config = { ...DEFAULT_WORKER_POOL_CONFIG, ...config };
  }

  // ============ Public API ============

  async spawnWorker(initConfig: WorkerInitConfig): Promise<string> {
    if (this.workers.size >= this.config.maxWorkers) {
      throw new Error(`Maximum workers (${this.config.maxWorkers}) reached`);
    }

    const workerId = initConfig.workerId;

    // Create worker
    const worker = new Worker(this.workerScriptPath, {
      workerData: initConfig,
    });

    const workerInfo: WorkerInfo = {
      workerId,
      agentAddress: initConfig.agentAddress,
      worker,
      ready: false,
      stopped: false,
    };

    this.workers.set(workerId, workerInfo);

    // Set up message handler
    worker.on('message', (message: WorkerToMainMessage) => {
      this.handleWorkerMessage(workerId, message);
    });

    worker.on('error', (error: Error) => {
      this.callbacks.onWorkerError(workerId, error.message);

      if (this.config.restartOnCrash && !workerInfo.stopped) {
        this.restartWorker(workerId, initConfig);
      }
    });

    worker.on('exit', (code: number) => {
      if (code !== 0 && !workerInfo.stopped) {
        this.callbacks.onWorkerError(workerId, `Worker exited with code ${code}`);

        if (this.config.restartOnCrash) {
          this.restartWorker(workerId, initConfig);
        }
      }
    });

    // Send init message
    this.sendToWorker(workerId, createInitMessage(initConfig));

    // Wait for ready
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Worker ${workerId} did not become ready in time`));
      }, this.config.workerTimeout);

      const checkReady = setInterval(() => {
        const info = this.workers.get(workerId);
        if (info?.ready) {
          clearTimeout(timeout);
          clearInterval(checkReady);
          resolve(workerId);
        }
      }, 100);
    });
  }

  startWorker(workerId: string): void {
    this.sendToWorker(workerId, createStartMessage());
  }

  stopWorker(workerId: string): void {
    const workerInfo = this.workers.get(workerId);
    if (workerInfo) {
      workerInfo.stopped = true;
      this.sendToWorker(workerId, createStopMessage());
    }
  }

  terminateWorker(workerId: string): void {
    const workerInfo = this.workers.get(workerId);
    if (workerInfo) {
      workerInfo.stopped = true;
      workerInfo.worker.terminate();
      this.workers.delete(workerId);
    }
  }

  startAll(): void {
    for (const workerId of this.workers.keys()) {
      this.startWorker(workerId);
    }
  }

  stopAll(): void {
    for (const workerId of this.workers.keys()) {
      this.stopWorker(workerId);
    }
  }

  terminateAll(): void {
    for (const workerId of this.workers.keys()) {
      this.terminateWorker(workerId);
    }
    this.workers.clear();
  }

  // ============ Game State Updates ============

  broadcastGameState(state: WorkerGameState): void {
    const message = createGameStateUpdateMessage(state);
    for (const workerId of this.workers.keys()) {
      this.sendToWorker(workerId, message);
    }
  }

  sendGameStateToWorker(workerId: string, state: WorkerGameState): void {
    this.sendToWorker(workerId, createGameStateUpdateMessage(state));
  }

  assignRole(workerId: string, role: Role, teammates: `0x${string}`[] = []): void {
    this.sendToWorker(workerId, createRoleAssignedMessage(role, teammates));
  }

  requestAction(workerId: string, phase: GamePhase, deadline: number): void {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;

    // Build available actions based on role and phase
    // This is a simplified version - the actual available actions
    // should be determined by the game state
    const availableActions = this.buildAvailableActions(workerInfo, phase);

    this.sendToWorker(workerId, createRequestActionMessage(phase, availableActions, deadline));
  }

  notifyGameEnded(winner: 'crewmates' | 'impostors', reason: string): void {
    const message = createGameEndedMessage(winner, reason);
    for (const workerId of this.workers.keys()) {
      this.sendToWorker(workerId, message);
    }
  }

  // ============ Query Methods ============

  getWorkerIds(): string[] {
    return Array.from(this.workers.keys());
  }

  getWorkerInfo(workerId: string): WorkerInfo | undefined {
    return this.workers.get(workerId);
  }

  getWorkerByAgent(agentAddress: `0x${string}`): WorkerInfo | undefined {
    for (const info of this.workers.values()) {
      if (info.agentAddress === agentAddress) {
        return info;
      }
    }
    return undefined;
  }

  isReady(): boolean {
    for (const info of this.workers.values()) {
      if (!info.ready) return false;
    }
    return this.workers.size > 0;
  }

  // ============ Private Methods ============

  private sendToWorker(workerId: string, message: MainToWorkerMessage): void {
    const workerInfo = this.workers.get(workerId);
    if (workerInfo && !workerInfo.stopped) {
      workerInfo.worker.postMessage(message);
    }
  }

  private handleWorkerMessage(workerId: string, message: WorkerToMainMessage): void {
    switch (message.type) {
      case WorkerToMainMessageType.READY:
        const workerInfo = this.workers.get(workerId);
        if (workerInfo) {
          workerInfo.ready = true;
        }
        this.callbacks.onWorkerReady(workerId);
        break;

      case WorkerToMainMessageType.ACTION:
        this.callbacks.onWorkerAction(workerId, message.action);
        break;

      case WorkerToMainMessageType.LOG:
        this.callbacks.onWorkerLog(workerId, message.log);
        break;

      case WorkerToMainMessageType.DECISION:
        this.callbacks.onWorkerDecision(workerId, message.decision);
        break;

      case WorkerToMainMessageType.ERROR:
        this.callbacks.onWorkerError(workerId, message.error);
        break;

      case WorkerToMainMessageType.STOPPED:
        this.callbacks.onWorkerStopped(workerId);
        break;
    }
  }

  private async restartWorker(workerId: string, initConfig: WorkerInitConfig): Promise<void> {
    // Remove old worker
    this.workers.delete(workerId);

    // Spawn new worker with same config
    try {
      await this.spawnWorker(initConfig);
      this.startWorker(workerId);
    } catch (error) {
      this.callbacks.onWorkerError(workerId, `Failed to restart worker: ${error}`);
    }
  }

  private buildAvailableActions(
    workerInfo: WorkerInfo,
    phase: GamePhase
  ): ReturnType<typeof createRequestActionMessage>['availableActions'] {
    // This is a placeholder - the actual implementation would
    // query the game state to determine valid actions
    return [];
  }
}
