// Multi-Agent Connection Manager

import {
  ConnectionState,
  ServerEvent,
  ServerEventType,
  AgentConnectionStatus,
  WebSocketGameState,
  AgentManagerState,
} from './types';
import { GamePhase, SabotageType, Player, DeadBody, Role } from '@/types/game';
import { AgentWebSocketClient, AgentWebSocketClientOptions } from './AgentWebSocketClient';

export type SignatureProvider = (agentAddress: `0x${string}`) => Promise<string>;
export type GameStateHandler = (state: WebSocketGameState) => void;
export type ConnectionsHandler = (connections: Map<`0x${string}`, AgentConnectionStatus>) => void;

export interface AgentConnectionManagerOptions {
  url?: string;
  onGameStateUpdate?: GameStateHandler;
  onConnectionsUpdate?: ConnectionsHandler;
}

export class AgentConnectionManager {
  private clients: Map<`0x${string}`, AgentWebSocketClient> = new Map();
  private signatureProviders: Map<`0x${string}`, SignatureProvider> = new Map();
  private gameState: WebSocketGameState;
  private options: AgentConnectionManagerOptions;

  private onGameStateUpdate: GameStateHandler | null = null;
  private onConnectionsUpdate: ConnectionsHandler | null = null;

  constructor(gameId: string, options: AgentConnectionManagerOptions = {}) {
    this.options = options;
    this.onGameStateUpdate = options.onGameStateUpdate || null;
    this.onConnectionsUpdate = options.onConnectionsUpdate || null;

    // Initialize empty game state
    this.gameState = {
      gameId,
      phase: GamePhase.Lobby,
      round: 0,
      phaseEndTime: 0,
      players: [],
      deadBodies: [],
      activeSabotage: SabotageType.None,
      myRole: null,
      teammates: [],
    };
  }

  // ============ Public API ============

  get state(): AgentManagerState {
    const connections = new Map<`0x${string}`, AgentConnectionStatus>();

    for (const [address, client] of this.clients) {
      connections.set(address, client.status);
    }

    return {
      connections,
      gameState: this.gameState,
      isConnected: this.isAnyConnected(),
      pendingActions: new Map(),
    };
  }

  get connectedAgents(): `0x${string}`[] {
    const connected: `0x${string}`[] = [];

    for (const [address, client] of this.clients) {
      if (client.connectionState === ConnectionState.Connected) {
        connected.push(address);
      }
    }

    return connected;
  }

  addAgent(
    agentAddress: `0x${string}`,
    signatureProvider: SignatureProvider
  ): void {
    if (this.clients.has(agentAddress)) {
      console.warn(`Agent ${agentAddress} already registered`);
      return;
    }

    this.signatureProviders.set(agentAddress, signatureProvider);

    const clientOptions: AgentWebSocketClientOptions = {
      url: this.options.url,
      onEvent: (event) => this.handleAgentEvent(agentAddress, event),
      onStateChange: (state, error) => this.handleAgentStateChange(agentAddress, state, error),
    };

    const client = new AgentWebSocketClient(
      agentAddress,
      this.gameState.gameId!,
      clientOptions
    );

    this.clients.set(agentAddress, client);
    this.notifyConnectionsUpdate();
  }

  removeAgent(agentAddress: `0x${string}`): void {
    const client = this.clients.get(agentAddress);

    if (client) {
      client.disconnect();
      this.clients.delete(agentAddress);
      this.signatureProviders.delete(agentAddress);
      this.notifyConnectionsUpdate();
    }
  }

  async connectAgent(agentAddress: `0x${string}`): Promise<void> {
    const client = this.clients.get(agentAddress);
    const signatureProvider = this.signatureProviders.get(agentAddress);

    if (!client || !signatureProvider) {
      throw new Error(`Agent ${agentAddress} not registered`);
    }

    await client.connect(() => signatureProvider(agentAddress));
  }

  async connectAll(): Promise<void> {
    const connectPromises: Promise<void>[] = [];

    for (const agentAddress of this.clients.keys()) {
      connectPromises.push(this.connectAgent(agentAddress));
    }

    await Promise.allSettled(connectPromises);
  }

  disconnectAgent(agentAddress: `0x${string}`): void {
    const client = this.clients.get(agentAddress);

    if (client) {
      client.disconnect();
    }
  }

  disconnectAll(): void {
    for (const client of this.clients.values()) {
      client.disconnect();
    }
  }

  // ============ Action Methods ============

  getClient(agentAddress: `0x${string}`): AgentWebSocketClient | undefined {
    return this.clients.get(agentAddress);
  }

  move(agentAddress: `0x${string}`, targetLocation: number): string | null {
    const client = this.clients.get(agentAddress);
    return client ? client.move(targetLocation) : null;
  }

