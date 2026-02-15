"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { PlayerSprite } from "./PlayerSprite";
import { Player, PlayerColors, GameConfig } from "@/types/game";
import { Users, Coins, Clock, Play, Plus, LogIn } from "lucide-react";
import { formatEther } from "viem";

interface GameLobbyProps {
  gameId?: bigint;
  players: Player[];
  config: GameConfig;
  currentPlayer?: `0x${string}`;
  isHost?: boolean;
  onStart?: () => void;
  onJoin?: (colorId: number) => void;
  onLeave?: () => void;
  onCreateGame?: () => void;
}

export function GameLobby({
  gameId,
  players,
  config,
  currentPlayer,
  isHost = false,
  onStart,
  onJoin,
  onLeave,
  onCreateGame,
}: GameLobbyProps) {
  const [selectedColor, setSelectedColor] = useState<number | null>(null);
  const usedColors = new Set(players.map((p) => p.colorId));
  const isJoined = players.some((p) => p.address === currentPlayer);
  const canStart = players.length >= config.minPlayers;

  const availableColors = Object.entries(PlayerColors).filter(
    ([id]) => !usedColors.has(parseInt(id))
  );

  return (
    <motion.div
      className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden max-w-2xl mx-auto"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-900 to-blue-900 p-6 text-center">
        <h1 className="text-3xl font-bold text-white mb-2">
          {gameId !== undefined ? `Game #${gameId.toString()}` : "Among Us On-Chain"}
        </h1>
        <p className="text-purple-200">
          {isJoined ? "Waiting for players..." : "Join the game to play!"}
        </p>
      </div>

      {/* Game config */}
      <div className="p-4 border-b border-slate-700">
        <div className="grid grid-cols-3 gap-4 mb-3">
          <div className="flex items-center gap-2 justify-center">
            <Users className="w-5 h-5 text-blue-400" />
            <span className="text-slate-300">
              {config.minPlayers}-{config.maxPlayers} players
            </span>
          </div>
          <div className="flex items-center gap-2 justify-center">
            <Coins className="w-5 h-5 text-yellow-400" />
            <span className="text-slate-300">
              {formatEther(config.wagerAmount)} wager
            </span>
          </div>
          <div className="flex items-center gap-2 justify-center">
            <Clock className="w-5 h-5 text-green-400" />
            <span className="text-slate-300">{config.tasksPerPlayer} tasks</span>
          </div>
        </div>

        {/* Total Pot Display */}
        {players.length > 0 && (
          <div className="bg-gradient-to-r from-yellow-900/30 to-amber-900/30 border border-yellow-500/30 rounded-lg p-3 text-center">
            <div className="text-xs text-yellow-400/70 uppercase mb-1">Total Prize Pool</div>
            <div className="text-2xl font-black text-yellow-400">
              {formatEther(config.wagerAmount * BigInt(players.length))} MON
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {players.length} player{players.length !== 1 ? 's' : ''} × {formatEther(config.wagerAmount)} MON
            </div>
          </div>
        )}
      </div>

      {/* Players */}
      <div className="p-4">
        <h3 className="text-slate-400 text-sm font-bold mb-3 uppercase tracking-wider">
          Players ({players.length}/{config.maxPlayers})
        </h3>

        <div className="grid grid-cols-4 md:grid-cols-6 gap-4 mb-6">
          {/* Existing players */}
          {players.map((player, index) => (
            <motion.div
              key={player.address}
              className="flex flex-col items-center"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <PlayerSprite
                colorId={player.colorId}
                isAlive={true}
                size="md"
              />
              <span
                className="text-xs font-bold mt-1"
                style={{ color: PlayerColors[player.colorId].light }}
              >
                {PlayerColors[player.colorId].name}
              </span>
              {player.address === currentPlayer && (
                <span className="text-[10px] text-blue-400">(you)</span>
              )}
            </motion.div>
          ))}

          {/* Empty slots */}
          {[...Array(config.maxPlayers - players.length)].map((_, i) => (
            <div
              key={`empty-${i}`}
              className="flex flex-col items-center opacity-30"
            >
              <div className="w-10 h-12 rounded-full bg-slate-700 flex items-center justify-center">
                <span className="text-slate-500 text-2xl">?</span>
              </div>
              <span className="text-xs text-slate-600 mt-1">Empty</span>
            </div>
          ))}
        </div>

        {/* Color selection (if not joined) */}
        {!isJoined && gameId !== undefined && (
          <div className="mb-4">
            <h4 className="text-slate-400 text-sm font-bold mb-2">
              Select your color:
            </h4>
            <div className="flex flex-wrap gap-2">
              {availableColors.map(([id, color]) => (
                <motion.button
                  key={id}
                  className={`
                    w-10 h-10 rounded-full border-2 transition-all
                    ${selectedColor === parseInt(id) ? "border-white scale-110" : "border-transparent"}
                  `}
                  style={{ backgroundColor: color.hex }}
                  onClick={() => setSelectedColor(parseInt(id))}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  title={color.name}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-slate-700 flex gap-3">
        {gameId === undefined ? (
          <motion.button
            className="flex-1 py-3 rounded-lg bg-green-600 hover:bg-green-500 text-white font-bold flex items-center justify-center gap-2"
            onClick={onCreateGame}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Plus className="w-5 h-5" />
            Create Game
          </motion.button>
        ) : !isJoined ? (
          <motion.button
            className={`
              flex-1 py-3 rounded-lg font-bold flex items-center justify-center gap-2
              ${selectedColor !== null ? "bg-blue-600 hover:bg-blue-500 text-white" : "bg-slate-700 text-slate-400 cursor-not-allowed"}
            `}
            onClick={() => selectedColor !== null && onJoin?.(selectedColor)}
            disabled={selectedColor === null}
            whileHover={selectedColor !== null ? { scale: 1.02 } : {}}
            whileTap={selectedColor !== null ? { scale: 0.98 } : {}}
          >
            <LogIn className="w-5 h-5" />
            Join Game
          </motion.button>
        ) : (
          <>
            {isHost && (
              <motion.button
                className={`
                  flex-1 py-3 rounded-lg font-bold flex items-center justify-center gap-2
                  ${canStart ? "bg-green-600 hover:bg-green-500 text-white" : "bg-slate-700 text-slate-400 cursor-not-allowed"}
                `}
                onClick={onStart}
                disabled={!canStart}
                whileHover={canStart ? { scale: 1.02 } : {}}
                whileTap={canStart ? { scale: 0.98 } : {}}
              >
                <Play className="w-5 h-5" />
                Start Game
                {!canStart && ` (need ${config.minPlayers}+)`}
              </motion.button>
            )}
            <motion.button
              className="py-3 px-6 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 font-bold"
              onClick={onLeave}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Leave
            </motion.button>
          </>
        )}
      </div>
    </motion.div>
  );
}
