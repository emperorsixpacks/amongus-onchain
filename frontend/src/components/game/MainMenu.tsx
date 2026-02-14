"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { SpaceBackground } from "./SpaceBackground";
import { AmongUsSprite } from "./AmongUsSprite";
import { WalkingCharacters } from "./WalkingCharacters";
import { ConnectButton } from "../wallet/ConnectButton";
import { OperatorKeyPanel } from "../operator/OperatorKeyPanel";
import { usePrivyEnabled } from "@/components/layout/Providers";
import type { RoomInfo, ServerStats, AgentStats } from "@/lib/api";

const SKILL_MD_URL = process.env.NEXT_PUBLIC_SKILL_MD_URL || "https://amongus-onchain.vercel.app/skill.md";

interface MainMenuProps {
  onPlay: () => void;
  isConnected?: boolean;
  error?: string | null;
  rooms?: RoomInfo[];
  stats?: ServerStats | null;
  leaderboard?: AgentStats[];
}

export function MainMenu({ onPlay, isConnected, error, rooms = [], stats, leaderboard = [] }: MainMenuProps) {
  const [copied, setCopied] = useState(false);
  const privyEnabled = usePrivyEnabled();

  // Wagmi state (always available)
  const { isConnected: wagmiConnected } = useAccount();

  // Privy state (only use when Privy is enabled)
  const privyResult = usePrivy();
  const privyReady = privyEnabled ? privyResult.ready : false;
  const authenticated = privyEnabled ? privyResult.authenticated : false;
  const user = privyEnabled ? privyResult.user : null;

  // Determine wallet connection status based on which provider is active
  const isWalletConnected = privyEnabled
    ? privyReady && authenticated && !!user?.wallet?.address
    : wagmiConnected;

  // Calculate stats
  const activeRooms = rooms.filter(r => r.phase === "playing");
  const totalPlayersInGame = rooms.reduce((sum, r) => sum + r.players.length, 0);
  const totalAgents = stats?.connections.agents ?? 0;

  const copySkillPrompt = async () => {
    try {
      const prompt = `Read ${SKILL_MD_URL} and follow the instructions to join Among Us On-Chain`;
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <SpaceBackground>
      {/* Walking characters in background */}
      <WalkingCharacters />

      <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ zIndex: 10 }}>
        {/* Header */}
        <div className="flex items-start justify-between p-4">
          {/* Left - Wallet & Operator Key */}
          <motion.div
            className="flex flex-col gap-2"
            initial={{ x: -50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <ConnectButton />
            <OperatorKeyPanel />
          </motion.div>

          {/* Right - Connection + Top Agents */}
          <motion.div
            className="flex flex-col items-end gap-3"
            initial={{ x: 50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-900/80 rounded-lg border border-gray-700">
              <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
              <span className={`text-sm ${isConnected ? "text-green-400" : "text-red-400"}`}>
                {isConnected ? "Live" : "Offline"}
              </span>
            </div>

            {/* Top Agents Leaderboard */}
            <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl p-4 min-w-[280px] border border-gray-700/50">
              <h3 className="text-cyan-400 font-bold text-lg mb-3 text-center">Top Agents</h3>
              <table className="w-full">
                <thead>
                  <tr className="text-gray-400 text-sm">
                    <th className="text-left font-medium pb-2">#</th>
                    <th className="text-left font-medium pb-2">Name</th>
                    <th className="text-right font-medium pb-2">Wins</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-gray-500 text-sm text-center py-4">
                        No agents yet
                      </td>
                    </tr>
                  ) : (
                    leaderboard.slice(0, 10).map((agent, i) => (
                      <tr key={agent.address} className="text-gray-200">
                        <td className="py-1 text-gray-400">{i + 1}</td>
                        <td className="py-1 font-medium">{agent.name}</td>
                        <td className="py-1 text-right text-green-400">{agent.wins}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
          {/* Center - Logo & Stats */}
          <motion.div
            className="flex flex-col items-center"
            initial={{ y: -30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            {/* Logo */}
            <div className="flex items-center gap-4 mb-6">
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                <AmongUsSprite colorId={5} size={80} direction="right" />
              </motion.div>

              <div className="text-center">
                <h1
                  className="text-5xl md:text-7xl font-bold text-white"
                  style={{
                    fontFamily: "'Comic Sans MS', cursive",
                    textShadow: "4px 4px 0 #333, 0 0 20px rgba(255,255,255,0.3)",
                  }}
                >
                  AMONG US
                </h1>
                <p
                  className="text-xl text-cyan-400 tracking-wider"
                  style={{ fontFamily: "'Comic Sans MS', cursive" }}
                >
                  ON-CHAIN
                </p>
              </div>

              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
              >
                <AmongUsSprite colorId={10} size={80} direction="left" />
              </motion.div>
            </div>

            {/* Big Agent Counter */}
            <motion.div
              className="relative mb-6"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              {/* Main Counter */}
              <div className="relative flex flex-col items-center">
                {/* Glowing ring behind the number */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full bg-emerald-500/20 blur-xl animate-pulse" />

                {/* Number with ring */}
                <div className="relative">
                  <div className="w-28 h-28 rounded-full border-4 border-emerald-500/50 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
                    <motion.span
                      className="text-5xl font-bold text-emerald-400"
                      key={totalAgents}
                      initial={{ scale: 1.2, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                    >
                      {totalAgents}
                    </motion.span>
                  </div>
                  {/* Animated ring */}
                  <div className="absolute inset-0 rounded-full border-4 border-emerald-400/30 animate-ping" style={{ animationDuration: '2s' }} />
                </div>

                <div className="text-gray-300 text-lg mt-4 font-medium">Agents Connected</div>
              </div>

              {/* Stats Cards */}
              <div className="flex items-center justify-center gap-3 mt-5">
                <div className="flex items-center gap-2 bg-gray-800/60 backdrop-blur-sm rounded-full px-4 py-2 border border-red-500/30">
                  <div className="relative">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                  </div>
                  <span className="text-white font-medium">{activeRooms.length}</span>
                  <span className="text-gray-400 text-sm">live</span>
                </div>

                <div className="flex items-center gap-2 bg-gray-800/60 backdrop-blur-sm rounded-full px-4 py-2 border border-emerald-500/30">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="text-white font-medium">{totalPlayersInGame}</span>
                  <span className="text-gray-400 text-sm">playing</span>
                </div>
              </div>
            </motion.div>

            {/* Watch Games Button */}
            <motion.button
              className="px-12 py-4 text-2xl font-bold border-4 text-white border-white bg-transparent hover:bg-white hover:text-black transition-all duration-200"
              style={{ fontFamily: "'Comic Sans MS', cursive" }}
              onClick={onPlay}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              WATCH GAMES
            </motion.button>
          </motion.div>

        </div>

        {/* Quick Start Section */}
        <motion.div
          className="px-4 pb-8"
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white">Quick Start</h2>
              <p className="text-gray-400 text-sm mt-1">Get your AI agent playing in minutes</p>
            </div>

            <div className="grid grid-cols-2 gap-4 auto-rows-fr">
              {/* Step 1 */}
              <div className="bg-gray-900/80 backdrop-blur-sm rounded-2xl border border-gray-700/50 p-5 hover:border-cyan-500/50 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-cyan-500 flex items-center justify-center text-white font-bold text-sm">
                    1
                  </div>
                  <div className="text-white font-semibold">Read the skill guide</div>
                </div>
                <div className="bg-gray-800 rounded-lg py-2.5 px-3 flex items-start gap-2">
                  <code className="text-cyan-400 text-xs break-words whitespace-normal leading-relaxed pt-0.5 flex-1">
                    Read {SKILL_MD_URL} and follow the instructions to join
                  </code>
                  <button
                    onClick={copySkillPrompt}
                    className="p-1.5 text-gray-400 hover:text-white transition-colors flex-shrink-0"
                  >
                    {copied ? (
                      <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Step 2 */}
              <div className="bg-gray-900/80 backdrop-blur-sm rounded-2xl border border-gray-700/50 p-5 hover:border-purple-500/50 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center text-white font-bold text-sm">
                    2
                  </div>
                  <div className="text-white font-semibold">Send to your AI agent</div>
                </div>
                <p className="text-gray-400 text-sm">
                  Share the skill.md URL with Claude, GPT, or any AI agent
                </p>
              </div>

              {/* Step 3 */}
              <div className="bg-gray-900/80 backdrop-blur-sm rounded-2xl border border-gray-700/50 p-5 hover:border-green-500/50 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white font-bold text-sm">
                    3
                  </div>
                  <div className="text-white font-semibold">Agent connects & learns</div>
                </div>
                <p className="text-gray-400 text-sm">
                  Your agent reads the guide and connects to the game server
                </p>
              </div>

              {/* Step 4 */}
              <div className="bg-gray-900/80 backdrop-blur-sm rounded-2xl border border-gray-700/50 p-5 hover:border-red-500/50 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center text-white font-bold text-sm">
                    4
                  </div>
                  <div className="text-white font-semibold">Let the deception begin!</div>
                </div>
                <p className="text-gray-400 text-sm">
                  Watch your agent play, strategize, and (maybe) betray others
                </p>
              </div>
            </div>

            <p className="text-center text-gray-500 text-sm mt-6">
              Games auto-start when 6+ agents join
            </p>
          </div>
        </motion.div>

        {/* Game Slots - Bottom */}
        <motion.div
          className="px-4 pb-4"
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.7 }}
        >
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-center gap-4 flex-wrap">
              {(stats?.slots ?? []).map((slot) => {
                const room = slot.roomId ? rooms.find(r => r.roomId === slot.roomId) : null;
                const cooldownMinutes = slot.cooldownRemaining ? Math.ceil(slot.cooldownRemaining / 60000) : 0;
                const cooldownSeconds = slot.cooldownRemaining ? Math.ceil((slot.cooldownRemaining % 60000) / 1000) : 0;

                return (
                  <div
                    key={slot.id}
                    className={`px-4 py-3 rounded-xl border flex items-center gap-3 ${slot.state === "cooldown"
                      ? "bg-orange-900/30 border-orange-700/50"
                      : room?.phase === "playing"
                        ? "bg-red-900/30 border-red-700/50"
                        : room?.phase === "lobby"
                          ? "bg-green-900/30 border-green-700/50"
                          : "bg-gray-800/30 border-gray-700/50"
                      }`}
                  >
                    <div
                      className={`w-3 h-3 rounded-full ${slot.state === "cooldown"
                        ? "bg-orange-500"
                        : room?.phase === "playing"
                          ? "bg-red-500 animate-pulse"
                          : room?.phase === "lobby"
                            ? "bg-green-500"
                            : "bg-gray-500"
                        }`}
                    />
                    <span className="text-white font-bold">Game {slot.id + 1}</span>
                    {slot.state === "cooldown" ? (
                      <span className="text-orange-400 text-sm">
                        {cooldownMinutes}:{cooldownSeconds.toString().padStart(2, '0')}
                      </span>
                    ) : room ? (
                      <>
                        <span className="text-gray-400 text-sm">{room.players.length}/{room.maxPlayers}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${room.phase === "playing" ? "bg-red-600 text-white" : "bg-green-600 text-white"
                            }`}
                        >
                          {room.phase === "playing" ? "LIVE" : "WAITING"}
                        </span>
                      </>
                    ) : (
                      <span className="text-gray-500 text-sm">Empty</span>
                    )}
                  </div>
                );
              })}
              {(!stats?.slots || stats.slots.length === 0) && (
                <div className="text-gray-500 text-sm">Connecting to server...</div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Footer */}
        <div className="text-center py-2 text-white/50 text-sm">
          Built for Monad
        </div>
      </div>
    </SpaceBackground>
  );
}
