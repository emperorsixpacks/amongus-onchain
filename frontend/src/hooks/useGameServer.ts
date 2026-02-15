"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Player,
  DeadBody,
  Location,
  Role,
  GameLog,
  GamePhase,
} from "@/types/game";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080";

export interface RoomState {
  roomId: string;
  players: Array<{
    address: string;
    colorId: number;
    location: number;
    isAlive: boolean;
    tasksCompleted: number;
    totalTasks: number;
    hasVoted: boolean;
  }>;
  spectators: string[];
  maxPlayers: number;
  impostorCount: number;
  phase: "lobby" | "playing" | "ended";
  createdAt: number;
  creator?: string;
  wagerAmount?: string;
}

interface ServerMessage {
  type: string;
  [key: string]: any;
}

interface RoomSlotInfo {
  id: number;
  state: "active" | "cooldown" | "empty";
  roomId: string | null;
  cooldownEndTime: number | null;
  cooldownRemaining: number | null;
}

interface AgentStats {
  address: string;
  name: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  kills: number;
  tasksCompleted: number;
  timesImpostor: number;
  timesCrewmate: number;
  lastSeen: number;
}

interface ServerStats {
  connections: {
    total: number;
    agents: number;
    spectators: number;
  };
  rooms: {
    total: number;
    maxRooms?: number;
    lobby: number;
    playing: number;
    totalPlayers: number;
  };
  limits: {
    maxRooms?: number;
    maxPlayersPerRoom: number;
    minPlayersToStart: number;
    fillWaitDuration?: number;
    cooldownDuration?: number;
  };
  slots?: RoomSlotInfo[];
}

export interface UseGameServerReturn {
  // Connection
  isConnected: boolean;
  connectionId: string | null;
  error: string | null;

  // Rooms
  rooms: RoomState[];
  currentRoom: RoomState | null;

  // Server stats
  stats: ServerStats | null;

  // Leaderboard
  leaderboard: AgentStats[];

  // Game state (derived from current room)
  players: Player[];
  deadBodies: DeadBody[];
  logs: GameLog[];
  phase: GamePhase;
  tasksCompleted: number;
  totalTasks: number;

  // Actions
  createRoom: (
    maxPlayers?: number,
    impostorCount?: number,
    wagerAmount?: string,
  ) => void;
  joinRoom: (roomId: string, asSpectator?: boolean) => void;
  leaveRoom: () => void;
  startGame: () => void;
}

