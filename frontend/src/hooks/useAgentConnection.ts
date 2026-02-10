// Single Agent WebSocket Connection Hook with Action Helpers

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ConnectionState,
  ServerEvent,
  ServerEventType,
  WebSocketGameState,
  AgentConnectionStatus,
} from '@/lib/websocket/types';
import { AgentWebSocketClient } from '@/lib/websocket/AgentWebSocketClient';
import { GamePhase, SabotageType, Role, Location } from '@/types/game';

export interface UseAgentConnectionOptions {
  url?: string;
  autoConnect?: boolean;
  signatureProvider?: () => Promise<string>;
  onEvent?: (event: ServerEvent) => void;
}

export interface UseAgentConnectionReturn {
  // Connection state
  connectionState: ConnectionState;
  status: AgentConnectionStatus;
  error: string | null;

  // Connection actions
  connect: (signatureProvider?: () => Promise<string>) => Promise<void>;
  disconnect: () => void;

  // Game state
  gameState: WebSocketGameState | null;
  myRole: Role | null;
  teammates: `0x${string}`[];

  // Action methods
  move: (targetLocation: Location) => string;
  kill: (target: `0x${string}`) => string;
  reportBody: (bodyVictim: `0x${string}`) => string;
  vote: (target: `0x${string}` | null) => string;
  completeTask: (taskId: string) => string;
  sabotage: (sabotageType: SabotageType) => string;

  // Event tracking
  lastEvent: ServerEvent | null;
}

export function useAgentConnection(
  agentAddress: `0x${string}`,
  gameId: string,
  options: UseAgentConnectionOptions = {}
): UseAgentConnectionReturn {
  const { url, autoConnect = false, signatureProvider, onEvent } = options;

  const clientRef = useRef<AgentWebSocketClient | null>(null);

  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [error, setError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<ServerEvent | null>(null);
  const [gameState, setGameState] = useState<WebSocketGameState | null>(null);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [teammates, setTeammates] = useState<`0x${string}`[]>([]);

  // Initialize client
  useEffect(() => {
    const client = new AgentWebSocketClient(agentAddress, gameId, {
      url,
      onEvent: (event) => {
        setLastEvent(event);
        handleEvent(event);
        onEvent?.(event);
      },
      onStateChange: (state, errorMsg) => {
        setConnectionState(state);
        if (errorMsg) {
          setError(errorMsg);
        } else if (state === ConnectionState.Connected) {
          setError(null);
        }
      },
    });

    clientRef.current = client;

    return () => {
      client.disconnect();
    };
  }, [agentAddress, gameId, url]);

  // Handle events to update local state
  const handleEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case ServerEventType.GAME_STATE_UPDATE:
        setGameState((prev) => ({
          ...prev!,
          gameId,
          phase: event.phase,
          round: event.round,
          phaseEndTime: event.phaseEndTime,
          activeSabotage: event.activeSabotage,
          players: prev?.players || [],
          deadBodies: prev?.deadBodies || [],
          myRole: prev?.myRole || null,
          teammates: prev?.teammates || [],
        }));
        break;

      case ServerEventType.PLAYER_UPDATE:
        setGameState((prev) => ({
          ...prev!,
          gameId,
          phase: prev?.phase || GamePhase.Lobby,
          round: prev?.round || 0,
          phaseEndTime: prev?.phaseEndTime || 0,
          activeSabotage: prev?.activeSabotage || SabotageType.None,
          players: event.players,
          deadBodies: event.deadBodies,
          myRole: prev?.myRole || null,
          teammates: prev?.teammates || [],
        }));
        break;

      case ServerEventType.ROLE_ASSIGNED:
        setMyRole(event.role);
        setTeammates(event.teammates || []);
        setGameState((prev) =>
          prev
            ? { ...prev, myRole: event.role, teammates: event.teammates || [] }
            : null
        );
        break;

      case ServerEventType.PLAYER_KILLED:
        setGameState((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            deadBodies: [
              ...prev.deadBodies,
              {
                victim: event.victim,
                location: event.location,
                round: BigInt(event.round),
                reported: false,
              },
            ],
            players: prev.players.map((p) =>
              p.address === event.victim ? { ...p, isAlive: false } : p
            ),
          };
        });
        break;

      case ServerEventType.BODY_REPORTED:
        setGameState((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            deadBodies: prev.deadBodies.map((b) =>
              b.victim === event.victim ? { ...b, reported: true } : b
            ),
          };
        });
        break;

      case ServerEventType.VOTING_STARTED:
        setGameState((prev) =>
          prev ? { ...prev, phase: GamePhase.Voting } : null
        );
        break;

      case ServerEventType.PLAYER_EJECTED:
        setGameState((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            players: prev.players.map((p) =>
              p.address === event.player ? { ...p, isAlive: false } : p
            ),
          };
        });
        break;

      case ServerEventType.GAME_ENDED:
        setGameState((prev) =>
          prev
            ? {
                ...prev,
                phase: GamePhase.Ended,
                players: event.finalPlayers,
              }
            : null
        );
        break;
    }
  }, [gameId]);

  // Auto-connect
  useEffect(() => {
    if (autoConnect && signatureProvider && clientRef.current) {
      clientRef.current.connect(signatureProvider);
    }
  }, [autoConnect, signatureProvider]);

  // Connection methods
  const connect = useCallback(
    async (provider?: () => Promise<string>) => {
      const sig = provider || signatureProvider;
      if (!sig) {
        throw new Error('No signature provider');
      }
      if (clientRef.current) {
        await clientRef.current.connect(sig);
      }
    },
    [signatureProvider]
  );

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
  }, []);

  // Action methods
  const move = useCallback((targetLocation: Location): string => {
    if (!clientRef.current) return '';
    return clientRef.current.move(targetLocation);
  }, []);

  const kill = useCallback((target: `0x${string}`): string => {
    if (!clientRef.current) return '';
    return clientRef.current.kill(target);
  }, []);

  const reportBody = useCallback((bodyVictim: `0x${string}`): string => {
    if (!clientRef.current) return '';
    return clientRef.current.reportBody(bodyVictim);
  }, []);

  const vote = useCallback((target: `0x${string}` | null): string => {
    if (!clientRef.current) return '';
    return clientRef.current.vote(target);
  }, []);

  const completeTask = useCallback((taskId: string): string => {
    if (!clientRef.current) return '';
    return clientRef.current.completeTask(taskId);
  }, []);

  const sabotage = useCallback((sabotageType: SabotageType): string => {
    if (!clientRef.current) return '';
    return clientRef.current.sabotage(sabotageType);
  }, []);

  // Build status
  const status: AgentConnectionStatus = clientRef.current?.status || {
    agentAddress,
    state: connectionState,
    lastHeartbeat: null,
    reconnectAttempts: 0,
    error,
  };

  return {
    connectionState,
    status,
    error,
    connect,
    disconnect,
    gameState,
    myRole,
    teammates,
    move,
    kill,
    reportBody,
    vote,
    completeTask,
    sabotage,
    lastEvent,
  };
}
