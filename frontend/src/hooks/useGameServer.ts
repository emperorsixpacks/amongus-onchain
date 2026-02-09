"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Player, DeadBody, Location, Role, GameLog, GamePhase } from "@/types/game";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080";

interface RoomState {
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
}

interface ServerMessage {
  type: string;
  [key: string]: any;
}

export interface UseGameServerReturn {
  // Connection
  isConnected: boolean;
  connectionId: string | null;
  error: string | null;

  // Rooms
  rooms: RoomState[];
  currentRoom: RoomState | null;

  // Game state (derived from current room)
  players: Player[];
  deadBodies: DeadBody[];
  logs: GameLog[];
  phase: GamePhase;
  tasksCompleted: number;
  totalTasks: number;

  // Actions
  createRoom: (maxPlayers?: number, impostorCount?: number) => void;
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
  const [deadBodies, setDeadBodies] = useState<DeadBody[]>([]);
  const [logs, setLogs] = useState<GameLog[]>([]);

  const addLog = useCallback((type: GameLog["type"], message: string) => {
    setLogs((prev) => [...prev.slice(-49), { type, message, timestamp: Date.now() }]);
  }, []);

  const send = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const handleMessage = useCallback((data: string) => {
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
          break;

        case "server:room_created":
          addLog("start", `Room ${message.room.roomId} created`);
          break;

        case "server:room_update":
          setCurrentRoom(message.room);
          // Clear dead bodies on room update (fresh state)
          if (message.room.phase === "lobby") {
            setDeadBodies([]);
          }
          break;

        case "server:player_joined":
          addLog("join", `Player joined (color ${message.player.colorId})`);
          setCurrentRoom((prev) => {
            if (!prev) return prev;
            const exists = prev.players.some(
              (p) => p.address === message.player.address
            );
            if (exists) return prev;
            return { ...prev, players: [...prev.players, message.player] };
          });
          break;

        case "server:player_left":
          addLog("join", `Player left`);
          setCurrentRoom((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              players: prev.players.filter(
                (p) => p.address !== message.address
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
                  : p
              ),
            };
          });
          break;

        case "server:kill_occurred":
          addLog("kill", `A player was eliminated!`);
          setCurrentRoom((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              players: prev.players.map((p) =>
                p.address === message.victim ? { ...p, isAlive: false } : p
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
          addLog("start", `Phase changed to ${message.phase}`);
          break;

        case "server:task_completed":
          addLog("task", `Task completed`);
          setCurrentRoom((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              players: prev.players.map((p) =>
                p.address === message.player
                  ? {
                      ...p,
                      tasksCompleted: message.tasksCompleted,
                      totalTasks: message.totalTasks,
                    }
                  : p
              ),
            };
          });
          break;

        case "server:vote_cast":
          addLog("vote", `Vote cast`);
          setCurrentRoom((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              players: prev.players.map((p) =>
                p.address === message.voter ? { ...p, hasVoted: true } : p
              ),
            };
          });
          break;

        case "server:game_ended":
          addLog("start", message.crewmatesWon ? "Crewmates win!" : "Impostors win!");
          break;
      }
    } catch (err) {
      console.error("Failed to parse message:", err);
    }
  }, [addLog]);

  // Connect on mount
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      handleMessage(event.data);
    };

    ws.onclose = () => {
      setIsConnected(false);
      setConnectionId(null);
    };

    ws.onerror = () => {
      setError("Connection failed");
    };

    return () => {
      ws.close();
    };
  }, [handleMessage]);

  // Actions
  const createRoom = useCallback((maxPlayers = 10, impostorCount = 2) => {
    send({ type: "client:create_room", maxPlayers, impostorCount });
  }, [send]);

  const joinRoom = useCallback((roomId: string, asSpectator = true) => {
    send({ type: "client:join_room", roomId, asSpectator });
    setLogs([{ type: "start", message: `Joining room ${roomId}...`, timestamp: Date.now() }]);
    setDeadBodies([]);
  }, [send]);

  const leaveRoom = useCallback(() => {
    if (currentRoom) {
      send({ type: "client:leave_room", roomId: currentRoom.roomId });
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
  const players: Player[] = currentRoom?.players.map((p) => ({
    address: p.address as `0x${string}`,
    colorId: p.colorId,
    role: Role.None, // Hidden
    location: p.location as Location,
    isAlive: p.isAlive,
    tasksCompleted: p.tasksCompleted,
    totalTasks: p.totalTasks,
    hasVoted: p.hasVoted,
  })) || [];

  const phase: GamePhase = currentRoom?.phase === "playing"
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
