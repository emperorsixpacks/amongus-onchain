// Game Connection Interface
// Abstracts the connection to a game server (real or mock)

import { Player, DeadBody, GamePhase, Role, Location, SabotageType } from '@/types/game';
import { WorkerAction, WorkerActionType, WorkerGameState } from '../workers/WorkerMessage';

// ============ Types ============

export interface GameConnectionConfig {
  gameId: string;
  serverUrl?: string;
}

export interface GameConnectionCallbacks {
  onGameStateUpdate: (state: WorkerGameState) => void;
  onRoleAssigned: (agentAddress: `0x${string}`, role: Role, teammates: `0x${string}`[]) => void;
  onActionRequest: (agentAddress: `0x${string}`, phase: GamePhase, deadline: number) => void;
  onVotingStarted: (duration: number, alivePlayers: `0x${string}`[]) => void;
  onGameEnded: (winner: 'crewmates' | 'impostors', reason: string) => void;
  onError: (error: string) => void;
}

// ============ Interface ============

export interface IGameConnection {
  // Lifecycle
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;

  // Agent management
  registerAgent(agentAddress: `0x${string}`): Promise<void>;
  unregisterAgent(agentAddress: `0x${string}`): void;

  // Actions
  submitAction(agentAddress: `0x${string}`, action: WorkerAction): Promise<boolean>;

  // State queries
  getGameState(): WorkerGameState | null;
  getAgentLocation(agentAddress: `0x${string}`): Location | null;
  getAgentRole(agentAddress: `0x${string}`): Role | null;
}

// ============ Base Implementation ============

export abstract class BaseGameConnection implements IGameConnection {
  protected config: GameConnectionConfig;
  protected callbacks: GameConnectionCallbacks;
  protected connected: boolean = false;
  protected gameState: WorkerGameState | null = null;
  protected registeredAgents: Set<`0x${string}`> = new Set();
  protected agentRoles: Map<`0x${string}`, Role> = new Map();

  constructor(config: GameConnectionConfig, callbacks: GameConnectionCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): void;
  abstract registerAgent(agentAddress: `0x${string}`): Promise<void>;
  abstract submitAction(agentAddress: `0x${string}`, action: WorkerAction): Promise<boolean>;

  isConnected(): boolean {
    return this.connected;
  }

  unregisterAgent(agentAddress: `0x${string}`): void {
    this.registeredAgents.delete(agentAddress);
    this.agentRoles.delete(agentAddress);
  }

  getGameState(): WorkerGameState | null {
    return this.gameState;
  }

  getAgentLocation(agentAddress: `0x${string}`): Location | null {
    if (!this.gameState) return null;

    const player = this.gameState.players.find((p) => p.address === agentAddress);
    return player?.location ?? null;
  }

  getAgentRole(agentAddress: `0x${string}`): Role | null {
    return this.agentRoles.get(agentAddress) ?? null;
  }

  protected updateGameState(state: WorkerGameState): void {
    this.gameState = state;
    this.callbacks.onGameStateUpdate(state);
  }

  protected notifyRoleAssigned(
    agentAddress: `0x${string}`,
    role: Role,
    teammates: `0x${string}`[]
  ): void {
    this.agentRoles.set(agentAddress, role);
    this.callbacks.onRoleAssigned(agentAddress, role, teammates);
  }

  protected notifyActionRequest(
    agentAddress: `0x${string}`,
    phase: GamePhase,
    deadline: number
  ): void {
    this.callbacks.onActionRequest(agentAddress, phase, deadline);
  }

  protected notifyVotingStarted(duration: number, alivePlayers: `0x${string}`[]): void {
    this.callbacks.onVotingStarted(duration, alivePlayers);
  }

  protected notifyGameEnded(winner: 'crewmates' | 'impostors', reason: string): void {
    this.callbacks.onGameEnded(winner, reason);
  }

  protected notifyError(error: string): void {
    this.callbacks.onError(error);
  }
}

// ============ WebSocket Connection ============

export class WebSocketGameConnection extends BaseGameConnection {
  private ws: WebSocket | null = null;
  private signatureProvider: ((address: `0x${string}`) => Promise<string>) | null = null;

  setSignatureProvider(provider: (address: `0x${string}`) => Promise<string>): void {
    this.signatureProvider = provider;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const url = this.config.serverUrl || 'ws://localhost:8080';
    const wsUrl = `${url}/game/${this.config.gameId}`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.connected = true;
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(JSON.parse(event.data));
        };

        this.ws.onerror = () => {
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onclose = () => {
          this.connected = false;
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  async registerAgent(agentAddress: `0x${string}`): Promise<void> {
    if (!this.ws || !this.connected) {
      throw new Error('Not connected');
    }

    if (!this.signatureProvider) {
      throw new Error('No signature provider set');
    }

    const signature = await this.signatureProvider(agentAddress);

    this.ws.send(JSON.stringify({
      type: 'AUTH',
      payload: {
        agentAddress,
        gameId: this.config.gameId,
        signature,
        timestamp: Date.now(),
      },
    }));

    this.registeredAgents.add(agentAddress);
  }

  async submitAction(agentAddress: `0x${string}`, action: WorkerAction): Promise<boolean> {
    if (!this.ws || !this.connected) {
      return false;
    }

    try {
      const { type: actionType, ...actionData } = action;
      this.ws.send(JSON.stringify({
        type: actionType,
        agentAddress,
        ...actionData,
      }));
      return true;
    } catch {
      return false;
    }
  }

  private handleMessage(data: Record<string, unknown>): void {
    const type = data.type as string;

    switch (type) {
      case 'GAME_STATE_UPDATE':
        this.updateGameState(data.gameState as WorkerGameState);
        break;

      case 'ROLE_ASSIGNED':
        this.notifyRoleAssigned(
          data.agentAddress as `0x${string}`,
          data.role as Role,
          (data.teammates as `0x${string}`[]) || []
        );
        break;

      case 'REQUEST_ACTION':
        this.notifyActionRequest(
          data.agentAddress as `0x${string}`,
          data.phase as GamePhase,
          data.deadline as number
        );
        break;

      case 'VOTING_STARTED':
        this.notifyVotingStarted(
          data.duration as number,
          data.alivePlayers as `0x${string}`[]
        );
        break;

      case 'GAME_ENDED':
        this.notifyGameEnded(
          data.winner as 'crewmates' | 'impostors',
          data.reason as string
        );
        break;

      case 'ERROR':
        this.notifyError(data.message as string);
        break;
    }
  }
}
