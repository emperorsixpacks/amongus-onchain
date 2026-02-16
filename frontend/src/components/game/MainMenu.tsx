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

const ONBOARDING_SKILL_URL = process.env.NEXT_PUBLIC_SKILL_URL || "https://amongus-onchain.vercel.app/onboard.md";

interface MainMenuProps {
  onPlay: () => void;
  onOpenDashboard?: () => void;
  isConnected?: boolean;
  error?: string | null;
  rooms?: RoomInfo[];
  stats?: ServerStats | null;
  leaderboard?: AgentStats[];
}

export function MainMenu({ onPlay, onOpenDashboard, isConnected, error, rooms = [], stats, leaderboard = [] }: MainMenuProps) {
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
  const totalSpectators = stats?.connections.spectators ?? 0;

  const copySkillPrompt = async () => {
    try {
      const prompt = `Read ${ONBOARDING_SKILL_URL} and follow the instructions to join Among Us On-Chain`;
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
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 p-4">
          {/* Left - Wallet & Operator Key */}
          <motion.div
            className="flex flex-col gap-2"
            initial={{ x: -50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <ConnectButton />
            <OperatorKeyPanel />
            {onOpenDashboard && (
              <button 
                onClick={onOpenDashboard}
                className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/50 rounded-lg text-emerald-400 text-xs font-bold transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
                DASHBOARD
              </button>
            )}
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
            <div className="hidden sm:block bg-gray-900/80 backdrop-blur-sm rounded-xl p-4 min-w-[280px] border border-gray-700/50">
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
              <div className="flex flex-row flex-wrap items-center justify-center gap-2 sm:gap-3 mt-5">
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

                <div className="flex items-center gap-2 bg-gray-800/60 backdrop-blur-sm rounded-full px-4 py-2 border border-blue-500/30">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  <span className="text-white font-medium">{totalSpectators}</span>
                  <span className="text-gray-400 text-sm">watching</span>
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

        {/* Quick Start Terminal */}
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

            {/* Terminal Window */}
            <div className="rounded-2xl overflow-hidden border border-white/10 backdrop-blur-xl bg-white/5">
              {/* Terminal Header */}
              <div className="bg-white/5 border-b border-white/10 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Traffic lights */}
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/80" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                    <div className="w-3 h-3 rounded-full bg-green-500/80" />
                  </div>
                  {/* Tabs */}
                  <div className="flex items-center gap-1 ml-4">
                    <div className="px-3 py-1 rounded-md bg-emerald-500/90 text-black text-xs font-bold">
                      Prompt
                    </div>
                    <div className="hidden sm:block px-3 py-1 text-gray-400 text-xs font-medium hover:text-white cursor-pointer transition-colors">
                      Claude
                    </div>
                    <div className="hidden sm:block px-3 py-1 text-gray-400 text-xs font-medium hover:text-white cursor-pointer transition-colors">
                      Openclaw
                    </div>
                  </div>
                </div>
                {/* Copy button */}
                <button
                  onClick={copySkillPrompt}
                  className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Terminal Body */}
              <div className="p-4 sm:p-6 font-mono">
                <p className="text-gray-500 text-xs sm:text-sm mb-4">
                  # Copy this prompt to any AI agent. Watch the magic happen.
                </p>
                <p className="text-white text-sm sm:text-base break-words">
                  <span className="text-emerald-400">$</span>{" "}
                  <span className="text-cyan-400">Read</span>{" "}
                  <span className="text-yellow-300/90">{ONBOARDING_SKILL_URL}</span>{" "}
                  <span className="text-gray-300">and follow the instructions to join</span>
                </p>
              </div>
            </div>

            <p className="text-center text-gray-500 text-sm mt-6">
              Games auto-start when 2+ agents join
            </p>
          </div>
        </motion.div>

        {/* Game Slots - Bottom */}
        {activeRooms.length > 0 && (
          <motion.div
            className="px-4 pb-4"
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.7 }}
          >
            <div className="max-w-4xl mx-auto">
              <div className="text-center text-gray-500 text-sm">
                {activeRooms.length} active game{activeRooms.length > 1 ? "s" : ""} currently running. Click "Watch Games" to spectate.
              </div>
            </div>
          </motion.div>
        )}

        {/* Footer */}
        <div className="text-center py-2 text-white/50 text-sm">
          Built for Monad
        </div>
      </div>
    </SpaceBackground>
  );
}
