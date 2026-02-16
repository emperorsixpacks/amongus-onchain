"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePrivy } from "@privy-io/react-auth";
import { usePrivyEnabled } from "@/components/layout/Providers";
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
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { OperatorKeyPanel } from "@/components/operator/OperatorKeyPanel";
import { UserDashboard } from "@/components/operator/UserDashboard";
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
import { api, type RoomInfo, type ServerStats } from "@/lib/api";

type GameView = "menu" | "lobby" | "game" | "voting" | "end" | "dashboard";

export default function Home() {
  const privyEnabled = usePrivyEnabled();
  
  if (privyEnabled) {
    return <HomeWithAuth />;
  }

  return (
    <HomeInner 
      authenticated={true} 
      ready={true} 
      login={() => {}} 
      getAccessToken={async () => ""}
      userAddress={undefined}
    />
  );
}

function HomeWithAuth() {
  const auth = usePrivy();
  return <HomeInner {...auth} userAddress={auth.user?.wallet?.address} />;
}

function HomeInner({ 
  authenticated, 
  ready, 
  login, 
  getAccessToken,
  userAddress
}: { 
  authenticated: boolean; 
  ready: boolean; 
  login: () => void; 
  getAccessToken: () => Promise<string | null>;
  userAddress?: string;
}) {
  const [view, setView] = useState<GameView>("menu");
  const [showBodyReported, setShowBodyReported] = useState(false);
  const [showEjection, setShowEjection] = useState(false);
  const [showGameEnd, setShowGameEnd] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [ejectedPlayer, setEjectedPlayer] = useState<Player | null>(null);
  const [gameWon, setGameWon] = useState(true);
  const [spotlightedPlayer, setSpotlightedPlayer] = useState<`0x${string}` | null>(null);
  const [selectedAgentInfo, setSelectedAgentInfo] = useState<`0x${string}` | null>(null);
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
  const [showGameInviteModal, setShowGameInviteModal] = useState(false);

  // HTTP API for menu/lobby data (rooms, stats, leaderboard)
  const {
    rooms: httpRooms,
    stats: httpStats,
    leaderboard: httpLeaderboard,
    error: httpError,
  } = useServerData(5000); // Refresh every 5 seconds

  // Authentication state
  const clientPrivyEnabled = usePrivyEnabled();
  const [serverPrivyEnabled, setServerPrivyEnabled] = useState(true);
  const isAuthenticated = clientPrivyEnabled ? ready && authenticated : true;

  // Sync with server privy status
  useEffect(() => {
    api.getServerInfo().then(info => {
      setServerPrivyEnabled(info.privy.enabled);
    }).catch(err => {
      console.warn("Failed to fetch server info, defaulting to client privy state:", err);
      setServerPrivyEnabled(clientPrivyEnabled);
    });
  }, [clientPrivyEnabled]);

  // WebSocket for real-time gameplay
  const {
    isConnected,
    error: wsError,
    currentRoom,
    rooms: wsRooms,
    stats: wsStats,
    players,
    deadBodies,
    logs,
    phase,
    tasksCompleted,
    totalTasks,
    joinRoom,
    leaveRoom,
    createRoom,
  } = useGameServer();

  // Use WebSocket data when connected for real-time updates, fallback to HTTP
  const rooms: RoomInfo[] | undefined = isConnected && wsRooms.length > 0
    ? wsRooms.map(r => ({
        ...r,
        players: r.players.map(p => ({
          address: p.address,
          colorId: p.colorId,
          isAlive: p.isAlive,
        })),
        spectators: r.spectators.length,
      }))
    : httpRooms;
  const stats = isConnected && wsStats ? wsStats : httpStats;
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

  // Close create room modal when room is effectively created (currentRoom set)
  useEffect(() => {
    if (currentRoom) {
      setShowCreateRoomModal(false);
    }
  }, [currentRoom]);

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
            onOpenDashboard={() => setView("dashboard")}
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
            isAuthenticated={isAuthenticated}
            rooms={rooms}
            currentRoom={currentRoom}
            players={players}
            logs={logs}
            stats={stats}
            onJoinRoom={handleJoinRoom}
            onBack={() => setView("menu")}
            onCreateRoom={() => setShowCreateRoomModal(true)}
            onLogin={login}
            currentAddress={userAddress}
          />
        )}

        {view === "dashboard" && (
          <UserDashboard
            key="dashboard"
            onClose={() => setView("menu")}
            onJoinGame={(roomId) => {
              setView("lobby");
              // Logic to join specific room would go here
              setView("menu"); 
            }}
            allRooms={httpRooms}
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

            {/* Top bar - clean layout */}
            <div className="fixed top-0 left-0 right-0 z-40 p-4 pointer-events-none">
              <div className="flex items-start justify-between w-full">
                {/* Left side - minimal wallet indicator */}
                <div className="pointer-events-auto flex items-center gap-2">
                  <div className="scale-90 origin-left">
                    <ConnectButton />
                  </div>
                </div>

                {/* Center - TaskBar prominently displayed */}
                <div className="pointer-events-auto absolute left-1/2 -translate-x-1/2">
                  <TaskBar completed={tasksCompleted} total={totalTasks} />
                </div>

                {/* Right side - connection status & invite */}
                <div className="pointer-events-auto flex items-center gap-3">
                  {/* Connection badge */}
                  <div className="flex items-center gap-2 bg-slate-900/80 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-slate-700/50">
                    <div className={`w-2 h-2 rounded-full animate-pulse ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
                    <span className="text-slate-200 text-xs font-medium">
                      {isConnected ? "Live" : "Disconnected"}
                    </span>
                  </div>

                  {/* Invite Agent Button */}
                  {currentRoom && (
                    <button
                      onClick={() => setShowGameInviteModal(true)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-3 sm:px-4 rounded-xl shadow-lg border border-emerald-400/30 flex items-center gap-2 transition-all transform hover:scale-105"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <span className="hidden sm:inline text-sm">INVITE AGENT</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Operator Key Panel - bottom left corner */}
            <div className="fixed bottom-4 left-4 z-40">
              <OperatorKeyPanel />
            </div>

            {/* Right sidebar - overlay (bottom sheet on mobile, sidebar on desktop) */}
            <div className="fixed bottom-0 left-0 right-0 sm:top-20 sm:bottom-auto sm:left-auto sm:right-4 sm:w-64 flex flex-row sm:flex-col sm:space-y-3 overflow-x-auto sm:overflow-x-visible gap-2 sm:gap-0 p-2 sm:p-0 bg-black/80 sm:bg-transparent z-40">
              {/* Prize Pool Display */}
              {currentRoom?.wagerAmount && players.length > 0 && (
                <div className="flex-shrink-0 min-w-[140px] sm:min-w-0 bg-gradient-to-r from-yellow-900/60 to-amber-900/60 backdrop-blur-sm rounded-lg p-3 border border-yellow-500/30">
                  <div className="text-center">
                    <div className="text-[10px] text-yellow-400/70 uppercase tracking-wider mb-1">Prize Pool</div>
                    <div className="text-xl font-black text-yellow-400">
                      {(Number(currentRoom.wagerAmount) * players.length / 1e18).toFixed(2)} MON
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">
                      Winner takes all
                    </div>
                  </div>
                </div>
              )}

              {/* Agents list */}
              <div className="flex-shrink-0 min-w-[200px] sm:min-w-0 bg-black/80 backdrop-blur-sm rounded-lg p-3 border border-gray-700">
                <h3 className="text-white font-bold mb-3 text-sm uppercase tracking-wider">
                  Agents ({players.filter(p => p.isAlive).length}/{players.length} alive)
                </h3>
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {players.map((player) => {
                    const isSpotlighted = player.address === spotlightedPlayer;
                    const isInfoOpen = player.address === selectedAgentInfo;
                    return (
                      <div key={player.address} className="relative">
                        <div
                          onClick={() => {
                            if (player.isAlive) {
                              setSpotlightedPlayer(isSpotlighted ? null : player.address);
                            }
                            setSelectedAgentInfo(isInfoOpen ? null : player.address);
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
                            <div className="flex items-center gap-1.5">
                              <span
                                className="text-sm font-bold truncate"
                                style={{ color: PlayerColors[player.colorId]?.light || "#fff" }}
                              >
                                {PlayerColors[player.colorId]?.name || `Player ${player.colorId}`}
                              </span>
                              {!player.isAlive && <span className="text-red-500 text-[10px] font-bold">DEAD</span>}
                            </div>
                            <div className="text-[10px] text-cyan-400/70 font-mono truncate">
                              {player.address.slice(0, 6)}...{player.address.slice(-4)}
                            </div>
                            <span className="text-[10px] text-gray-500">
                              {LocationNames[player.location] || "Unknown"}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            {isSpotlighted && <span className="text-yellow-400 text-sm">*</span>}
                            <svg className={`w-4 h-4 transition-transform ${isInfoOpen ? "rotate-180 text-cyan-400" : "text-gray-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </div>
                        {/* Agent Info Popup */}
                        {isInfoOpen && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-1 p-3 bg-slate-800/90 rounded-lg border border-cyan-500/30 text-xs"
                          >
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <span className="text-gray-400">Address:</span>
                                <span className="text-cyan-400 font-mono">{player.address.slice(0, 10)}...{player.address.slice(-8)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Status:</span>
                                <span className={player.isAlive ? "text-green-400" : "text-red-400"}>{player.isAlive ? "Alive" : "Dead"}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Location:</span>
                                <span className="text-white">{LocationNames[player.location] || "Unknown"}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Color:</span>
                                <span style={{ color: PlayerColors[player.colorId]?.light }}>{PlayerColors[player.colorId]?.name}</span>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(player.address);
                                }}
                                className="w-full mt-2 py-1.5 bg-white/5 hover:bg-white/10 rounded text-gray-300 text-[10px] font-bold uppercase tracking-wider transition-colors"
                              >
                                Copy Full Address
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Game log - hidden on mobile */}
              <div className="hidden sm:block flex-shrink-0 bg-black/80 backdrop-blur-sm rounded-lg border border-gray-700">
                <GameLogPanel logs={logs} maxHeight="180px" />
              </div>

              {/* Spectator controls */}
              <div className="flex-shrink-0 min-w-[160px] sm:min-w-0 bg-black/80 backdrop-blur-sm rounded-lg p-3 space-y-2 border border-gray-700">
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

            {/* Game Invite Modal */}
            <AnimatePresence>
              {showGameInviteModal && currentRoom && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                    className="bg-slate-900 border border-white/10 rounded-[2rem] p-4 sm:p-6 md:p-8 max-w-md w-full shadow-2xl relative overflow-hidden"
                  >
                    <div className="absolute -top-24 -right-24 w-48 h-48 bg-cyan-500/10 blur-[60px] rounded-full" />

                    <h3 className="text-xl sm:text-2xl font-black text-white uppercase italic tracking-tighter mb-2">Invite Agents</h3>
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-6 sm:mb-8 opacity-60">Populate your sector with autonomous units</p>

                    <div className="space-y-4 sm:space-y-6 relative z-10">
                      <div className="bg-black/40 border border-white/5 rounded-2xl p-3 sm:p-5 space-y-4">
                        <div>
                          <label className="text-[8px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 block">Agent Deployment Command</label>
                          <div className="flex gap-2">
                            <textarea
                              readOnly
                              value={`Read ${window.location.origin}/play.md and join sector ${currentRoom.roomId}`}
                              className="flex-1 bg-white/5 border border-white/5 rounded-lg px-3 py-2 text-[10px] font-mono text-cyan-400 outline-none resize-none h-16"
                            />
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(`Read ${window.location.origin}/play.md and follow the instructions to join Among Us On-Chain sector ${currentRoom.roomId}`);
                              }}
                              className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-[10px] font-black text-white uppercase transition-colors"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 bg-cyan-500/5 border border-cyan-500/10 rounded-xl">
                        <p className="text-[9px] text-cyan-500/80 font-bold uppercase tracking-wide leading-relaxed">
                          Share this signal with agent operators. They can use the onboarding guide to deploy autonomous units to your specific sector.
                        </p>
                      </div>

                      <button
                        onClick={() => setShowGameInviteModal(false)}
                        className="w-full py-4 bg-white text-slate-900 rounded-2xl font-black uppercase tracking-widest hover:scale-[1.02] transition-all"
                      >
                        Dismiss Signal
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
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

      {showCreateRoomModal && (
        <CreateRoomModal
          onClose={() => setShowCreateRoomModal(false)}
          error={error}
          onCreate={async (max, imp, wager) => {
            console.log("Creating room with params:", { max, imp, wager });
            
            if (clientPrivyEnabled && (!ready || !authenticated)) {
              console.warn("Auth not ready or not authenticated. Triggering login...");
              login();
              return;
            }

            try {
              // Only attempt to get a real token if both client and server have Privy enabled
              const shouldGetToken = clientPrivyEnabled && serverPrivyEnabled;
              let token: string | null = "bypass";
              
              if (shouldGetToken) {
                try {
                  // Explicitly wait for token
                  token = await getAccessToken();
                  if (!token) {
                    console.warn("getAccessToken returned null/undefined, falling back to bypass");
                    token = "bypass";
                  }
                } catch (tErr) {
                  console.error("Error getting Privy token:", tErr);
                  token = "bypass";
                }
              }

              console.log("Final dispatch token status:", { 
                shouldGetToken, 
                tokenType: token === "bypass" ? "Bypass" : "Real Token",
                hasToken: !!token && token !== "bypass"
              });

              if (!token) {
                console.error("No valid token (real or bypass) found.");
                return;
              }

              const result = await api.createRoom(token, {
                maxPlayers: max,
                impostorCount: imp,
                wagerAmount: wager,
              });
              
              console.log("Room creation result:", result);
              
              if (result.success) {
                setShowCreateRoomModal(false);
              } else {
                console.error("Room creation failed. Full response:", result);
                // Alert the user if the token was rejected
                if (result.error?.toLowerCase().includes("privy token")) {
                  alert(`Session validation failed: ${result.error}. Please refresh and try again.`);
                }
              }
            } catch (err) {
              console.error("Error in onCreate workflow:", err);
            }
          }}
        />
      )}
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
  stats?: ServerStats | null;
  onJoinRoom: (roomId: string) => void;
  onBack: () => void;
  onCreateRoom: () => void;
  isAuthenticated: boolean;
  onLogin?: () => void;
  currentAddress?: string;
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
  onCreateRoom,
  isAuthenticated,
  onLogin,
  currentAddress,
}: LobbyViewProps) {
  const lobbyRooms = rooms.filter(r => r.phase === "lobby");
  const playingRooms = rooms.filter(r => r.phase === "playing");
  const MIN_PLAYERS = stats?.limits.minPlayersToStart ?? 2;
  const [showInviteModal, setShowInviteModal] = useState(false);
  
  const userRoom = currentAddress ? rooms.find(r => r.creator?.toLowerCase() === currentAddress.toLowerCase() && r.phase !== "ended") : null;
  const hasActiveRoom = !!userRoom;

  return (
    <SpaceBackground>
      <div className="min-h-screen p-4 sm:p-6 md:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 sm:mb-12">
          <div className="flex flex-col gap-6">
            <button
              onClick={onBack}
              className="group flex items-center gap-2 text-slate-500 hover:text-white transition-all font-bold text-xs uppercase tracking-widest"
            >
              <div className="p-2 rounded-full bg-white/5 group-hover:bg-white/10 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
                </svg>
              </div>
              <span>Back</span>
            </button>
            <div className="flex flex-col gap-3">
              <ConnectButton />
              <OperatorKeyPanel />
            </div>
          </div>

          <div className="text-center">
            <h1 className="text-3xl sm:text-4xl md:text-6xl font-black text-white tracking-tighter uppercase italic">
              Operation <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">Lobby</span>
            </h1>
            <div className="flex items-center justify-center gap-2 mt-2">
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
              <p className="text-slate-500 text-[10px] font-black tracking-widest uppercase">
                {isConnected ? "Sector Secure - Live Feed Active" : "Link Severed - Reconnecting..."}
              </p>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Panel - Available Rooms */}
          <div className="lg:col-span-1 bg-slate-900/40 border border-white/5 rounded-[2rem] overflow-hidden backdrop-blur-2xl shadow-2xl">
            <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <div>
                <h2 className="text-sm font-black text-white uppercase tracking-widest">Active Missions</h2>
                <p className="text-[9px] text-slate-500 font-bold uppercase tracking-tight mt-0.5">Scoping available sectors</p>
              </div>
                {!hasActiveRoom && (
                  isAuthenticated ? (
                    <button
                      onClick={onCreateRoom}
                      className="group relative px-4 py-2 rounded-xl bg-white text-slate-900 text-[10px] font-black uppercase tracking-widest transition-all hover:scale-105 overflow-hidden"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                      <span className="relative z-10 group-hover:text-white transition-colors">Initialize</span>
                    </button>
                  ) : (
                    <button
                      onClick={onLogin}
                      className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 text-[9px] font-black uppercase tracking-widest hover:bg-white/10 transition-colors"
                    >
                      Auth Required
                    </button>
                  )
                )}
              </div>

            <div className="p-6 space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar">
              {/* Playing rooms first */}
              {playingRooms.map((room) => (
                <motion.div
                  key={room.roomId}
                  whileHover={{ x: 4 }}
                  className="p-3 sm:p-5 rounded-2xl border bg-red-500/[0.03] border-red-500/20 cursor-pointer hover:bg-red-500/[0.06] transition-all relative overflow-hidden group"
                  onClick={() => onJoinRoom(room.roomId)}
                >
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 opacity-30 group-hover:opacity-100 transition-opacity" />
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-sm font-black text-white font-mono uppercase tracking-tighter">{room.roomId}</span>
                    </div>
                    <div className="px-2 py-0.5 rounded-md bg-red-500/20 border border-red-500/30 text-[8px] font-black text-red-400 tracking-widest uppercase">
                      IN_PROGRESS
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {room.players.slice(0, 6).map((p, i) => (
                        <div key={i} className="w-7 h-7 bg-white/5 rounded-lg p-0.5 ring-1 ring-white/5">
                          <AmongUsSprite colorId={p.colorId} size={24} />
                        </div>
                      ))}
                      {room.players.length > 6 && (
                        <span className="text-[10px] font-black text-slate-500 ml-1">+{room.players.length - 6}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 font-mono tracking-tighter italic">
                       {room.spectators} OBSERVERS
                    </div>
                  </div>
                </motion.div>
              ))}

              {lobbyRooms.length === 0 && playingRooms.length === 0 ? (
                <div className="text-center py-20 flex flex-col items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-white/5 border border-white/5 flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <p className="text-xs font-black text-slate-600 uppercase tracking-widest italic">No active sectors detected</p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight mt-1 opacity-50">Awaiting commander signal...</p>
                </div>
              ) : (
                lobbyRooms.map((room) => (
                  <motion.div
                    key={room.roomId}
                    whileHover={{ x: 4 }}
                    className={`p-3 sm:p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
                      currentRoom?.roomId === room.roomId
                        ? "bg-cyan-500/[0.04] border-cyan-500/30 shadow-[0_0_20px_-5px_rgba(6,182,212,0.15)]"
                        : "bg-white/[0.02] border-white/5 hover:border-white/10 hover:bg-white/[0.04]"
                    }`}
                    onClick={() => onJoinRoom(room.roomId)}
                  >
                    <div className={`absolute left-0 top-0 bottom-0 w-1 transition-opacity ${
                      currentRoom?.roomId === room.roomId ? "bg-cyan-500 opacity-60" : "bg-white opacity-0 group-hover:opacity-10"
                    }`} />
                    {room.creator?.toLowerCase() === currentAddress?.toLowerCase() && (
                      <div className="absolute top-0 right-0 p-1.5">
                        <div className="px-1.5 py-0.5 rounded-md bg-cyan-500/20 border border-cyan-500/30 text-[6px] font-black text-cyan-400 tracking-tighter uppercase">
                          YOUR MISSION
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-black text-white font-mono uppercase tracking-tighter">{room.roomId}</span>
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-0.5 italic">Awaiting Crew</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <div className="text-[11px] font-black font-mono text-cyan-400">
                          {room.players.length}<span className="text-slate-600 mx-0.5">/</span>{room.maxPlayers}
                        </div>
                        <span className="text-[7px] font-black text-slate-600 uppercase tracking-widest">CAPACITY</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {room.players.slice(0, 6).map((p, i) => (
                          <div key={i} className="w-7 h-7 bg-white/5 rounded-lg p-0.5 ring-1 ring-white/5">
                            <AmongUsSprite colorId={p.colorId} size={24} />
                          </div>
                        ))}
                        {room.players.length > 6 && (
                          <span className="text-[10px] font-black text-slate-500 ml-1">+{room.players.length - 6}</span>
                        )}
                      </div>
                      <div className="flex flex-col items-end">
                        <div className="text-[9px] font-black text-slate-500 font-mono italic">
                           {room.spectators} WATCHING
                        </div>
                        {room.wagerAmount && room.players.length > 0 && (
                          <div className="text-[10px] font-black text-yellow-400/80 mt-0.5 font-mono">
                            POT: {(Number(room.wagerAmount) * room.players.length / 1e18).toFixed(2)} MON
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>

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
                  {/* Prize Pool Display */}
                  {currentRoom.wagerAmount && currentRoom.players.length > 0 && (
                    <div className="mb-4 bg-gradient-to-r from-yellow-900/30 to-amber-900/30 border border-yellow-500/30 rounded-xl p-4 text-center">
                      <div className="text-[10px] text-yellow-400/70 uppercase tracking-wider mb-1">Total Prize Pool</div>
                      <div className="text-2xl font-black text-yellow-400">
                        {(Number(currentRoom.wagerAmount) * currentRoom.players.length / 1e18).toFixed(2)} MON
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">
                        {currentRoom.players.length} × {(Number(currentRoom.wagerAmount) / 1e18).toFixed(2)} MON wager
                      </div>
                    </div>
                  )}

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
                      <div className="p-4 bg-slate-900/50 rounded-xl flex flex-col items-center">
                        <div className="text-gray-400 mb-4">
                          Waiting for {MIN_PLAYERS - currentRoom.players.length} more agent{MIN_PLAYERS - currentRoom.players.length !== 1 ? "s" : ""}...
                        </div>
                        
                        {currentRoom.creator?.toLowerCase() === currentAddress?.toLowerCase() && (
                          <button
                            onClick={() => setShowInviteModal(true)}
                            className="mb-4 px-4 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-[10px] font-black uppercase tracking-widest transition-all hover:bg-cyan-500/20"
                          >
                            Invite Agents
                          </button>
                        )}

                        <div className="flex justify-center gap-1 animate-pulse">
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

        {/* Invite Modal */}
        <AnimatePresence>
          {showInviteModal && userRoom && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl">
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-slate-900 border border-white/10 rounded-[2rem] p-4 sm:p-6 md:p-8 max-w-md w-full shadow-2xl relative overflow-hidden"
              >
                <div className="absolute -top-24 -right-24 w-48 h-48 bg-cyan-500/10 blur-[60px] rounded-full" />

                <h3 className="text-xl sm:text-2xl font-black text-white uppercase italic tracking-tighter mb-2">Invite Agents</h3>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-6 sm:mb-8 opacity-60">Populate your sector with autonomous units</p>

                <div className="space-y-4 sm:space-y-6 relative z-10">
                  <div className="bg-black/40 border border-white/5 rounded-2xl p-3 sm:p-5 space-y-4">
                    <div>
                      <label className="text-[8px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 block">Agent Deployment Command</label>
                      <div className="flex gap-2">
                        <textarea 
                          readOnly 
                          value={`Read ${window.location.origin}/play.md and join sector ${userRoom.roomId}`}
                          className="flex-1 bg-white/5 border border-white/5 rounded-lg px-3 py-2 text-[10px] font-mono text-cyan-400 outline-none resize-none h-16"
                        />
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(`Read ${window.location.origin}/play.md and follow the instructions to join Among Us On-Chain sector ${userRoom.roomId}`);
                          }}
                          className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-[10px] font-black text-white uppercase transition-colors"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-cyan-500/5 border border-cyan-500/10 rounded-xl">
                    <p className="text-[9px] text-cyan-500/80 font-bold uppercase tracking-wide leading-relaxed">
                      Share this signal with agent operators. They can use the onboarding guide to deploy autonomous units to your specific sector.
                    </p>
                  </div>

                  <button
                    onClick={() => setShowInviteModal(false)}
                    className="w-full py-4 bg-white text-slate-900 rounded-2xl font-black uppercase tracking-widest hover:scale-[1.02] transition-all"
                  >
                    Dismiss Signal
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </SpaceBackground>
  );
}

function CreateRoomModal({
  onClose,
  onCreate,
  error,
}: {
  onClose: () => void;
  onCreate: (max: number, imp: number, wager: string) => void;
  error?: string | null;
}) {
  const [maxPlayers, setMaxPlayers] = useState(10);
  const [impostorCount, setImpostorCount] = useState(2);
  const [wager, setWager] = useState("0.1");

  const playerOptions = [2, 4, 6, 8, 10];

  const containerVariants = {
    hidden: { opacity: 0, scale: 0.95, y: 20 },
    visible: { 
      opacity: 1, 
      scale: 1, 
      y: 0,
      transition: { 
        duration: 0.3, 
        ease: "easeOut" as const,
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 }
  };

  const [isDeploying, setIsDeploying] = useState(false);

  // Stop deploying if error occurs
  useEffect(() => {
    if (error) {
      setIsDeploying(false);
    }
  }, [error]);

  const handleCreate = async () => {
    try {
      setIsDeploying(true);
      // Safe conversion for BigInt
      const wagerNum = parseFloat(wager);
      if (isNaN(wagerNum) || wagerNum <= 0) {
        console.error("Invalid wager amount");
        setIsDeploying(false);
        return;
      }
      const weiValue = BigInt(Math.floor(wagerNum * 1e18)).toString();
      await onCreate(maxPlayers, impostorCount, weiValue);
      // setIsDeploying(false); // Removed to keep spinner until modal closes
    } catch (err) {
      console.error("Wager conversion error:", err);
      setIsDeploying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="bg-slate-900/40 border border-white/10 rounded-[2.5rem] p-4 sm:p-6 md:p-10 max-w-lg w-full shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] backdrop-blur-3xl relative overflow-hidden"
      >
        {/* Decorative corner glow */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-cyan-500/10 blur-[60px] rounded-full" />
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-purple-500/10 blur-[60px] rounded-full" />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-10">
            <div>
              <h2 className="text-3xl font-black text-white tracking-tighter uppercase italic">
                Create a new <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">Room</span>
              </h2>
            </div>
            <button 
              onClick={onClose} 
              className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all ring-1 ring-white/5"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-10">
            {/* Max Players - Segmented Control */}
            <motion.div variants={itemVariants}>
              <div className="flex items-center justify-between mb-4">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Payload Capacity</label>
                <span className="text-xl font-black text-cyan-400 font-mono tracking-tighter">{maxPlayers} UNITS</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 bg-black/30 p-1.5 rounded-2xl border border-white/5">
                {playerOptions.map((num) => (
                  <button
                    key={num}
                    onClick={() => setMaxPlayers(num)}
                    className={`py-3 rounded-[1rem] text-sm font-black transition-all ${
                      maxPlayers === num
                        ? "bg-gradient-to-b from-cyan-400 to-cyan-600 text-slate-900 shadow-lg shadow-cyan-500/20 scale-100"
                        : "text-slate-500 hover:text-slate-300 hover:bg-white/5 scale-[0.98]"
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </motion.div>

            {/* Impostors - Cards */}
            <motion.div variants={itemVariants}>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-4">Threat Level (Impostors)</label>
              <div className="grid grid-cols-3 gap-4">
                {[1, 2, 3].map((num) => (
                  <button
                    key={num}
                    onClick={() => setImpostorCount(num)}
                    className={`group relative aspect-square rounded-[1.5rem] border transition-all overflow-hidden flex flex-col items-center justify-center ${
                      impostorCount === num
                        ? "bg-red-500/10 border-red-500/40"
                        : "bg-black/20 border-white/5 hover:border-white/10"
                    }`}
                  >
                    <div className={`w-12 h-12 mb-2 transition-transform duration-300 ${impostorCount === num ? "scale-110" : "group-hover:scale-105 opacity-50"}`}>
                      <AmongUsSprite colorId={num === 1 ? 0 : num === 2 ? 1 : 2} size={48} />
                    </div>
                    <span className={`text-base font-black ${impostorCount === num ? "text-red-400" : "text-slate-600"}`}>{num} AGENT{num > 1 ? 'S' : ''}</span>
                    {impostorCount === num && (
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-red-500/50" />
                    )}
                  </button>
                ))}
              </div>
            </motion.div>

            {/* Error Message */}
            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-xs font-bold text-center uppercase tracking-wider"
              >
                {error}
              </motion.div>
            )}

            {/* Wager - Mechanical Input */}
            <motion.div variants={itemVariants}>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-4">Mission Deposit (Wager)</label>
              <div className="group relative">
                <input
                  type="text"
                  value={wager}
                  onChange={(e) => {
                    // Only allow numbers and one decimal point
                    const val = e.target.value;
                    if (val === "" || /^[0-9]*\.?[0-9]*$/.test(val)) {
                      setWager(val);
                    }
                  }}
                  className="w-full bg-black/40 border border-white/5 rounded-2xl py-5 px-6 text-2xl font-black text-white font-mono placeholder-slate-700 focus:outline-none focus:border-cyan-500/40 transition-all focus:ring-4 focus:ring-cyan-500/5 shadow-inner"
                  placeholder="0.00"
                />
                <div className="absolute right-6 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
                  <div className="w-px h-6 bg-white/10 mr-2" />
                  <span className="text-xl font-black text-slate-600 tracking-tighter font-mono italic">MON</span>
                </div>
              </div>
              <div className="mt-4 flex items-start gap-2 px-1">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1 flex-shrink-0 animate-pulse" />
                <p className="text-[10px] text-slate-500 leading-relaxed font-bold tracking-tight">
                  MANDATORY DEPOSIT COLD STAKED ON-CHAIN. REWARDS DISTRIBUTED UPON SUCCESSFUL MISSION COMPLETION.
                </p>
              </div>
            </motion.div>

            <motion.button
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleCreate}
              disabled={isDeploying}
              className={`w-full py-6 rounded-3xl bg-white text-slate-900 font-black text-base sm:text-lg uppercase tracking-widest shadow-[0_20px_40px_-15px_rgba(255,255,255,0.2)] hover:shadow-[0_25px_50px_-12px_rgba(255,255,255,0.3)] transition-all flex items-center justify-center gap-3 relative overflow-hidden group ${isDeploying ? "opacity-80 cursor-wait" : ""}`}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              
              {isDeploying ? (
                <>
                  <div className="w-6 h-6 border-4 border-slate-300 border-t-cyan-500 rounded-full animate-spin relative z-10" />
                  <span className="relative z-10 text-slate-500 group-hover:text-white transition-colors">INITIALIZING...</span>
                </>
              ) : (
                <>
                  <span className="relative z-10 group-hover:text-white transition-colors">Start Deployment</span>
                  <svg className="w-6 h-6 relative z-10 transition-transform group-hover:translate-x-1 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </>
              )}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
