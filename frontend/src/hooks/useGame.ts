"use client";

import { useReadContract, useWriteContract, useWatchContractEvent } from "wagmi";
import { AmongUsGameABI, AmongUsGameFactoryABI } from "@/lib/abi";
import { CONTRACT_ADDRESSES } from "@/lib/wagmi";
import {
  Player,
  GameState,
  GameConfig,
  DeadBody,
  GamePhase,
  Location,
  Role,
  SabotageType,
} from "@/types/game";
import { useState, useCallback, useEffect, useMemo } from "react";
import type { Address } from "viem";
import { useWebSocket, type WebSocketGameState } from "./useWebSocket";

interface UseGameOptions {
  gameId?: bigint;
  gameAddress?: Address;
  wsServerUrl?: string; // WebSocket server URL (optional)
}

export function useGame({ gameId, gameAddress, wsServerUrl }: UseGameOptions = {}) {
  const [logs, setLogs] = useState<{ type: string; message: string; timestamp: number }[]>([]);

  // Get game address from factory if gameId provided
  const { data: gameAddressFromFactory } = useReadContract({
    address: CONTRACT_ADDRESSES.factory,
    abi: AmongUsGameFactoryABI,
    functionName: "games",
    args: gameId !== undefined ? [gameId] : undefined,
    query: {
      enabled: gameId !== undefined && !gameAddress,
    },
  });

  const effectiveGameAddress = gameAddress || (gameAddressFromFactory as Address);

  // WebSocket connection for real-time updates
  const {
    isConnected: wsConnected,
    gameState: wsGameState,
    events: wsEvents,
  } = useWebSocket({
    serverUrl: wsServerUrl || "",
    gameId: gameId?.toString(),
    enabled: !!wsServerUrl && !!gameId,
    onEvent: (event) => {
      // Add WebSocket events to logs
      if (event.type === "player_moved") {
        setLogs((prev) => [
          ...prev.slice(-49),
          {
            type: "move",
            message: `Player ${event.data.address.slice(0, 8)}... moved to ${event.data.to}`,
            timestamp: event.timestamp,
          },
        ]);
      } else if (event.type === "kill") {
        setLogs((prev) => [
          ...prev.slice(-49),
          {
            type: "kill",
            message: `Player ${event.data.victim.slice(0, 8)}... was killed!`,
            timestamp: event.timestamp,
          },
        ]);
      } else if (event.type === "vote_cast") {
        setLogs((prev) => [
          ...prev.slice(-49),
          {
            type: "vote",
            message: `Player ${event.data.voter.slice(0, 8)}... voted`,
            timestamp: event.timestamp,
          },
        ]);
      }
    },
  });

  // Reduce polling interval when WebSocket is connected (5s -> 15s fallback)
  const pollingInterval = wsConnected ? 15000 : 5000;

  // Read game state
  const { data: rawGameState, refetch: refetchGameState } = useReadContract({
    address: effectiveGameAddress,
    abi: AmongUsGameABI,
    functionName: "getGameState",
    query: {
      enabled: !!effectiveGameAddress,
      refetchInterval: pollingInterval,
    },
  });

  // Read players
  const { data: rawPlayers, refetch: refetchPlayers } = useReadContract({
    address: effectiveGameAddress,
    abi: AmongUsGameABI,
    functionName: "getPlayers",
    query: {
      enabled: !!effectiveGameAddress,
      refetchInterval: pollingInterval,
    },
  });

  // Read dead bodies
  const { data: rawDeadBodies, refetch: refetchDeadBodies } = useReadContract({
    address: effectiveGameAddress,
    abi: AmongUsGameABI,
    functionName: "getDeadBodies",
    query: {
      enabled: !!effectiveGameAddress,
      refetchInterval: pollingInterval,
    },
  });

  // Read config
  const { data: rawConfig } = useReadContract({
    address: effectiveGameAddress,
    abi: AmongUsGameABI,
    functionName: "config",
    query: {
      enabled: !!effectiveGameAddress,
    },
  });

  // Parse game state
  const gameState: GameState | undefined = rawGameState
    ? {
        gameId: (rawGameState as any).gameId || 0n,
        phase: (rawGameState as any).phase || GamePhase.Lobby,
        round: (rawGameState as any).round || 0n,
        phaseEndTime: (rawGameState as any).phaseEndTime || 0n,
        alivePlayers: Number((rawGameState as any).alivePlayers || 0),
        aliveCrewmates: Number((rawGameState as any).aliveCrewmates || 0),
        aliveImpostors: Number((rawGameState as any).aliveImpostors || 0),
        totalTasksCompleted: Number((rawGameState as any).totalTasksCompleted || 0),
        totalTasksRequired: Number((rawGameState as any).totalTasksRequired || 0),
        activeSabotage: (rawGameState as any).activeSabotage || SabotageType.None,
        crewmatesWon: (rawGameState as any).crewmatesWon || false,
      }
    : undefined;

  // Parse players from contract
  const contractPlayers: Player[] = rawPlayers
    ? (rawPlayers as any[]).map((p: any) => ({
        address: p.addr as `0x${string}`,
        colorId: Number(p.colorId),
        role: p.role as Role,
        location: p.location as Location,
        isAlive: p.isAlive,
        tasksCompleted: Number(p.tasksCompleted),
        totalTasks: Number(p.totalTasks),
        hasVoted: p.hasVoted,
      }))
    : [];

  // Parse dead bodies from contract
  const contractDeadBodies: DeadBody[] = rawDeadBodies
    ? (rawDeadBodies as any[]).map((b: any) => ({
        victim: b.victim as `0x${string}`,
        location: b.location as Location,
        round: b.round,
        reported: b.reported,
      }))
    : [];

  // Merge WebSocket data with contract data (WS takes priority for real-time fields)
  const players: Player[] = useMemo(() => {
    if (!wsConnected || !wsGameState) return contractPlayers;

    // Use WebSocket positions but keep contract data for authoritative fields like role
    return contractPlayers.map((contractPlayer) => {
      const wsPlayer = wsGameState.players.find(
        (p) => p.address.toLowerCase() === contractPlayer.address.toLowerCase()
      );
      if (wsPlayer) {
        return {
          ...contractPlayer,
          location: wsPlayer.location, // Real-time position from WS
          isAlive: wsPlayer.isAlive,
          hasVoted: wsPlayer.hasVoted,
          tasksCompleted: wsPlayer.tasksCompleted,
        };
      }
      return contractPlayer;
    });
  }, [wsConnected, wsGameState, contractPlayers]);

  const deadBodies: DeadBody[] = useMemo(() => {
    if (!wsConnected || !wsGameState) return contractDeadBodies;
    // Merge: include bodies from both sources, deduplicate by victim
    const allBodies = new Map<string, DeadBody>();
    for (const body of contractDeadBodies) {
      allBodies.set(body.victim.toLowerCase(), body);
    }
    for (const body of wsGameState.deadBodies) {
      allBodies.set(body.victim.toLowerCase(), body);
    }
    return Array.from(allBodies.values());
  }, [wsConnected, wsGameState, contractDeadBodies]);

  // Parse config
  const config: GameConfig | undefined = rawConfig
    ? {
        minPlayers: Number((rawConfig as any).minPlayers || 4),
        maxPlayers: Number((rawConfig as any).maxPlayers || 10),
        numImpostors: Number((rawConfig as any).numImpostors || 2),
        wagerAmount: (rawConfig as any).wagerAmount || 0n,
        actionTimeout: (rawConfig as any).actionTimeout || 60n,
        tasksPerPlayer: Number((rawConfig as any).tasksPerPlayer || 5),
      }
    : undefined;

  // Contract write functions
  const { writeContractAsync } = useWriteContract();

  const joinGame = useCallback(
    async (colorId: number, wagerAmount: bigint) => {
      if (!gameId) throw new Error("No game ID");
      return writeContractAsync({
        address: CONTRACT_ADDRESSES.factory,
        abi: AmongUsGameFactoryABI,
        functionName: "joinGame",
        args: [gameId, colorId],
        value: wagerAmount,
      });
    },
    [gameId, writeContractAsync]
  );

  const leaveGame = useCallback(async () => {
    if (!gameId) throw new Error("No game ID");
    return writeContractAsync({
      address: CONTRACT_ADDRESSES.factory,
      abi: AmongUsGameFactoryABI,
      functionName: "leaveGame",
      args: [gameId],
    });
  }, [gameId, writeContractAsync]);

  const startGame = useCallback(async () => {
    if (!effectiveGameAddress) throw new Error("No game address");
    return writeContractAsync({
      address: effectiveGameAddress,
      abi: AmongUsGameABI,
      functionName: "startGame",
    });
  }, [effectiveGameAddress, writeContractAsync]);

  const commitAction = useCallback(
    async (commitHash: `0x${string}`) => {
      if (!effectiveGameAddress) throw new Error("No game address");
      return writeContractAsync({
        address: effectiveGameAddress,
        abi: AmongUsGameABI,
        functionName: "commitAction",
        args: [commitHash],
      });
    },
    [effectiveGameAddress, writeContractAsync]
  );

  const submitVote = useCallback(
    async (target: `0x${string}` | null) => {
      if (!effectiveGameAddress) throw new Error("No game address");
      const targetAddress = target || "0x0000000000000000000000000000000000000000";
      return writeContractAsync({
        address: effectiveGameAddress,
        abi: AmongUsGameABI,
        functionName: "submitVote",
        args: [targetAddress],
      });
    },
    [effectiveGameAddress, writeContractAsync]
  );

  // Refetch all data
  const refetch = useCallback(() => {
    refetchGameState();
    refetchPlayers();
    refetchDeadBodies();
  }, [refetchGameState, refetchPlayers, refetchDeadBodies]);

  return {
    gameAddress: effectiveGameAddress,
    gameState,
    players,
    deadBodies,
    config,
    logs,
    joinGame,
    leaveGame,
    startGame,
    commitAction,
    submitVote,
    refetch,
    // WebSocket status
    wsConnected,
    wsEvents,
  };
}

export function useGameList() {
  const { data: gameCount } = useReadContract({
    address: CONTRACT_ADDRESSES.factory,
    abi: AmongUsGameFactoryABI,
    functionName: "gameCount",
    query: {
      refetchInterval: 10000,
    },
  });

  const { data: activeGames } = useReadContract({
    address: CONTRACT_ADDRESSES.factory,
    abi: AmongUsGameFactoryABI,
    functionName: "getActiveGames",
    query: {
      refetchInterval: 10000,
    },
  });

  const { writeContractAsync } = useWriteContract();

  const createGame = useCallback(
    async (wagerAmount: bigint) => {
      return writeContractAsync({
        address: CONTRACT_ADDRESSES.factory,
        abi: AmongUsGameFactoryABI,
        functionName: "createGame",
        value: wagerAmount,
      });
    },
    [writeContractAsync]
  );

  return {
    gameCount: gameCount ? Number(gameCount) : 0,
    activeGames: (activeGames as bigint[]) || [],
    createGame,
  };
}