export function useGameServer(): UseGameServerReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rooms, setRooms] = useState<RoomState[]>([]);
  const [currentRoom, setCurrentRoom] = useState<RoomState | null>(null);
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<AgentStats[]>([]);
  const [deadBodies, setDeadBodies] = useState<DeadBody[]>([]);
  const [logs, setLogs] = useState<GameLog[]>([]);

  // Track current room ID for filtering logs
  const currentRoomIdRef = useRef<string | null>(null);

  const addLog = useCallback(
    (type: GameLog["type"], message: string, gameId?: string) => {
      // Only add log if it's for the current room or no room specified (global events)
      if (
        gameId &&
        currentRoomIdRef.current &&
        gameId !== currentRoomIdRef.current
      ) {
        return; // Skip logs from other rooms
      }
      setLogs((prev) => [
        ...prev.slice(-49),
        { type, message, timestamp: Date.now() },
      ]);
    },
    [],
  );

  const send = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const handleMessage = useCallback(
    (data: string) => {
      try {
        const message = JSON.parse(data) as ServerMessage;

        switch (message.type) {
          case "server:welcome":
            setConnectionId(message.connectionId);
            addLog("start", "Connected to game server");
            break;

          case "server:error":
            setError(message.message);
            addLog("start", `Error: ${message.message}`);
            break;

          case "server:room_list":
            setRooms(message.rooms);
            if (message.stats) {
              setStats(message.stats);
            }
            break;

          case "server:leaderboard":
            setLeaderboard(message.agents || []);
            break;

          case "server:room_created":
            addLog("start", `Room ${message.room.roomId} created`);
            break;

          case "server:room_update":
            setCurrentRoom(message.room);
            currentRoomIdRef.current = message.room.roomId;
            // Clear dead bodies on room update (fresh state)
            if (message.room.phase === "lobby") {
              setDeadBodies([]);
              setLogs([]); // Clear logs when entering a new room lobby
            }
            break;

          case "server:player_joined":
            addLog(
              "join",
              `Player joined (color ${message.player.colorId})`,
              message.gameId,
            );
            setCurrentRoom((prev) => {
              if (!prev || prev.roomId !== message.gameId) return prev;
              const exists = prev.players.some(
                (p) => p.address === message.player.address,
              );
              if (exists) return prev;
              return { ...prev, players: [...prev.players, message.player] };
            });
            break;

          case "server:player_left":
            addLog("join", `Player left`, message.gameId);
            setCurrentRoom((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                players: prev.players.filter(
                  (p) => p.address !== message.address,
                ),
              };
            });
            break;

          case "server:player_moved":
            setCurrentRoom((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                players: prev.players.map((p) =>
                  p.address === message.address
                    ? { ...p, location: message.to }
                    : p,
                ),
              };
            });
            break;

          case "server:kill_occurred":
            addLog("kill", `A player was eliminated!`, message.gameId);
            setCurrentRoom((prev) => {
              if (!prev || prev.roomId !== message.gameId) return prev;
              return {
                ...prev,
                players: prev.players.map((p) =>
                  p.address === message.victim ? { ...p, isAlive: false } : p,
                ),
              };
            });
            setDeadBodies((prev) => [
              ...prev,
              {
                victim: message.victim as `0x${string}`,
                location: message.location as Location,
                round: BigInt(message.round),
                reported: false,
              },
            ]);
            break;

          case "server:phase_changed":
            addLog(
              "start",
              `Phase changed to ${message.phase}`,
              message.gameId,
            );
            break;

          case "server:task_completed":
            addLog("task", `Task completed`, message.gameId);
            setCurrentRoom((prev) => {
              if (!prev || prev.roomId !== message.gameId) return prev;
              return {
                ...prev,
                players: prev.players.map((p) =>
                  p.address === message.player
                    ? {
                        ...p,
                        tasksCompleted: message.tasksCompleted,
                        totalTasks: message.totalTasks,
                      }
                    : p,
                ),
              };
            });
            break;

          case "server:vote_cast":
            addLog("vote", `Vote cast`, message.gameId);
            setCurrentRoom((prev) => {
              if (!prev || prev.roomId !== message.gameId) return prev;
              return {
                ...prev,
                players: prev.players.map((p) =>
                  p.address === message.voter ? { ...p, hasVoted: true } : p,
                ),
              };
            });
            break;

          case "server:body_reported":
            addLog(
              "kill",
              `Body reported! ${message.reporter} found ${message.victim}`,
              message.gameId,
            );
            // Mark body as reported
            setDeadBodies((prev) =>
              prev.map((b) =>
                b.victim === message.victim ? { ...b, reported: true } : b,
              ),
            );
            break;

          case "server:player_ejected":
            addLog(
              "vote",
              `${message.ejected} was ejected. ${message.wasImpostor ? "They were an Impostor!" : "They were a Crewmate."}`,
              message.gameId,
            );
            // Mark player as dead
            setCurrentRoom((prev) => {
              if (!prev || prev.roomId !== message.gameId) return prev;
              return {
                ...prev,
                players: prev.players.map((p) =>
                  p.address === message.ejected ? { ...p, isAlive: false } : p,
                ),
              };
            });
            break;

          case "server:game_ended":
            addLog(
              "start",
              message.crewmatesWon ? "Crewmates win!" : "Impostors win!",
              message.gameId,
            );
            break;
        }
      } catch (err) {
        console.error("Failed to parse message:", err);
      }
    },
    [addLog],
  );

  // Store handleMessage in a ref to avoid reconnection loops
  const handleMessageRef = useRef(handleMessage);
  handleMessageRef.current = handleMessage;

  // Connect on mount (only once)
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      handleMessageRef.current(event.data);
    };

    ws.onclose = () => {
      setIsConnected(false);
      setConnectionId(null);
    };

    ws.onerror = (e) => {
      console.error("WebSocket error:", e);
      setError("Connection failed");
    };

    return () => {
      ws.close();
    };
  }, []); // Empty deps - only connect once

  // Actions
  const createRoom = useCallback(
    (maxPlayers = 10, impostorCount = 2, wagerAmount?: string) => {
      send({
        type: "client:create_room",
        maxPlayers,
        impostorCount,
        wagerAmount,
      });
    },
    [send],
  );

  const joinRoom = useCallback(
    (roomId: string, asSpectator = true) => {
      send({ type: "client:join_room", roomId, asSpectator });
      currentRoomIdRef.current = roomId;
      setLogs([
        {
          type: "start",
          message: `Joining room ${roomId}...`,
          timestamp: Date.now(),
        },
      ]);
      setDeadBodies([]);
    },
    [send],
  );

  const leaveRoom = useCallback(() => {
    if (currentRoom) {
      send({ type: "client:leave_room", roomId: currentRoom.roomId });
      currentRoomIdRef.current = null;
      setCurrentRoom(null);
      setDeadBodies([]);
      setLogs([]);
    }
  }, [send, currentRoom]);

  const startGame = useCallback(() => {
    if (currentRoom) {
      send({ type: "client:start_game", roomId: currentRoom.roomId });
    }
  }, [send, currentRoom]);

  // Derive player list from current room
  const players: Player[] =
    currentRoom?.players.map((p) => ({
      address: p.address as `0x${string}`,
      colorId: p.colorId,
      role: Role.None, // Hidden
      location: p.location as Location,
      isAlive: p.isAlive,
      tasksCompleted: p.tasksCompleted,
      totalTasks: p.totalTasks,
      hasVoted: p.hasVoted,
    })) || [];

  const phase: GamePhase =
    currentRoom?.phase === "playing"
      ? GamePhase.ActionCommit
      : currentRoom?.phase === "ended"
        ? GamePhase.Ended
        : GamePhase.Lobby;

  const tasksCompleted = players.reduce((sum, p) => sum + p.tasksCompleted, 0);
  const totalTasks = players.reduce((sum, p) => sum + p.totalTasks, 0);

  return {
    isConnected,
    connectionId,
    error,
    rooms,
    currentRoom,
    stats,
    leaderboard,
    players,
    deadBodies,
    logs,
    phase,
    tasksCompleted,
    totalTasks,
    createRoom,
    joinRoom,
    leaveRoom,
    startGame,
  };
}
