"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Player, GameState, DeadBody, Location, GamePhase } from "@/types/game";

// ============ MESSAGE TYPES ============

interface ServerWelcomeMessage {
  type: "server:welcome";
  connectionId: string;
  timestamp: number;
}

interface ServerErrorMessage {
  type: "server:error";
  code: string;
  message: string;
}

interface ServerPlayerJoinedMessage {
  type: "server:player_joined";
  gameId: string;
  player: {
    address: string;
    colorId: number;
    location: number;
    isAlive: boolean;
    tasksCompleted: number;
    totalTasks: number;
    hasVoted: boolean;
  };
}

interface ServerPlayerLeftMessage {
  type: "server:player_left";
  gameId: string;
  address: string;
}

interface ServerPlayerMovedMessage {
  type: "server:player_moved";
  gameId: string;
  address: string;
  from: number;
  to: number;
  round: number;
  timestamp: number;
}

interface ServerGameStateMessage {
  type: "server:game_state";
  gameId: string;
  state: {
    gameId: string;
    phase: number;
    round: number;
    phaseEndTime: number;
    players: Array<{
      address: string;
      colorId: number;
      location: number;
      isAlive: boolean;
      tasksCompleted: number;
      totalTasks: number;
      hasVoted: boolean;
    }>;
    deadBodies: Array<{
      victim: string;
      location: number;
      round: number;
      reported: boolean;
    }>;
    alivePlayers: number;
    totalTasksCompleted: number;
    totalTasksRequired: number;
    activeSabotage: number;
  };
}

interface ServerKillOccurredMessage {
  type: "server:kill_occurred";
  gameId: string;
  killer: string;
  victim: string;
  location: number;
  round: number;
  timestamp: number;
}

interface ServerPhaseChangedMessage {
  type: "server:phase_changed";
  gameId: string;
  phase: number;
  previousPhase: number;
  round: number;
  phaseEndTime: number;
  timestamp: number;
}

interface ServerVoteCastMessage {
  type: "server:vote_cast";
  gameId: string;
  voter: string;
  target: string | null;
  round: number;
  timestamp: number;
}

interface ServerTaskCompletedMessage {
  type: "server:task_completed";
  gameId: string;
  player: string;
  tasksCompleted: number;
  totalTasks: number;
  totalProgress: number;
  timestamp: number;
}

interface ServerGameEndedMessage {
  type: "server:game_ended";
  gameId: string;
  crewmatesWon: boolean;
  reason: "tasks" | "votes" | "kills";
  timestamp: number;
}

type ServerMessage =
  | ServerWelcomeMessage
  | ServerErrorMessage
  | ServerPlayerJoinedMessage
  | ServerPlayerLeftMessage
  | ServerPlayerMovedMessage
  | ServerGameStateMessage
  | ServerKillOccurredMessage
  | ServerPhaseChangedMessage
  | ServerVoteCastMessage
  | ServerTaskCompletedMessage
  | ServerGameEndedMessage;

// ============ HOOK STATE ============

export interface WebSocketGameState {
  phase: GamePhase;
  round: number;
  phaseEndTime: number;
  players: Player[];
  deadBodies: DeadBody[];
  alivePlayers: number;
  totalTasksCompleted: number;
  totalTasksRequired: number;
}

export interface WebSocketEvent {
  type: string;
  data: any;
  timestamp: number;
}

export interface UseWebSocketOptions {
  serverUrl: string;
  gameId?: string;
  enabled?: boolean;
  onEvent?: (event: WebSocketEvent) => void;
}

export interface UseWebSocketReturn {
  isConnected: boolean;
  connectionId: string | null;
  gameState: WebSocketGameState | null;
  events: WebSocketEvent[];
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  joinGame: (gameId: string) => void;
  leaveGame: () => void;
}

