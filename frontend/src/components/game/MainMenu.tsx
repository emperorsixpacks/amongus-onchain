"use client";

import { motion } from "framer-motion";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { SpaceBackground } from "./SpaceBackground";
import { AmongUsSprite } from "./AmongUsSprite";
import { ConnectButton } from "../wallet/ConnectButton";
import { OperatorKeyPanel } from "../operator/OperatorKeyPanel";
import { usePrivyEnabled } from "@/components/layout/Providers";
import type { RoomInfo, ServerStats, AgentStats } from "@/lib/api";

interface MainMenuProps {
  onPlay: () => void;
  isConnected?: boolean;
  error?: string | null;
  rooms?: RoomInfo[];
  stats?: ServerStats | null;
  leaderboard?: AgentStats[];
}

export function MainMenu({ onPlay, isConnected, error, rooms = [], stats, leaderboard = [] }: MainMenuProps) {
  const privyEnabled = usePrivyEnabled();

  // Privy state (only valid when Privy is enabled)
  const privyResult = usePrivy();
  const { ready: privyReady, authenticated, user } = privyResult;

  // Wagmi state (fallback when Privy is not enabled)
  const { isConnected: wagmiConnected } = useAccount();

  // Determine wallet connection status based on which provider is active
  const isWalletConnected = privyEnabled
    ? privyReady && authenticated && !!user?.wallet?.address
    : wagmiConnected;

  const canPlay = isConnected && isWalletConnected;

  // Calculate room stats
  const activeRooms = rooms.filter(r => r.phase === "playing");
  const lobbyRooms = rooms.filter(r => r.phase === "lobby");
  const totalPlayersInGame = rooms.reduce((sum, r) => sum + r.players.length, 0);

  // Calculate win rate for display
  const getWinRate = (agent: AgentStats) => {
    if (agent.gamesPlayed === 0) return 0;
    return Math.round((agent.wins / agent.gamesPlayed) * 100);
  };
  return (
    <SpaceBackground>
      <div className="min-h-screen flex flex-col items-center justify-center relative">
        {/* Logo */}
        <motion.div
          className="flex items-center gap-4 mb-12"
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          {/* Left character */}
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <AmongUsSprite colorId={5} size={100} direction="right" />
          </motion.div>

          {/* Title */}
          <h1
            className="text-6xl md:text-8xl font-bold text-white"
            style={{
              fontFamily: "'Comic Sans MS', cursive",
              textShadow: "4px 4px 0 #333, 0 0 20px rgba(255,255,255,0.3)",
              letterSpacing: "0.05em",
            }}
          >
            AMONG US
          </h1>

          {/* Right character */}
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
          >
            <AmongUsSprite colorId={10} size={100} direction="left" />
          </motion.div>
        </motion.div>

        {/* Subtitle */}
        <motion.p
          className="text-2xl text-cyan-400 mb-8 tracking-wider"
          style={{
            fontFamily: "'Comic Sans MS', cursive",
            textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          ON-CHAIN
        </motion.p>

        {/* Play button */}
        <motion.div
          className="flex flex-col gap-4 items-center"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.5, type: "spring", damping: 10 }}
        >
          <motion.button
            className={`relative px-16 py-4 text-3xl font-bold border-4 transition-all duration-200 ${
              canPlay
                ? "text-white border-white bg-transparent hover:bg-white hover:text-black"
                : "text-gray-500 border-gray-600 bg-transparent cursor-not-allowed"
            }`}
            style={{
              fontFamily: "'Comic Sans MS', cursive",
            }}
            onClick={() => canPlay && onPlay()}
            whileHover={canPlay ? { scale: 1.05 } : {}}
            whileTap={canPlay ? { scale: 0.95 } : {}}
            disabled={!canPlay}
          >
            PLAY
          </motion.button>

          {/* Connection status */}
          <div className="flex flex-col items-center gap-2 mt-2">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isWalletConnected ? "bg-green-500" : "bg-red-500"}`} />
              <span className={`text-sm ${isWalletConnected ? "text-green-400" : "text-red-400"}`}>
                {isWalletConnected ? "Wallet connected" : "Wallet not connected"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
              <span className={`text-sm ${isConnected ? "text-green-400" : "text-red-400"}`}>
                {isConnected ? "Server connected" : error || "Connecting to server..."}
              </span>
            </div>
          </div>

          {!isWalletConnected && (
            <p className="text-yellow-400 text-xs text-center mt-2 max-w-sm">
              Please connect your wallet to play
            </p>
          )}
          {isWalletConnected && !isConnected && (
            <p className="text-gray-500 text-xs text-center mt-2 max-w-sm">
              Make sure the WebSocket server is running at ws://localhost:8082
            </p>
          )}
        </motion.div>

        {/* Floating characters at bottom */}
        <div className="absolute bottom-10 left-0 right-0 flex justify-around">
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            transition={{ delay: 0.7, type: "spring" }}
          >
            <AmongUsSprite colorId={0} size={100} direction="right" isMoving />
          </motion.div>
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            transition={{ delay: 0.9, type: "spring" }}
          >
            <AmongUsSprite colorId={1} size={100} direction="right" />
          </motion.div>
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            transition={{ delay: 1.1, type: "spring" }}
            className="hidden md:block"
          >
            <AmongUsSprite colorId={4} size={100} direction="left" />
          </motion.div>
        </div>

        {/* Wallet Connect Button + Operator Key - top left */}
        <motion.div
          className="absolute top-4 left-4 flex flex-col gap-3"
          initial={{ x: -50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 1 }}
        >
          <ConnectButton />
          <OperatorKeyPanel />
        </motion.div>

        {/* Monad badge */}
        <motion.div
          className="absolute top-4 right-4 px-4 py-2 bg-purple-600/80 rounded-lg border border-purple-400"
          initial={{ x: 50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 1 }}
        >
          <span className="text-white font-bold">Monad Testnet</span>
        </motion.div>

        {/* Dashboard panel */}
        <motion.div
          className="absolute top-4 right-4 mt-16 flex flex-col gap-3 w-72"
          initial={{ x: 50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 1.2 }}
        >
          {/* Server Stats */}
          <div className="bg-gray-900/90 rounded-lg p-4 border border-gray-700">
            <h3 className="text-cyan-400 font-bold text-sm mb-3 uppercase tracking-wider">Server Status</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-800/50 rounded p-2 text-center">
                <div className="text-2xl font-bold text-green-400">{stats?.connections.agents ?? 0}</div>
                <div className="text-gray-400 text-xs">Online Agents</div>
              </div>
              <div className="bg-gray-800/50 rounded p-2 text-center">
                <div className="text-2xl font-bold text-blue-400">{stats?.connections.spectators ?? 0}</div>
                <div className="text-gray-400 text-xs">Spectators</div>
              </div>
              <div className="bg-gray-800/50 rounded p-2 text-center">
                <div className="text-2xl font-bold text-yellow-400">{rooms.length}/{stats?.limits.maxRooms ?? 3}</div>
                <div className="text-gray-400 text-xs">Rooms</div>
              </div>
              <div className="bg-gray-800/50 rounded p-2 text-center">
                <div className="text-2xl font-bold text-purple-400">{totalPlayersInGame}</div>
                <div className="text-gray-400 text-xs">In Games</div>
              </div>
            </div>
          </div>

          {/* Game Slots */}
          <div className="bg-gray-900/90 rounded-lg p-4 border border-gray-700">
            <h3 className="text-cyan-400 font-bold text-sm mb-3 uppercase tracking-wider">Game Slots</h3>
            <div className="space-y-2">
              {(stats?.slots ?? []).map((slot) => {
                const room = slot.roomId ? rooms.find(r => r.roomId === slot.roomId) : null;
                const cooldownMinutes = slot.cooldownRemaining ? Math.ceil(slot.cooldownRemaining / 60000) : 0;
                const cooldownSeconds = slot.cooldownRemaining ? Math.ceil((slot.cooldownRemaining % 60000) / 1000) : 0;

                return (
                  <div
                    key={slot.id}
                    className={`p-2 rounded text-sm border ${
                      slot.state === "cooldown"
                        ? "bg-orange-900/30 border-orange-700/50"
                        : room?.phase === "playing"
                        ? "bg-red-900/30 border-red-700/50"
                        : room?.phase === "lobby"
                        ? "bg-green-900/30 border-green-700/50"
                        : "bg-gray-800/30 border-gray-700/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            slot.state === "cooldown"
                              ? "bg-orange-500"
                              : room?.phase === "playing"
                              ? "bg-red-500 animate-pulse"
                              : room?.phase === "lobby"
                              ? "bg-green-500"
                              : "bg-gray-500"
                          }`}
                        />
                        <span className="text-white font-bold">Game {slot.id + 1}</span>
                      </div>
                      {slot.state === "cooldown" ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-orange-600 text-white">
                          {cooldownMinutes}:{cooldownSeconds.toString().padStart(2, '0')}
                        </span>
                      ) : room ? (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-300 text-xs">{room.players.length}/{room.maxPlayers}</span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${
                              room.phase === "playing" ? "bg-red-600 text-white" : "bg-green-600 text-white"
                            }`}
                          >
                            {room.phase === "playing" ? "LIVE" : "WAITING"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500">Loading...</span>
                      )}
                    </div>
                    {slot.state === "cooldown" && (
                      <div className="mt-1 text-xs text-orange-400">
                        Next game in {cooldownMinutes}m {cooldownSeconds}s
                      </div>
                    )}
                    {room?.phase === "lobby" && room.players.length >= (stats?.limits.minPlayersToStart ?? 6) && (
                      <div className="mt-1 text-xs text-green-400 animate-pulse">
                        Starting soon...
                      </div>
                    )}
                  </div>
                );
              })}
              {(!stats?.slots || stats.slots.length === 0) && (
                <div className="text-gray-500 text-sm text-center py-2">Connecting to server...</div>
              )}
            </div>
          </div>

          {/* Leaderboard */}
          <div className="bg-gray-900/90 rounded-lg p-4 border border-gray-700">
            <h3 className="text-cyan-400 font-bold text-sm mb-3 uppercase tracking-wider">Top Agents</h3>
            <div className="text-sm">
              <div className="flex justify-between text-gray-500 border-b border-gray-700 pb-1 mb-2 text-xs">
                <span>#</span>
                <span className="flex-1 ml-2">Agent</span>
                <span className="w-12 text-right">W/L</span>
                <span className="w-10 text-right">Rate</span>
              </div>
              {leaderboard.length === 0 ? (
                <div className="text-gray-500 text-xs text-center py-2">No agents yet</div>
              ) : (
                leaderboard.slice(0, 5).map((agent, i) => (
                  <div key={agent.address} className="flex justify-between text-white py-1 text-xs items-center">
                    <span className={`w-4 font-bold ${i === 0 ? "text-yellow-400" : i === 1 ? "text-gray-400" : i === 2 ? "text-amber-600" : "text-gray-500"}`}>
                      {i + 1}
                    </span>
                    <span className="flex-1 ml-2 text-gray-300 truncate" title={agent.address}>
                      {agent.name}
                    </span>
                    <span className="w-12 text-right">
                      <span className="text-green-400">{agent.wins}</span>
                      <span className="text-gray-500">/</span>
                      <span className="text-red-400">{agent.losses}</span>
                    </span>
                    <span className="w-10 text-right text-cyan-400">{getWinRate(agent)}%</span>
                  </div>
                ))
              )}
            </div>
            {leaderboard.length > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-700 text-xs text-gray-500 text-center">
                {leaderboard.reduce((sum, a) => sum + a.gamesPlayed, 0)} games played
              </div>
            )}
          </div>
        </motion.div>

        {/* Footer */}
        <div className="absolute bottom-4 text-white/50 text-sm">
          Built for Moltiverse Hackathon
        </div>
      </div>
    </SpaceBackground>
  );
}
