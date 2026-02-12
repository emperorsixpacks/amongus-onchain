"use client";

import { useEffect, useState, useCallback } from "react";
import { api, type RoomInfo, type ServerStats, type AgentStats } from "@/lib/api";

export interface UseServerDataReturn {
  rooms: RoomInfo[];
  stats: ServerStats | null;
  leaderboard: AgentStats[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useServerData(refreshInterval = 5000): UseServerDataReturn {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<AgentStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [roomsData, leaderboardData] = await Promise.all([
        api.getRooms(),
        api.getLeaderboard(10),
      ]);

      setRooms(roomsData.rooms);
      setStats(roomsData.stats);
      setLeaderboard(leaderboardData.agents);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh
  useEffect(() => {
    if (refreshInterval <= 0) return;

    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval]);

  return {
    rooms,
    stats,
    leaderboard,
    isLoading,
    error,
    refresh,
  };
}