export function useWebSocket({
  serverUrl,
  gameId,
  enabled = true,
  onEvent,
}: UseWebSocketOptions): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<WebSocketGameState | null>(null);
  const [events, setEvents] = useState<WebSocketEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const currentGameIdRef = useRef<string | null>(null);

  // Add event to history
  const addEvent = useCallback(
    (type: string, data: any) => {
      const event: WebSocketEvent = {
        type,
        data,
        timestamp: Date.now(),
      };
      setEvents((prev) => [...prev.slice(-99), event]); // Keep last 100 events
      onEvent?.(event);
    },
    [onEvent]
  );

  // Handle incoming messages
  const handleMessage = useCallback(
    (data: string) => {
      try {
        const message = JSON.parse(data) as ServerMessage;

        switch (message.type) {
          case "server:welcome":
            setConnectionId(message.connectionId);
            addEvent("connected", { connectionId: message.connectionId });
            break;

          case "server:error":
            setError(message.message);
            addEvent("error", { code: message.code, message: message.message });
            break;

          case "server:game_state":
            setGameState({
              phase: message.state.phase as GamePhase,
              round: message.state.round,
              phaseEndTime: message.state.phaseEndTime,
              players: message.state.players.map((p) => ({
                address: p.address as `0x${string}`,
                colorId: p.colorId,
                role: 0, // Unknown from spectator view
                location: p.location as Location,
                isAlive: p.isAlive,
                tasksCompleted: p.tasksCompleted,
                totalTasks: p.totalTasks,
                hasVoted: p.hasVoted,
              })),
              deadBodies: message.state.deadBodies.map((b) => ({
                victim: b.victim as `0x${string}`,
                location: b.location as Location,
                round: BigInt(b.round),
                reported: b.reported,
              })),
              alivePlayers: message.state.alivePlayers,
              totalTasksCompleted: message.state.totalTasksCompleted,
              totalTasksRequired: message.state.totalTasksRequired,
            });
            addEvent("game_state", message.state);
            break;

          case "server:player_joined":
            setGameState((prev) => {
              if (!prev) return prev;
              const newPlayer: Player = {
                address: message.player.address as `0x${string}`,
                colorId: message.player.colorId,
                role: 0,
                location: message.player.location as Location,
                isAlive: message.player.isAlive,
                tasksCompleted: message.player.tasksCompleted,
                totalTasks: message.player.totalTasks,
                hasVoted: message.player.hasVoted,
              };
              return {
                ...prev,
                players: [...prev.players, newPlayer],
                alivePlayers: prev.alivePlayers + 1,
              };
            });
            addEvent("player_joined", message.player);
            break;

          case "server:player_left":
            setGameState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                players: prev.players.filter(
                  (p) => p.address.toLowerCase() !== message.address.toLowerCase()
                ),
              };
            });
            addEvent("player_left", { address: message.address });
            break;

          case "server:player_moved":
            setGameState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                players: prev.players.map((p) =>
                  p.address.toLowerCase() === message.address.toLowerCase()
                    ? { ...p, location: message.to as Location }
                    : p
                ),
              };
            });
            addEvent("player_moved", {
              address: message.address,
              from: message.from,
              to: message.to,
              round: message.round,
            });
            break;

          case "server:kill_occurred":
            setGameState((prev) => {
              if (!prev) return prev;
              const newBody: DeadBody = {
                victim: message.victim as `0x${string}`,
                location: message.location as Location,
                round: BigInt(message.round),
                reported: false,
              };
              return {
                ...prev,
                players: prev.players.map((p) =>
                  p.address.toLowerCase() === message.victim.toLowerCase()
                    ? { ...p, isAlive: false }
                    : p
                ),
                deadBodies: [...prev.deadBodies, newBody],
                alivePlayers: prev.alivePlayers - 1,
              };
            });
            addEvent("kill", {
              killer: message.killer,
              victim: message.victim,
              location: message.location,
            });
            break;

          case "server:phase_changed":
            setGameState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                phase: message.phase as GamePhase,
                round: message.round,
                phaseEndTime: message.phaseEndTime,
              };
            });
            addEvent("phase_changed", {
              phase: message.phase,
              previousPhase: message.previousPhase,
              round: message.round,
            });
            break;

          case "server:vote_cast":
            setGameState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                players: prev.players.map((p) =>
                  p.address.toLowerCase() === message.voter.toLowerCase()
                    ? { ...p, hasVoted: true }
                    : p
                ),
              };
            });
            addEvent("vote_cast", {
              voter: message.voter,
              target: message.target,
            });
            break;

          case "server:task_completed":
            setGameState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                players: prev.players.map((p) =>
                  p.address.toLowerCase() === message.player.toLowerCase()
                    ? {
                        ...p,
                        tasksCompleted: message.tasksCompleted,
                        totalTasks: message.totalTasks,
                      }
                    : p
                ),
                totalTasksCompleted: Math.round(
                  (message.totalProgress / 100) * prev.totalTasksRequired
                ),
              };
            });
            addEvent("task_completed", {
              player: message.player,
              tasksCompleted: message.tasksCompleted,
              totalProgress: message.totalProgress,
            });
            break;

          case "server:game_ended":
            addEvent("game_ended", {
              crewmatesWon: message.crewmatesWon,
              reason: message.reason,
            });
            break;
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    },
    [addEvent]
  );

  // Connect to WebSocket server
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(serverUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setError(null);

        // Auto-join game if gameId provided
        if (currentGameIdRef.current) {
          ws.send(
            JSON.stringify({
              type: "spectator:join_game",
              gameId: currentGameIdRef.current,
            })
          );
        }
      };

      ws.onmessage = (event) => {
        handleMessage(event.data);
      };

      ws.onclose = () => {
        setIsConnected(false);
        setConnectionId(null);
      };

      ws.onerror = () => {
        setError("WebSocket connection error");
      };
    } catch (err) {
      setError("Failed to connect to WebSocket server");
    }
  }, [serverUrl, handleMessage]);

  // Disconnect from WebSocket server
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setConnectionId(null);
    setGameState(null);
  }, []);

  // Join a game room
  const joinGame = useCallback((newGameId: string) => {
    currentGameIdRef.current = newGameId;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "agent:join_game",
          gameId: newGameId,
          colorId: 0, // Spectators don't need color
        })
      );
    }
  }, []);

  // Leave current game room
  const leaveGame = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && currentGameIdRef.current) {
      wsRef.current.send(
        JSON.stringify({
          type: "agent:leave_game",
          gameId: currentGameIdRef.current,
        })
      );
    }
    currentGameIdRef.current = null;
    setGameState(null);
  }, []);

  // Auto-connect when enabled
  useEffect(() => {
    if (enabled && serverUrl) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, serverUrl, connect, disconnect]);

  // Auto-join game when gameId changes
  useEffect(() => {
    if (gameId && isConnected) {
      joinGame(gameId);
    }
  }, [gameId, isConnected, joinGame]);

  return {
    isConnected,
    connectionId,
    gameState,
    events,
    error,
    connect,
    disconnect,
    joinGame,
    leaveGame,
  };
}
