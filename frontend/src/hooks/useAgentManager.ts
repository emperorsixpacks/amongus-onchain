// Multi-Agent Management Hook

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ConnectionState,
  WebSocketGameState,
  AgentConnectionStatus,
  AgentManagerState,
} from '@/lib/websocket/types';
import {
  AgentConnectionManager,
  SignatureProvider,
} from '@/lib/websocket/AgentConnectionManager';
import { GamePhase, SabotageType, Location } from '@/types/game';

export interface UseAgentManagerOptions {
  url?: string;
  autoConnect?: boolean;
}

export interface UseAgentManagerReturn {
  // State
  state: AgentManagerState;
  gameState: WebSocketGameState | null;
  connections: Map<`0x${string}`, AgentConnectionStatus>;
  isConnected: boolean;
  connectedAgents: `0x${string}`[];

  // Agent management
  addAgent: (agentAddress: `0x${string}`, signatureProvider: SignatureProvider) => void;
  removeAgent: (agentAddress: `0x${string}`) => void;

  // Connection management
  connectAgent: (agentAddress: `0x${string}`) => Promise<void>;
  connectAll: () => Promise<void>;
  disconnectAgent: (agentAddress: `0x${string}`) => void;
  disconnectAll: () => void;

  // Actions per agent
  move: (agentAddress: `0x${string}`, targetLocation: Location) => string | null;
  kill: (agentAddress: `0x${string}`, target: `0x${string}`) => string | null;
  reportBody: (agentAddress: `0x${string}`, bodyVictim: `0x${string}`) => string | null;
  vote: (agentAddress: `0x${string}`, target: `0x${string}` | null) => string | null;
  completeTask: (agentAddress: `0x${string}`, taskId: string) => string | null;
  sabotage: (agentAddress: `0x${string}`, sabotageType: SabotageType) => string | null;

  // Utility
  getConnectionState: (agentAddress: `0x${string}`) => ConnectionState | undefined;
}

export function useAgentManager(
  gameId: string,
  options: UseAgentManagerOptions = {}
): UseAgentManagerReturn {
  const { url, autoConnect = false } = options;

  const managerRef = useRef<AgentConnectionManager | null>(null);

  const [gameState, setGameState] = useState<WebSocketGameState | null>(null);
  const [connections, setConnections] = useState<Map<`0x${string}`, AgentConnectionStatus>>(
    new Map()
  );
  const [isConnected, setIsConnected] = useState(false);

  // Initialize manager
  useEffect(() => {
    const manager = new AgentConnectionManager(gameId, {
      url,
      onGameStateUpdate: (state) => {
        setGameState(state);
      },
      onConnectionsUpdate: (conns) => {
        setConnections(new Map(conns));
        // Check if any agent is connected
        let anyConnected = false;
        for (const status of conns.values()) {
          if (status.state === ConnectionState.Connected) {
            anyConnected = true;
            break;
          }
        }
        setIsConnected(anyConnected);
      },
    });

    managerRef.current = manager;

    return () => {
      manager.disconnectAll();
    };
  }, [gameId, url]);

  // Compute connected agents
  const connectedAgents: `0x${string}`[] = [];
  for (const [address, status] of connections) {
    if (status.state === ConnectionState.Connected) {
      connectedAgents.push(address);
    }
  }

  // Agent management
  const addAgent = useCallback(
    (agentAddress: `0x${string}`, signatureProvider: SignatureProvider) => {
      managerRef.current?.addAgent(agentAddress, signatureProvider);
    },
    []
  );

  const removeAgent = useCallback((agentAddress: `0x${string}`) => {
    managerRef.current?.removeAgent(agentAddress);
  }, []);

  // Connection management
  const connectAgent = useCallback(async (agentAddress: `0x${string}`) => {
    await managerRef.current?.connectAgent(agentAddress);
  }, []);

  const connectAll = useCallback(async () => {
    await managerRef.current?.connectAll();
  }, []);

  const disconnectAgent = useCallback((agentAddress: `0x${string}`) => {
    managerRef.current?.disconnectAgent(agentAddress);
  }, []);

  const disconnectAll = useCallback(() => {
    managerRef.current?.disconnectAll();
  }, []);

  // Actions
  const move = useCallback(
    (agentAddress: `0x${string}`, targetLocation: Location): string | null => {
      return managerRef.current?.move(agentAddress, targetLocation) ?? null;
    },
    []
  );

  const kill = useCallback(
    (agentAddress: `0x${string}`, target: `0x${string}`): string | null => {
      return managerRef.current?.kill(agentAddress, target) ?? null;
    },
    []
  );

  const reportBody = useCallback(
    (agentAddress: `0x${string}`, bodyVictim: `0x${string}`): string | null => {
      return managerRef.current?.reportBody(agentAddress, bodyVictim) ?? null;
    },
    []
  );

  const vote = useCallback(
    (agentAddress: `0x${string}`, target: `0x${string}` | null): string | null => {
      return managerRef.current?.vote(agentAddress, target) ?? null;
    },
    []
  );

  const completeTask = useCallback(
    (agentAddress: `0x${string}`, taskId: string): string | null => {
      return managerRef.current?.completeTask(agentAddress, taskId) ?? null;
    },
    []
  );

  const sabotage = useCallback(
    (agentAddress: `0x${string}`, sabotageType: SabotageType): string | null => {
      return managerRef.current?.sabotage(agentAddress, sabotageType) ?? null;
    },
    []
  );

  // Utility
  const getConnectionState = useCallback(
    (agentAddress: `0x${string}`): ConnectionState | undefined => {
      return connections.get(agentAddress)?.state;
    },
    [connections]
  );

  // Build state
  const state: AgentManagerState = {
    connections,
    gameState,
    isConnected,
    pendingActions: new Map(),
  };

  return {
    state,
    gameState,
    connections,
    isConnected,
    connectedAgents,
    addAgent,
    removeAgent,
    connectAgent,
    connectAll,
    disconnectAgent,
    disconnectAll,
    move,
    kill,
    reportBody,
    vote,
    completeTask,
    sabotage,
    getConnectionState,
  };
}
