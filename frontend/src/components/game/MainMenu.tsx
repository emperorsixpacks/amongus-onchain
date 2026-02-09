"use client";

import { motion } from "framer-motion";
import { SpaceBackground } from "./SpaceBackground";
import { AmongUsSprite } from "./AmongUsSprite";

interface MainMenuProps {
  onPlay: () => void;
  isConnected?: boolean;
  error?: string | null;
}

export function MainMenu({ onPlay, isConnected, error }: MainMenuProps) {
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
              isConnected
                ? "text-white border-white bg-transparent hover:bg-white hover:text-black"
                : "text-gray-500 border-gray-600 bg-transparent cursor-not-allowed"
            }`}
            style={{
              fontFamily: "'Comic Sans MS', cursive",
            }}
            onClick={() => isConnected && onPlay()}
            whileHover={isConnected ? { scale: 1.05 } : {}}
            whileTap={isConnected ? { scale: 0.95 } : {}}
            disabled={!isConnected}
          >
            PLAY
          </motion.button>

          {/* Connection status */}
          <div className="flex items-center gap-2 mt-2">
            <div className={`w-3 h-3 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
            <span className={`text-sm ${isConnected ? "text-green-400" : "text-red-400"}`}>
              {isConnected ? "Connected to server" : error || "Connecting to server..."}
            </span>
          </div>

          {!isConnected && (
            <p className="text-gray-500 text-xs text-center mt-2 max-w-sm">
              Make sure the WebSocket server is running at ws://localhost:8080
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

        {/* Monad badge */}
        <motion.div
          className="absolute top-4 right-4 px-4 py-2 bg-purple-600/80 rounded-lg border border-purple-400"
          initial={{ x: 50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 1 }}
        >
          <span className="text-white font-bold">Monad Testnet</span>
        </motion.div>

        {/* Leaderboard panel */}
        <motion.div
          className="absolute top-4 right-4 mt-16 bg-white/90 rounded-lg p-4 w-64"
          initial={{ x: 50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 1.2 }}
        >
          <h3 className="text-black font-bold text-lg mb-2">Top Impostors Today</h3>
          <div className="text-sm">
            <div className="flex justify-between text-gray-600 border-b pb-1 mb-1">
              <span>#</span>
              <span className="flex-1 ml-2">Name</span>
              <span>Kills</span>
            </div>
            {[
              { name: "Agent Alpha", kills: 42 },
              { name: "Shadow", kills: 38 },
              { name: "Deceiver", kills: 35 },
              { name: "Stealth", kills: 31 },
              { name: "Hunter", kills: 28 },
            ].map((agent, i) => (
              <div key={i} className="flex justify-between text-black py-0.5">
                <span className="w-4">{i + 1}</span>
                <span className="flex-1 ml-2">{agent.name}</span>
                <span>{agent.kills}</span>
              </div>
            ))}
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