  kill(agentAddress: `0x${string}`, target: `0x${string}`): string | null {
    const client = this.clients.get(agentAddress);
    return client ? client.kill(target) : null;
  }

  reportBody(agentAddress: `0x${string}`, bodyVictim: `0x${string}`): string | null {
    const client = this.clients.get(agentAddress);
    return client ? client.reportBody(bodyVictim) : null;
  }

  vote(agentAddress: `0x${string}`, target: `0x${string}` | null): string | null {
    const client = this.clients.get(agentAddress);
    return client ? client.vote(target) : null;
  }

  completeTask(agentAddress: `0x${string}`, taskId: string): string | null {
    const client = this.clients.get(agentAddress);
    return client ? client.completeTask(taskId) : null;
  }

  sabotage(agentAddress: `0x${string}`, sabotageType: number): string | null {
    const client = this.clients.get(agentAddress);
    return client ? client.sabotage(sabotageType) : null;
  }

  // ============ Private Methods ============

  private handleAgentEvent(agentAddress: `0x${string}`, event: ServerEvent): void {
    switch (event.type) {
      case ServerEventType.GAME_STATE_UPDATE:
        this.gameState = {
          ...this.gameState,
          phase: event.phase,
          round: event.round,
          phaseEndTime: event.phaseEndTime,
          activeSabotage: event.activeSabotage,
        };
        this.notifyGameStateUpdate();
        break;

      case ServerEventType.PLAYER_UPDATE:
        this.gameState = {
          ...this.gameState,
          players: event.players,
          deadBodies: event.deadBodies,
        };
        this.notifyGameStateUpdate();
        break;

      case ServerEventType.ROLE_ASSIGNED:
        // Only update for the specific agent
        // In a real implementation, each agent would have their own role tracking
        this.gameState = {
          ...this.gameState,
          myRole: event.role,
          teammates: event.teammates || [],
        };
        this.notifyGameStateUpdate();
        break;

      case ServerEventType.PLAYER_KILLED:
        this.gameState = {
          ...this.gameState,
          deadBodies: [
            ...this.gameState.deadBodies,
            {
              victim: event.victim,
              location: event.location,
              round: BigInt(event.round),
              reported: false,
            },
          ],
          players: this.gameState.players.map((p) =>
            p.address === event.victim ? { ...p, isAlive: false } : p
          ),
        };
        this.notifyGameStateUpdate();
        break;

      case ServerEventType.BODY_REPORTED:
        this.gameState = {
          ...this.gameState,
          deadBodies: this.gameState.deadBodies.map((b) =>
            b.victim === event.victim ? { ...b, reported: true } : b
          ),
        };
        this.notifyGameStateUpdate();
        break;

      case ServerEventType.VOTING_STARTED:
        this.gameState = {
          ...this.gameState,
          phase: GamePhase.Voting,
        };
        this.notifyGameStateUpdate();
        break;

      case ServerEventType.PLAYER_EJECTED:
        this.gameState = {
          ...this.gameState,
          players: this.gameState.players.map((p) =>
            p.address === event.player ? { ...p, isAlive: false } : p
          ),
        };
        this.notifyGameStateUpdate();
        break;

      case ServerEventType.GAME_ENDED:
        this.gameState = {
          ...this.gameState,
          phase: GamePhase.Ended,
          players: event.finalPlayers,
        };
        this.notifyGameStateUpdate();
        break;
    }
  }

  private handleAgentStateChange(
    agentAddress: `0x${string}`,
    state: ConnectionState,
    error?: string
  ): void {
    this.notifyConnectionsUpdate();

    // Handle reconnection
    if (state === ConnectionState.Reconnecting) {
      const signatureProvider = this.signatureProviders.get(agentAddress);
      if (signatureProvider) {
        // Schedule reconnection attempt
        setTimeout(() => {
          this.connectAgent(agentAddress).catch((err) => {
            console.error(`Failed to reconnect agent ${agentAddress}:`, err);
          });
        }, 100);
      }
    }
  }

  private isAnyConnected(): boolean {
    for (const client of this.clients.values()) {
      if (client.connectionState === ConnectionState.Connected) {
        return true;
      }
    }
    return false;
  }

  private notifyGameStateUpdate(): void {
    if (this.onGameStateUpdate) {
      this.onGameStateUpdate(this.gameState);
    }
  }

  private notifyConnectionsUpdate(): void {
    if (this.onConnectionsUpdate) {
      const connections = new Map<`0x${string}`, AgentConnectionStatus>();

      for (const [address, client] of this.clients) {
        connections.set(address, client.status);
      }

      this.onConnectionsUpdate(connections);
    }
  }
}
