"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import {
  MainMenu,
  SpaceBackground,
  ScrollableMap,
  TaskBar,
  VotingScreen,
  DeadBodyReportedScreen,
  AmongUsGameEndScreen,
  EjectionScreen,
  AmongUsSprite,
  GameLogPanel,
} from "@/components/game";
import {
  Player,
  GamePhase,
  GameLog,
  DeadBody,
  Location,
  LocationNames,
  Role,
  PlayerColors,
} from "@/types/game";
import { useGameServer, type RoomState } from "@/hooks/useGameServer";
import { useServerData } from "@/hooks/useServerData";
import type { RoomInfo, ServerStats } from "@/lib/api";

type GameView = "menu" | "lobby" | "game" | "voting" | "end";

export default function Home() {
  const [view, setView] = useState<GameView>("menu");
  const [showBodyReported, setShowBodyReported] = useState(false);
  const [showEjection, setShowEjection] = useState(false);
  const [showGameEnd, setShowGameEnd] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [ejectedPlayer, setEjectedPlayer] = useState<Player | null>(null);
  const [gameWon, setGameWon] = useState(true);
  const [spotlightedPlayer, setSpotlightedPlayer] = useState<`0x${string}` | null>(null);

  // HTTP API for menu/lobby data (rooms, stats, leaderboard)
  const {
    rooms: httpRooms,
    stats: httpStats,
    leaderboard: httpLeaderboard,
    error: httpError,
  } = useServerData(5000); // Refresh every 5 seconds

  // WebSocket for real-time gameplay
  const {
    isConnected,
    error: wsError,
    currentRoom,
    players,
    deadBodies,
    logs,
    phase,
    tasksCompleted,
    totalTasks,
    joinRoom,
    leaveRoom,
  } = useGameServer();

  // Use HTTP data for menu, WebSocket for gameplay
  const rooms = httpRooms;
  const stats = httpStats;
  const leaderboard = httpLeaderboard;
  const error = wsError || httpError;

  // Current player (first player for spectator view)
  const currentPlayer = players[0]?.address;
  const currentPlayerData = players.find((p) => p.address === currentPlayer);

  // Handle play button - go to lobby
  const handlePlay = () => {
    setView("lobby");
  };

  // Handle joining a room (as spectator)
  const handleJoinRoom = (roomId: string) => {
    joinRoom(roomId, true); // Join as spectator
  };

  // Watch for phase changes from WebSocket
  useEffect(() => {
    if (phase === GamePhase.ActionCommit && view === "lobby") {
      setView("game");
    } else if (phase === GamePhase.Ended && view === "game") {
      setShowGameEnd(true);
    }
  }, [phase, view]);

  // Timer countdown for voting
  useEffect(() => {
    if (view === "voting" && timeRemaining > 0) {
      const timer = setInterval(() => {
        setTimeRemaining((t) => Math.max(0, t - 1));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [view, timeRemaining]);

  const handleBodyReportedDismiss = () => {
    setShowBodyReported(false);
    setTimeRemaining(30);
    setHasVoted(false);
    setView("voting");
  };

  // Auto-dismiss body reported screen after 3 seconds
  useEffect(() => {
    if (showBodyReported) {
      const timer = setTimeout(() => {
        handleBodyReportedDismiss();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [showBodyReported]);

  const handleVote = (target: `0x${string}` | null) => {
    setHasVoted(true);
    // Voting is handled by the server via WebSocket
  };

  const handleEjectionDismiss = () => {
    setShowEjection(false);
    setEjectedPlayer(null);
  };

  // Auto-dismiss ejection screen after 4 seconds
  useEffect(() => {
    if (showEjection) {
      const timer = setTimeout(() => {
        handleEjectionDismiss();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [showEjection]);

  const handleBack = () => {
    if (currentRoom) {
      leaveRoom();
    }
    setView("menu");
  };

  return (
    <>
      <AnimatePresence mode="wait">
        {view === "menu" && (
          <MainMenu
            key="menu"
            onPlay={handlePlay}
            isConnected={isConnected}
            error={error}
            rooms={rooms}
            stats={stats}
            leaderboard={leaderboard}
          />
        )}

        {view === "lobby" && (
          <LobbyView
            key="lobby"
            isConnected={isConnected}
            rooms={rooms}
            currentRoom={currentRoom}
            players={players}
            logs={logs}
            stats={stats}
            onJoinRoom={handleJoinRoom}
            onBack={handleBack}
          />
        )}

        {view === "game" && (
          <div key="game" className="fixed inset-0">
            {/* Fullscreen Map */}
            <ScrollableMap
              players={players}
              deadBodies={deadBodies}
              currentPlayer={currentPlayer || ("0x0" as `0x${string}`)}
              onPlayerMove={() => {}} // Spectators don't move
              spotlightedPlayer={spotlightedPlayer}
              onSpotlightPlayer={setSpotlightedPlayer}
            />

            {/* Task bar - overlay at top */}
            <div className="fixed top-0 left-0 right-0 z-40 p-4">
              <TaskBar completed={tasksCompleted} total={totalTasks} />
            </div>

            {/* Connection badge */}
            <div className="fixed top-4 right-4 z-50">
              <div className="flex items-center gap-2 bg-purple-900/80 backdrop-blur-sm rounded-lg px-4 py-2 border border-purple-500/50">
                <div className={`w-2 h-2 rounded-full animate-pulse ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
                <span className="text-purple-200 text-sm font-medium">
                  {isConnected ? "Live (WebSocket)" : "Disconnected"}
                </span>
              </div>
            </div>

            {/* Right sidebar - overlay */}
            <div className="fixed top-20 right-4 w-64 space-y-3 z-40">
              {/* Agents list */}
              <div className="bg-black/80 backdrop-blur-sm rounded-lg p-3 border border-gray-700">
                <h3 className="text-white font-bold mb-3 text-sm uppercase tracking-wider">
                  Agents ({players.filter(p => p.isAlive).length}/{players.length} alive)
                </h3>
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {players.map((player) => {
                    const isSpotlighted = player.address === spotlightedPlayer;
                    return (
                      <div
                        key={player.address}
                        onClick={() => {
                          if (player.isAlive) {
                            setSpotlightedPlayer(isSpotlighted ? null : player.address);
                          }
                        }}
                        className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-all ${
                          !player.isAlive ? "opacity-40" : "hover:bg-white/10"
                        } ${isSpotlighted ? "bg-yellow-900/50 ring-2 ring-yellow-500" : ""}`}
                      >
                        <div className="relative">
                          <AmongUsSprite colorId={player.colorId} size={28} showShadow={false} />
                          {isSpotlighted && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 rounded-full flex items-center justify-center">
                              <span className="text-[8px] text-black font-bold">*</span>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span
                            className="text-sm font-bold block truncate"
                            style={{ color: PlayerColors[player.colorId]?.light || "#fff" }}
                          >
                            {PlayerColors[player.colorId]?.name || `Player ${player.colorId}`}
                          </span>
                          <span className="text-xs text-gray-400">
                            {LocationNames[player.location] || "Unknown"}
                          </span>
                        </div>
                        {!player.isAlive && <span className="text-red-500 text-xs font-bold">DEAD</span>}
                        {isSpotlighted && <span className="text-yellow-400 text-sm">*</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Game log */}
              <div className="bg-black/80 backdrop-blur-sm rounded-lg border border-gray-700">
                <GameLogPanel logs={logs} maxHeight="180px" />
              </div>

              {/* Spectator controls */}
              <div className="bg-black/80 backdrop-blur-sm rounded-lg p-3 space-y-2 border border-gray-700">
                <h3 className="text-white font-bold text-sm">Spectator Controls</h3>
                <p className="text-gray-400 text-xs">
                  Click on an agent to follow them on the map
                </p>
                <div className="p-2 bg-slate-900/50 rounded text-center">
                  <div className="text-xs text-gray-500">Dead Bodies</div>
                  <div className="text-lg font-bold text-red-400">{deadBodies.length}</div>
                </div>
                {currentRoom && (
                  <div className="p-2 bg-cyan-900/30 rounded text-center border border-cyan-700/50">
                    <div className="text-xs text-cyan-400">Room: {currentRoom.roomId}</div>
                  </div>
                )}
                <button
                  onClick={handleBack}
                  className="w-full px-3 py-2 bg-gray-600 text-white rounded font-bold text-sm hover:bg-gray-500"
                >
                  Exit Spectator
                </button>
              </div>
            </div>
          </div>
        )}

        {view === "voting" && (
          <VotingScreen
            key="voting"
            players={players}
            currentPlayer={currentPlayer || ("0x0" as `0x${string}`)}
            onVote={handleVote}
            hasVoted={hasVoted}
            timeRemaining={timeRemaining}
            reporterColorId={0}
          />
        )}
      </AnimatePresence>

      {/* Event screens */}
      <DeadBodyReportedScreen
        isVisible={showBodyReported}
        onDismiss={handleBodyReportedDismiss}
      />

      <EjectionScreen
        isVisible={showEjection}
        ejectedColorId={ejectedPlayer?.colorId || 0}
        ejectedName={ejectedPlayer ? PlayerColors[ejectedPlayer.colorId]?.name || "Unknown" : "Unknown"}
        wasImpostor={ejectedPlayer?.role === Role.Impostor}
        impostorsRemaining={players.filter(p => p.role === Role.Impostor && p.isAlive).length}
        onDismiss={handleEjectionDismiss}
      />

      <AmongUsGameEndScreen
        isVisible={showGameEnd}
        crewmatesWon={gameWon}
        playerColorId={currentPlayerData?.colorId || 0}
        wasImpostor={currentPlayerData?.role === Role.Impostor}
        onContinue={() => {
          setShowGameEnd(false);
          setView("menu");
        }}
      />
    </>
  );
}

// Lobby View Component - shows rooms from HTTP API
interface LobbyViewProps {
  isConnected: boolean;
  rooms: RoomInfo[];
  currentRoom: RoomState | null;
  players: Player[];
  logs: GameLog[];
  stats: ServerStats | null;
  onJoinRoom: (roomId: string) => void;
  onBack: () => void;
}

function LobbyView({
  isConnected,
  rooms,
  currentRoom,
  players,
  logs,
  stats,
  onJoinRoom,
  onBack,
}: LobbyViewProps) {
  const lobbyRooms = rooms.filter(r => r.phase === "lobby");
  const playingRooms = rooms.filter(r => r.phase === "playing");
  const MIN_PLAYERS = stats?.limits.minPlayersToStart ?? 6;
  const cooldownSlots = stats?.slots.filter(s => s.state === "cooldown") ?? [];

  return (
    <SpaceBackground>
      <div className="min-h-screen p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>Back</span>
          </button>

          <div className="text-center">
            <h1 className="text-4xl font-bold text-white tracking-wider">
              GAME <span className="text-cyan-400">LOBBY</span>
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              {isConnected ? "Connected - Select a room to spectate or wait for agents" : "Connecting to server..."}
            </p>
          </div>

          <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-4 py-2 border border-slate-700">
            <div className={`w-3 h-3 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
            <span className={`text-sm ${isConnected ? "text-green-400" : "text-red-400"}`}>
              {isConnected ? "Live" : "Offline"}
            </span>
          </div>
        </div>

        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Panel - Available Rooms */}
          <div className="lg:col-span-1 bg-slate-800/50 rounded-2xl border border-slate-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Available Rooms</h2>
              <span className="text-sm text-gray-400">{lobbyRooms.length} lobby / {playingRooms.length} playing</span>
            </div>

            <div className="p-4 space-y-3 max-h-[400px] overflow-y-auto">
              {/* Playing rooms first */}
              {playingRooms.map((room) => (
                <div
                  key={room.roomId}
                  className="p-4 rounded-xl border bg-red-900/20 border-red-600/50 cursor-pointer hover:bg-red-900/30"
                  onClick={() => onJoinRoom(room.roomId)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-white font-bold">{room.roomId}</span>
                    </div>
                    <span className="text-xs px-2 py-1 bg-red-600 text-white rounded">LIVE</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {room.players.slice(0, 6).map((p, i) => (
                      <div key={i} className="w-6 h-6">
                        <AmongUsSprite colorId={p.colorId} size={24} />
                      </div>
                    ))}
                    <span className="text-xs text-gray-400">{room.players.length} players</span>
                  </div>
                </div>
              ))}

              {lobbyRooms.length === 0 && playingRooms.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>No rooms available</p>
                  <p className="text-sm mt-2">Create one to get started!</p>
                </div>
              ) : (
                lobbyRooms.map((room) => (
                  <div
                    key={room.roomId}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      currentRoom?.roomId === room.roomId
                        ? "bg-cyan-500/20 border-cyan-500/50"
                        : "bg-slate-700/30 border-slate-600/50 hover:bg-slate-700/50"
                    }`}
                    onClick={() => onJoinRoom(room.roomId)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white font-bold">{room.roomId}</span>
                      <span className="text-xs text-gray-400">
                        {room.players.length}/{room.maxPlayers} players
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {room.players.slice(0, 6).map((p, i) => (
                        <div key={i} className="w-6 h-6">
                          <AmongUsSprite colorId={p.colorId} size={24} />
                        </div>
                      ))}
                      {room.players.length > 6 && (
                        <span className="text-xs text-gray-400">+{room.players.length - 6}</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Cooldown Info */}
            {cooldownSlots.length > 0 && (
              <div className="p-4 border-t border-slate-700">
                <div className="text-sm text-orange-400 text-center">
                  {cooldownSlots.length} game{cooldownSlots.length > 1 ? 's' : ''} in cooldown
                </div>
                <div className="text-xs text-gray-500 text-center mt-1">
                  Games restart automatically after cooldown
                </div>
              </div>
            )}
          </div>

          {/* Middle Panel - Current Room */}
          <div className="lg:col-span-1 bg-slate-800/50 rounded-2xl border border-cyan-500/50 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700 bg-cyan-500/10">
              <h2 className="text-xl font-bold text-white">
                {currentRoom ? `Room: ${currentRoom.roomId}` : "Select a Room"}
              </h2>
            </div>

            <div className="p-6">
              {currentRoom ? (
                <>
                  {/* Players Grid */}
                  <div className="mb-6">
                    <div className="text-sm text-gray-400 mb-3 text-center">
                      Players ({currentRoom.players.length}/{currentRoom.maxPlayers})
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {Array.from({ length: Math.min(currentRoom.maxPlayers, 9) }).map((_, i) => {
                        const player = currentRoom.players[i];
                        return (
                          <div
                            key={i}
                            className={`aspect-square rounded-xl flex flex-col items-center justify-center ${
                              player
                                ? "bg-slate-700/50 border border-slate-600"
                                : "bg-slate-900/30 border border-dashed border-slate-700"
                            }`}
                          >
                            {player ? (
                              <>
                                <div className="w-10 h-10 mb-1">
                                  <AmongUsSprite colorId={player.colorId} size={40} />
                                </div>
                                <div className="text-xs text-gray-400">
                                  {PlayerColors[player.colorId]?.name || `P${i + 1}`}
                                </div>
                              </>
                            ) : (
                              <div className="text-gray-600 text-2xl animate-pulse">?</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Status */}
                  <div className="text-center">
                    {currentRoom.phase === "playing" ? (
                      <div className="p-4 bg-red-500/20 rounded-xl border border-red-500/30">
                        <div className="text-red-400 font-bold mb-2">Game in Progress</div>
                        <div className="text-sm text-gray-400">Watch the action unfold!</div>
                      </div>
                    ) : currentRoom.players.length >= MIN_PLAYERS ? (
                      <div className="p-4 bg-green-500/20 rounded-xl border border-green-500/30">
                        <div className="text-green-400 font-bold mb-2 animate-pulse">Starting Soon!</div>
                        <div className="text-sm text-gray-400">
                          Game will auto-start in a few seconds
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 bg-slate-900/50 rounded-xl">
                        <div className="text-gray-400">
                          Waiting for {MIN_PLAYERS - currentRoom.players.length} more agent{MIN_PLAYERS - currentRoom.players.length !== 1 ? "s" : ""}...
                        </div>
                        <div className="flex justify-center gap-1 mt-2 animate-pulse">
                          <div className="w-2 h-2 bg-cyan-500 rounded-full" />
                          <div className="w-2 h-2 bg-cyan-500 rounded-full" />
                          <div className="w-2 h-2 bg-cyan-500 rounded-full" />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4 animate-bounce">?</div>
                  <p className="text-gray-400">Select a room from the list</p>
                  <p className="text-gray-500 text-sm mt-2">or create a new one</p>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Activity Log */}
          <div className="lg:col-span-1 bg-slate-800/50 rounded-2xl border border-slate-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">Activity Log</h2>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-xs text-gray-400">Live</span>
                </div>
              </div>
            </div>

            <div className="p-4 space-y-2 max-h-[400px] overflow-y-auto font-mono text-sm">
              {logs.length === 0 ? (
                <div className="text-gray-500 text-center py-4">
                  Waiting for activity...
                </div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <span className="text-gray-600 flex-shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString().slice(0, 5)}
                    </span>
                    <span className={`${
                      log.type === "kill" ? "text-red-400" :
                      log.type === "report" ? "text-yellow-400" :
                      log.type === "vote" || log.type === "eject" ? "text-orange-400" :
                      "text-gray-300"
                    }`}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </SpaceBackground>
  );
}
