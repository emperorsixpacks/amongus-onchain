import {
  type GameStateSnapshot,
  type PlayerState,
  type DeadBodyState,
  type GamePhase,
  Location,
  type SabotageType,
} from "./types.js";
import { createLogger } from "./logger.js";

const logger = createLogger("game-state-manager");

// Game constants
const KILL_COOLDOWN_ROUNDS = 2; // Impostors must wait 2 rounds between kills
const MAX_EMERGENCY_MEETINGS_PER_PLAYER = 1; // Each player gets 1 emergency meeting
const SABOTAGE_COOLDOWN_MS = 30000; // 30 seconds between sabotages

// Sabotage configuration
interface SabotageConfig {
  isCritical: boolean;
  timeLimit: number; // Seconds (0 = until fixed manually)
  fixLocations: number[]; // Location enums
  requiresMultipleFixes: boolean; // E.g., Reactor needs 2 players
}

const SABOTAGE_CONFIG: Record<number, SabotageConfig> = {
  // SabotageType.Lights = 1
  1: {
    isCritical: false,
    timeLimit: 0,
    fixLocations: [3], // Electrical
    requiresMultipleFixes: false,
  },
  // SabotageType.Reactor = 2
  2: {
    isCritical: true,
    timeLimit: 45,
    fixLocations: [8], // Reactor
    requiresMultipleFixes: true, // Needs 2 players
  },
  // SabotageType.O2 = 3
  3: {
    isCritical: true,
    timeLimit: 30,
    fixLocations: [1, 8], // Admin, Reactor
    requiresMultipleFixes: false, // Either location works
  },
  // SabotageType.Comms = 4
  4: {
    isCritical: false,
    timeLimit: 0,
    fixLocations: [1], // Admin
    requiresMultipleFixes: false,
  },
};

// Room adjacency map (The Skeld)
// Location enum: Cafeteria=0, Admin=1, Storage=2, Electrical=3, MedBay=4, UpperEngine=5, LowerEngine=6, Security=7, Reactor=8
const ROOM_ADJACENCY: Map<number, number[]> = new Map([
  [0, [1, 2, 4, 5]],       // Cafeteria -> Admin, Storage, MedBay, UpperEngine
  [1, [0, 2]],              // Admin -> Cafeteria, Storage
  [2, [0, 1, 3, 6]],        // Storage -> Cafeteria, Admin, Electrical, LowerEngine
  [3, [2, 6]],              // Electrical -> Storage, LowerEngine
  [4, [0, 5]],              // MedBay -> Cafeteria, UpperEngine
  [5, [0, 4, 8]],           // UpperEngine -> Cafeteria, MedBay, Reactor
  [6, [2, 3, 8]],           // LowerEngine -> Storage, Electrical, Reactor
  [7, [8]],                 // Security -> Reactor
  [8, [5, 6, 7]],           // Reactor -> UpperEngine, LowerEngine, Security
]);

// Vent connections (for impostors) - locations connected by vents
const VENT_CONNECTIONS: Map<number, number[]> = new Map([
  [1, [0]],                 // Admin <-> Cafeteria
  [0, [1]],                 // Cafeteria <-> Admin
  [4, [3, 7]],              // MedBay <-> Electrical, Security
  [3, [4, 7]],              // Electrical <-> MedBay, Security
  [7, [4, 3]],              // Security <-> MedBay, Electrical
  [8, [5, 6]],              // Reactor <-> UpperEngine, LowerEngine
  [5, [8, 6]],              // UpperEngine <-> Reactor, LowerEngine
  [6, [8, 5]],              // LowerEngine <-> Reactor, UpperEngine
]);

// Sabotage state
interface SabotageState {
  type: number; // SabotageType enum
  startTime: number;
  endTime: number; // For critical sabotages
  fixProgress: Map<number, string[]>; // location -> players who fixed at that location
  sabotager: string;
}

// Camera locations (rooms that cameras can see)
const CAMERA_LOCATIONS: number[] = [0, 2, 4, 8]; // Cafeteria, Storage, MedBay, Reactor

// Internal game state tracking
interface GameInternalState {
  impostors: Set<string>; // addresses of impostors
  votes: Map<string, string | null>; // voter -> target (null = skip)
  taskLocations: Map<string, number[]>; // player -> assigned task locations
  lastKillRound: Map<string, number>; // impostor -> last round they killed
  emergencyMeetingsUsed: Map<string, number>; // player -> meetings used
  activeSabotage: SabotageState | null; // current sabotage
  lastSabotageTime: number; // timestamp of last sabotage
  playersInVent: Set<string>; // players currently hiding in vents
  playersOnCameras: Set<string>; // players currently watching cameras
}

export interface WinConditionResult {
  winner: "crewmates" | "impostors" | null;
  reason?: "tasks" | "votes" | "kills";
}

export class GameStateManager {
  // gameId -> GameStateSnapshot
  private games: Map<string, GameStateSnapshot> = new Map();
  // gameId -> internal state
  private internalState: Map<string, GameInternalState> = new Map();

  /**
   * Create or get a game state
   */
  getOrCreateGame(gameId: string): GameStateSnapshot {
    if (!this.games.has(gameId)) {
      const state: GameStateSnapshot = {
        gameId,
        phase: 0, // Lobby
        round: 0,
        phaseEndTime: 0,
        players: [],
        deadBodies: [],
        alivePlayers: 0,
        totalTasksCompleted: 0,
        totalTasksRequired: 0,
        activeSabotage: 0, // None
      };
      this.games.set(gameId, state);
      this.internalState.set(gameId, {
        impostors: new Set(),
        votes: new Map(),
        taskLocations: new Map(),
        lastKillRound: new Map(),
        emergencyMeetingsUsed: new Map(),
        activeSabotage: null,
        lastSabotageTime: 0,
        playersInVent: new Set(),
        playersOnCameras: new Set(),
      });
      logger.info(`Created new game state: ${gameId}`);
    }
    return this.games.get(gameId)!;
  }

  /**
   * Get game state
   */
  getGame(gameId: string): GameStateSnapshot | undefined {
    return this.games.get(gameId);
  }

  /**
   * Check if game exists
   */
  hasGame(gameId: string): boolean {
    return this.games.has(gameId);
  }

  /**
   * Add or update a player in a game
   */
  updatePlayer(gameId: string, playerState: PlayerState): void {
    const game = this.getOrCreateGame(gameId);
    const existingIndex = game.players.findIndex(
      (p) => p.address.toLowerCase() === playerState.address.toLowerCase()
    );

    if (existingIndex >= 0) {
      game.players[existingIndex] = playerState;
    } else {
      game.players.push(playerState);
    }

    // Update alive count
    game.alivePlayers = game.players.filter((p) => p.isAlive).length;

    logger.debug(`Updated player ${playerState.address} in game ${gameId}`);
  }

  /**
   * Get a player from a game
   */
  getPlayer(gameId: string, address: string): PlayerState | undefined {
    const game = this.games.get(gameId);
    if (!game) return undefined;
    return game.players.find(
      (p) => p.address.toLowerCase() === address.toLowerCase()
    );
  }

  /**
   * Update player position
   */
  updatePlayerPosition(
    gameId: string,
    address: string,
    location: Location
  ): Location | undefined {
    const game = this.games.get(gameId);
    if (!game) return undefined;

    const player = game.players.find(
      (p) => p.address.toLowerCase() === address.toLowerCase()
    );
    if (!player) return undefined;

    const previousLocation = player.location;
    player.location = location;

    logger.debug(
      `Player ${address} moved from ${previousLocation} to ${location} in game ${gameId}`
    );
    return previousLocation;
  }

  /**
   * Mark player as dead
   */
  killPlayer(
    gameId: string,
    victimAddress: string,
    location: Location,
    round: number
  ): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;

    const player = game.players.find(
      (p) => p.address.toLowerCase() === victimAddress.toLowerCase()
    );
    if (!player || !player.isAlive) return false;

    player.isAlive = false;

    // Add dead body
    const body: DeadBodyState = {
      victim: victimAddress,
      location,
      round,
      reported: false,
    };
    game.deadBodies.push(body);

    // Update alive count
    game.alivePlayers = game.players.filter((p) => p.isAlive).length;

    logger.info(`Player ${victimAddress} killed at ${location} in game ${gameId}`);
    return true;
  }

  /**
   * Update game phase
   */
  updatePhase(
    gameId: string,
    phase: GamePhase,
    round: number,
    phaseEndTime: number
  ): GamePhase | undefined {
    const game = this.games.get(gameId);
    if (!game) return undefined;

    const previousPhase = game.phase;
    game.phase = phase;
    game.round = round;
    game.phaseEndTime = phaseEndTime;

    // Clear dead bodies when discussion starts (they get reported)
    if (phase === 4 || phase === 5) {
      // Discussion or Voting
      for (const body of game.deadBodies) {
        body.reported = true;
      }
    }

    // Reset voted flags when voting ends
    if (phase === 6) {
      // VoteResult
      for (const player of game.players) {
        player.hasVoted = false;
      }
    }

    logger.info(
      `Game ${gameId} phase changed: ${previousPhase} -> ${phase} (round ${round})`
    );
    return previousPhase;
  }

  /**
   * Record a vote
   */
  recordVote(gameId: string, voterAddress: string): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;

    const player = game.players.find(
      (p) => p.address.toLowerCase() === voterAddress.toLowerCase()
    );
    if (!player) return false;

    player.hasVoted = true;
    return true;
  }

  /**
   * Eject a player (from voting)
   */
  ejectPlayer(gameId: string, address: string): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;

    const player = game.players.find(
      (p) => p.address.toLowerCase() === address.toLowerCase()
    );
    if (!player) return false;

    player.isAlive = false;
    game.alivePlayers = game.players.filter((p) => p.isAlive).length;

    logger.info(`Player ${address} ejected from game ${gameId}`);
    return true;
  }

  /**
   * Update task progress
   */
  updateTaskProgress(
    gameId: string,
    address: string,
    tasksCompleted: number,
    totalTasks: number
  ): number | undefined {
    const game = this.games.get(gameId);
    if (!game) return undefined;

    const player = game.players.find(
      (p) => p.address.toLowerCase() === address.toLowerCase()
    );
    if (!player) return undefined;

    player.tasksCompleted = tasksCompleted;
    player.totalTasks = totalTasks;

    // Recalculate total progress
    let totalCompleted = 0;
    let totalRequired = 0;
    for (const p of game.players) {
      totalCompleted += p.tasksCompleted;
      totalRequired += p.totalTasks;
    }

    game.totalTasksCompleted = totalCompleted;
    game.totalTasksRequired = totalRequired;

    const progress = totalRequired > 0 ? (totalCompleted / totalRequired) * 100 : 0;
    return progress;
  }

  /**
   * Remove a player from a game
   */
  removePlayer(gameId: string, address: string): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;

    const index = game.players.findIndex(
      (p) => p.address.toLowerCase() === address.toLowerCase()
    );
    if (index < 0) return false;

    game.players.splice(index, 1);
    game.alivePlayers = game.players.filter((p) => p.isAlive).length;

    logger.info(`Player ${address} removed from game ${gameId}`);
    return true;
  }

  /**
   * Get all active game IDs
   */
  getActiveGameIds(): string[] {
    return Array.from(this.games.keys());
  }

  /**
   * Get stats
   */
  getStats(): { games: number; players: number } {
    let totalPlayers = 0;
    for (const game of this.games.values()) {
      totalPlayers += game.players.length;
    }
    return { games: this.games.size, players: totalPlayers };
  }

  // ============ IMPOSTOR TRACKING ============

  /**
   * Assign impostors for a game
   */
  assignImpostors(gameId: string, addresses: string[]): void {
    const internal = this.internalState.get(gameId);
    if (!internal) return;

    internal.impostors = new Set(addresses.map(a => a.toLowerCase()));
    logger.info(`Assigned impostors in game ${gameId}: ${addresses.join(", ")}`);
  }

  /**
   * Check if player is an impostor
   */
  isImpostor(gameId: string, address: string): boolean {
    const internal = this.internalState.get(gameId);
    if (!internal) return false;
    return internal.impostors.has(address.toLowerCase());
  }

  /**
   * Get all impostor addresses
   */
  getImpostors(gameId: string): string[] {
    const internal = this.internalState.get(gameId);
    if (!internal) return [];
    return Array.from(internal.impostors);
  }

  /**
   * Count alive impostors
   */
  getAliveImpostorCount(gameId: string): number {
    const game = this.games.get(gameId);
    const internal = this.internalState.get(gameId);
    if (!game || !internal) return 0;

    return game.players.filter(
      p => p.isAlive && internal.impostors.has(p.address.toLowerCase())
    ).length;
  }

  /**
   * Count alive crewmates
   */
  getAliveCrewmateCount(gameId: string): number {
    const game = this.games.get(gameId);
    const internal = this.internalState.get(gameId);
    if (!game || !internal) return 0;

    return game.players.filter(
      p => p.isAlive && !internal.impostors.has(p.address.toLowerCase())
    ).length;
  }

  // ============ KILL COOLDOWN ============

  /**
   * Check if impostor can kill (cooldown elapsed)
   */
  canKill(gameId: string, killerAddress: string, currentRound: number): boolean {
    const internal = this.internalState.get(gameId);
    if (!internal) return false;

    const killerKey = killerAddress.toLowerCase();

    // Must be an impostor
    if (!internal.impostors.has(killerKey)) {
      return false;
    }

    const lastKill = internal.lastKillRound.get(killerKey);
    if (lastKill === undefined) {
      // Never killed before, can kill
      return true;
    }

    // Check if cooldown has elapsed
    const roundsSinceKill = currentRound - lastKill;
    return roundsSinceKill >= KILL_COOLDOWN_ROUNDS;
  }

  /**
   * Record a kill for cooldown tracking
   */
  recordKill(gameId: string, killerAddress: string, currentRound: number): void {
    const internal = this.internalState.get(gameId);
    if (!internal) return;

    internal.lastKillRound.set(killerAddress.toLowerCase(), currentRound);
    logger.debug(`Recorded kill by ${killerAddress} at round ${currentRound}`);
  }

  /**
   * Get remaining cooldown rounds for an impostor
   */
  getKillCooldown(gameId: string, killerAddress: string, currentRound: number): number {
    const internal = this.internalState.get(gameId);
    if (!internal) return 0;

    const lastKill = internal.lastKillRound.get(killerAddress.toLowerCase());
    if (lastKill === undefined) return 0;

    const roundsSinceKill = currentRound - lastKill;
    const remaining = KILL_COOLDOWN_ROUNDS - roundsSinceKill;
    return Math.max(0, remaining);
  }

  // ============ MOVEMENT VALIDATION ============

  /**
   * Check if movement between two locations is valid (adjacent rooms)
   */
  isValidMove(from: Location, to: Location): boolean {
    if (from === to) return true; // Staying in place is valid

    const adjacent = ROOM_ADJACENCY.get(from);
    return adjacent?.includes(to) ?? false;
  }

  /**
   * Check if vent movement is valid (for impostors)
   */
  isValidVent(from: Location, to: Location): boolean {
    const connected = VENT_CONNECTIONS.get(from);
    return connected?.includes(to) ?? false;
  }

  /**
   * Get adjacent rooms from a location
   */
  getAdjacentRooms(location: Location): Location[] {
    return (ROOM_ADJACENCY.get(location) ?? []) as Location[];
  }

  /**
   * Get vent-connected rooms from a location
   */
  getVentConnections(location: Location): Location[] {
    return (VENT_CONNECTIONS.get(location) ?? []) as Location[];
  }

  /**
   * Validate player movement with full context
   * Returns { valid: boolean, reason?: string }
   */
  validateMovement(
    gameId: string,
    playerAddress: string,
    from: Location,
    to: Location,
    isVent: boolean = false
  ): { valid: boolean; reason?: string } {
    const game = this.games.get(gameId);
    const internal = this.internalState.get(gameId);
    if (!game || !internal) {
      return { valid: false, reason: "Game not found" };
    }

    const player = game.players.find(
      p => p.address.toLowerCase() === playerAddress.toLowerCase()
    );
    if (!player) {
      return { valid: false, reason: "Player not in game" };
    }

    // Dead players (ghosts) can move anywhere
    if (!player.isAlive) {
      return { valid: true };
    }

    // Vent movement - only for impostors
    if (isVent) {
      if (!internal.impostors.has(playerAddress.toLowerCase())) {
        return { valid: false, reason: "Only impostors can use vents" };
      }
      if (!this.isValidVent(from, to)) {
        return { valid: false, reason: "No vent connection between these rooms" };
      }
      return { valid: true };
    }

    // Normal movement - must be adjacent
    if (!this.isValidMove(from, to)) {
      const adjacent = this.getAdjacentRooms(from);
      return {
        valid: false,
        reason: `Cannot move from ${Location[from]} to ${Location[to]}. Adjacent rooms: ${adjacent.map(r => Location[r]).join(", ")}`,
      };
    }

    return { valid: true };
  }

  // ============ EMERGENCY MEETINGS ============

  /**
   * Check if player can call an emergency meeting
   */
  canCallMeeting(gameId: string, playerAddress: string): { canCall: boolean; reason?: string; remaining: number } {
    const game = this.games.get(gameId);
    const internal = this.internalState.get(gameId);
    if (!game || !internal) {
      return { canCall: false, reason: "Game not found", remaining: 0 };
    }

    const player = game.players.find(
      p => p.address.toLowerCase() === playerAddress.toLowerCase()
    );
    if (!player) {
      return { canCall: false, reason: "Player not in game", remaining: 0 };
    }

    if (!player.isAlive) {
      return { canCall: false, reason: "Dead players cannot call meetings", remaining: 0 };
    }

    const playerKey = playerAddress.toLowerCase();
    const meetingsUsed = internal.emergencyMeetingsUsed.get(playerKey) ?? 0;
    const remaining = MAX_EMERGENCY_MEETINGS_PER_PLAYER - meetingsUsed;

    if (remaining <= 0) {
      return { canCall: false, reason: "No emergency meetings remaining", remaining: 0 };
    }

    return { canCall: true, remaining };
  }

  /**
   * Use an emergency meeting
   */
  useEmergencyMeeting(gameId: string, playerAddress: string): number {
    const internal = this.internalState.get(gameId);
    if (!internal) return 0;

    const playerKey = playerAddress.toLowerCase();
    const meetingsUsed = (internal.emergencyMeetingsUsed.get(playerKey) ?? 0) + 1;
    internal.emergencyMeetingsUsed.set(playerKey, meetingsUsed);

    const remaining = MAX_EMERGENCY_MEETINGS_PER_PLAYER - meetingsUsed;
    logger.info(`Emergency meeting called by ${playerAddress}, ${remaining} meetings remaining`);
    return remaining;
  }

  /**
   * Get remaining emergency meetings for a player
   */
  getRemainingMeetings(gameId: string, playerAddress: string): number {
    const internal = this.internalState.get(gameId);
    if (!internal) return 0;

    const meetingsUsed = internal.emergencyMeetingsUsed.get(playerAddress.toLowerCase()) ?? 0;
    return MAX_EMERGENCY_MEETINGS_PER_PLAYER - meetingsUsed;
  }

  // ============ SABOTAGE SYSTEM ============

  /**
   * Check if sabotage can be started
   */
  canSabotage(gameId: string, sabotagerAddress: string): { canSabotage: boolean; reason?: string; cooldownRemaining?: number } {
    const internal = this.internalState.get(gameId);
    if (!internal) {
      return { canSabotage: false, reason: "Game not found" };
    }

    // Must be an impostor
    if (!internal.impostors.has(sabotagerAddress.toLowerCase())) {
      return { canSabotage: false, reason: "Only impostors can sabotage" };
    }

    // No active sabotage
    if (internal.activeSabotage) {
      return { canSabotage: false, reason: "A sabotage is already in progress" };
    }

    // Check cooldown
    const now = Date.now();
    const timeSinceLastSabotage = now - internal.lastSabotageTime;
    if (timeSinceLastSabotage < SABOTAGE_COOLDOWN_MS) {
      const cooldownRemaining = Math.ceil((SABOTAGE_COOLDOWN_MS - timeSinceLastSabotage) / 1000);
      return { canSabotage: false, reason: `Sabotage on cooldown`, cooldownRemaining };
    }

    return { canSabotage: true };
  }

  /**
   * Start a sabotage
   */
  startSabotage(gameId: string, sabotagerAddress: string, sabotageType: number): SabotageState | null {
    const internal = this.internalState.get(gameId);
    const game = this.games.get(gameId);
    if (!internal || !game) return null;

    const config = SABOTAGE_CONFIG[sabotageType];
    if (!config) return null;

    const now = Date.now();
    const endTime = config.isCritical ? now + (config.timeLimit * 1000) : 0;

    const sabotage: SabotageState = {
      type: sabotageType,
      startTime: now,
      endTime,
      fixProgress: new Map(),
      sabotager: sabotagerAddress.toLowerCase(),
    };

    internal.activeSabotage = sabotage;
    internal.lastSabotageTime = now;
    game.activeSabotage = sabotageType;

    logger.info(`Sabotage started in game ${gameId}: type ${sabotageType} by ${sabotagerAddress}`);
    return sabotage;
  }

  /**
   * Get sabotage configuration
   */
  getSabotageConfig(sabotageType: number): SabotageConfig | null {
    return SABOTAGE_CONFIG[sabotageType] ?? null;
  }

  /**
   * Get active sabotage
   */
  getActiveSabotage(gameId: string): SabotageState | null {
    return this.internalState.get(gameId)?.activeSabotage ?? null;
  }

  /**
   * Attempt to fix sabotage at a location
   * Returns true if sabotage is now fully fixed
   */
  fixSabotage(gameId: string, playerAddress: string, location: number): { fixed: boolean; partialFix: boolean; reason?: string } {
    const internal = this.internalState.get(gameId);
    const game = this.games.get(gameId);
    if (!internal || !game) {
      return { fixed: false, partialFix: false, reason: "Game not found" };
    }

    const sabotage = internal.activeSabotage;
    if (!sabotage) {
      return { fixed: false, partialFix: false, reason: "No active sabotage" };
    }

    const config = SABOTAGE_CONFIG[sabotage.type];
    if (!config) {
      return { fixed: false, partialFix: false, reason: "Invalid sabotage type" };
    }

    // Check if this is a valid fix location
    if (!config.fixLocations.includes(location)) {
      return { fixed: false, partialFix: false, reason: "Cannot fix sabotage at this location" };
    }

    const playerKey = playerAddress.toLowerCase();

    // Record this player's fix attempt at this location
    if (!sabotage.fixProgress.has(location)) {
      sabotage.fixProgress.set(location, []);
    }
    const fixersAtLocation = sabotage.fixProgress.get(location)!;
    if (!fixersAtLocation.includes(playerKey)) {
      fixersAtLocation.push(playerKey);
    }

    // Check if sabotage is fixed
    let isFixed = false;

    if (config.requiresMultipleFixes) {
      // Reactor: need players at multiple fix points OR multiple players at same point
      // For simplicity: need 2 different players to fix (at same location)
      const totalFixers = new Set<string>();
      for (const fixers of sabotage.fixProgress.values()) {
        for (const fixer of fixers) {
          totalFixers.add(fixer);
        }
      }
      isFixed = totalFixers.size >= 2;
    } else {
      // Single fix needed at any valid location
      isFixed = sabotage.fixProgress.size > 0;
    }

    if (isFixed) {
      internal.activeSabotage = null;
      game.activeSabotage = 0; // None
      logger.info(`Sabotage fixed in game ${gameId}: type ${sabotage.type} by ${playerAddress}`);
      return { fixed: true, partialFix: false };
    }

    return { fixed: false, partialFix: true };
  }

  /**
   * Check if critical sabotage has timed out
   */
  checkSabotageTimeout(gameId: string): boolean {
    const internal = this.internalState.get(gameId);
    if (!internal?.activeSabotage) return false;

    const sabotage = internal.activeSabotage;
    const config = SABOTAGE_CONFIG[sabotage.type];

    if (config?.isCritical && sabotage.endTime > 0 && Date.now() >= sabotage.endTime) {
      return true; // Sabotage timed out - impostors win
    }

    return false;
  }

  /**
   * Clear sabotage (e.g., when meeting is called)
   */
  clearSabotage(gameId: string): void {
    const internal = this.internalState.get(gameId);
    const game = this.games.get(gameId);
    if (internal) {
      internal.activeSabotage = null;
    }
    if (game) {
      game.activeSabotage = 0;
    }
  }

  // ============ VENT SYSTEM ============

  /**
   * Check if player can enter a vent at their current location
   */
  canEnterVent(gameId: string, playerAddress: string, location: Location): { canEnter: boolean; reason?: string } {
    const internal = this.internalState.get(gameId);
    if (!internal) {
      return { canEnter: false, reason: "Game not found" };
    }

    const playerKey = playerAddress.toLowerCase();

    // Must be an impostor
    if (!internal.impostors.has(playerKey)) {
      return { canEnter: false, reason: "Only impostors can use vents" };
    }

    // Must not already be in a vent
    if (internal.playersInVent.has(playerKey)) {
      return { canEnter: false, reason: "Already in a vent" };
    }

    // Check if location has a vent
    const ventConnections = VENT_CONNECTIONS.get(location);
    if (!ventConnections || ventConnections.length === 0) {
      return { canEnter: false, reason: "No vent at this location" };
    }

    return { canEnter: true };
  }

  /**
   * Enter a vent
   */
  enterVent(gameId: string, playerAddress: string): boolean {
    const internal = this.internalState.get(gameId);
    if (!internal) return false;

    internal.playersInVent.add(playerAddress.toLowerCase());
    logger.info(`Player ${playerAddress} entered vent in game ${gameId}`);
    return true;
  }

  /**
   * Exit a vent
   */
  exitVent(gameId: string, playerAddress: string): boolean {
    const internal = this.internalState.get(gameId);
    if (!internal) return false;

    const playerKey = playerAddress.toLowerCase();
    if (!internal.playersInVent.has(playerKey)) {
      return false;
    }

    internal.playersInVent.delete(playerKey);
    logger.info(`Player ${playerAddress} exited vent in game ${gameId}`);
    return true;
  }

  /**
   * Check if player is in a vent
   */
  isInVent(gameId: string, playerAddress: string): boolean {
    const internal = this.internalState.get(gameId);
    if (!internal) return false;
    return internal.playersInVent.has(playerAddress.toLowerCase());
  }

  /**
   * Force all players out of vents (e.g., when meeting starts)
   */
  clearAllVents(gameId: string): string[] {
    const internal = this.internalState.get(gameId);
    if (!internal) return [];

    const playersInVent = Array.from(internal.playersInVent);
    internal.playersInVent.clear();
    return playersInVent;
  }

  // ============ CAMERA SYSTEM ============

  /**
   * Get camera-monitored locations
   */
  getCameraLocations(): number[] {
    return CAMERA_LOCATIONS;
  }

  /**
   * Start watching cameras
   */
  startWatchingCameras(gameId: string, playerAddress: string): boolean {
    const internal = this.internalState.get(gameId);
    if (!internal) return false;

    internal.playersOnCameras.add(playerAddress.toLowerCase());
    logger.info(`Player ${playerAddress} started watching cameras in game ${gameId}`);
    return true;
  }

  /**
   * Stop watching cameras
   */
  stopWatchingCameras(gameId: string, playerAddress: string): boolean {
    const internal = this.internalState.get(gameId);
    if (!internal) return false;

    internal.playersOnCameras.delete(playerAddress.toLowerCase());
    logger.info(`Player ${playerAddress} stopped watching cameras in game ${gameId}`);
    return true;
  }

  /**
   * Check if player is watching cameras
   */
  isWatchingCameras(gameId: string, playerAddress: string): boolean {
    const internal = this.internalState.get(gameId);
    if (!internal) return false;
    return internal.playersOnCameras.has(playerAddress.toLowerCase());
  }

  /**
   * Get count of players watching cameras
   */
  getCameraWatcherCount(gameId: string): number {
    const internal = this.internalState.get(gameId);
    if (!internal) return 0;
    return internal.playersOnCameras.size;
  }

  /**
   * Check if cameras are being watched (for red light indicator)
   */
  areCamerasInUse(gameId: string): boolean {
    return this.getCameraWatcherCount(gameId) > 0;
  }

  /**
   * Get players visible on cameras
   */
  getPlayersOnCameras(gameId: string): Array<{ address: string; location: number; isAlive: boolean }> {
    const game = this.games.get(gameId);
    const internal = this.internalState.get(gameId);
    if (!game || !internal) return [];

    const visiblePlayers: Array<{ address: string; location: number; isAlive: boolean }> = [];

    for (const player of game.players) {
      // Skip players in vents (they're hidden)
      if (internal.playersInVent.has(player.address.toLowerCase())) {
        continue;
      }

      // Check if player is in a camera-monitored location
      if (CAMERA_LOCATIONS.includes(player.location)) {
        visiblePlayers.push({
          address: player.address,
          location: player.location,
          isAlive: player.isAlive,
        });
      }
    }

    return visiblePlayers;
  }

  /**
   * Clear all camera watchers (e.g., when meeting starts)
   */
  clearAllCameraWatchers(gameId: string): void {
    const internal = this.internalState.get(gameId);
    if (internal) {
      internal.playersOnCameras.clear();
    }
  }

  // ============ VOTING SYSTEM ============

  /**
   * Initialize voting for a new round
   */
  initVoting(gameId: string): void {
    const internal = this.internalState.get(gameId);
    if (!internal) return;

    internal.votes.clear();

    const game = this.games.get(gameId);
    if (game) {
      for (const player of game.players) {
        player.hasVoted = false;
      }
    }

    logger.info(`Initialized voting for game ${gameId}`);
  }

  /**
   * Cast a vote
   */
  castVote(gameId: string, voter: string, target: string | null): boolean {
    const game = this.games.get(gameId);
    const internal = this.internalState.get(gameId);
    if (!game || !internal) return false;

    const voterPlayer = game.players.find(
      p => p.address.toLowerCase() === voter.toLowerCase()
    );
    if (!voterPlayer || !voterPlayer.isAlive) return false;

    internal.votes.set(voter.toLowerCase(), target ? target.toLowerCase() : null);
    voterPlayer.hasVoted = true;

    logger.debug(`Vote cast in game ${gameId}: ${voter} -> ${target || "skip"}`);
    return true;
  }

  /**
   * Check if all alive players have voted
   */
  allVotesCast(gameId: string): boolean {
    const game = this.games.get(gameId);
    const internal = this.internalState.get(gameId);
    if (!game || !internal) return false;

    const alivePlayers = game.players.filter(p => p.isAlive);
    return alivePlayers.every(p => internal.votes.has(p.address.toLowerCase()));
  }

  /**
   * Tally votes and return ejected player (or null if tie/skip)
   */
  tallyVotes(gameId: string): string | null {
    const internal = this.internalState.get(gameId);
    if (!internal) return null;

    const voteCounts = new Map<string, number>();
    let skipCount = 0;

    for (const target of internal.votes.values()) {
      if (target === null) {
        skipCount++;
      } else {
        voteCounts.set(target, (voteCounts.get(target) || 0) + 1);
      }
    }

    // Find max votes
    let maxVotes = skipCount;
    let ejected: string | null = null;
    let isTie = false;

    for (const [target, count] of voteCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        ejected = target;
        isTie = false;
      } else if (count === maxVotes) {
        isTie = true;
      }
    }

    if (isTie) {
      logger.info(`Voting tie in game ${gameId}, no ejection`);
      return null;
    }

    if (ejected) {
      logger.info(`Voting result in game ${gameId}: ${ejected} ejected with ${maxVotes} votes`);
    } else {
      logger.info(`Voting result in game ${gameId}: skip with ${maxVotes} votes`);
    }

    return ejected;
  }

  // ============ WIN CONDITIONS ============

  /**
   * Check win condition
   */
  checkWinCondition(gameId: string): WinConditionResult {
    const game = this.games.get(gameId);
    const internal = this.internalState.get(gameId);
    if (!game || !internal) return { winner: null };

    const aliveImpostors = this.getAliveImpostorCount(gameId);
    const aliveCrewmates = this.getAliveCrewmateCount(gameId);

    // Impostors win if they equal or outnumber crewmates
    if (aliveImpostors >= aliveCrewmates && aliveCrewmates > 0) {
      return { winner: "impostors", reason: "kills" };
    }

    // Crewmates win if all impostors are ejected
    if (aliveImpostors === 0) {
      return { winner: "crewmates", reason: "votes" };
    }

    // Crewmates win if all tasks are done
    if (game.totalTasksRequired > 0 && game.totalTasksCompleted >= game.totalTasksRequired) {
      return { winner: "crewmates", reason: "tasks" };
    }

    return { winner: null };
  }

  // ============ BODY DETECTION ============

  /**
   * Get unreported bodies in a specific location
   */
  getUnreportedBodiesInRoom(gameId: string, location: Location): DeadBodyState[] {
    const game = this.games.get(gameId);
    if (!game) return [];

    return game.deadBodies.filter(
      body => body.location === location && !body.reported
    );
  }

  /**
   * Mark a body as reported
   */
  reportBody(gameId: string, victim: string): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;

    const body = game.deadBodies.find(
      b => b.victim.toLowerCase() === victim.toLowerCase() && !b.reported
    );
    if (!body) return false;

    body.reported = true;
    logger.info(`Body reported in game ${gameId}: ${victim}`);
    return true;
  }

  // ============ TASK VALIDATION ============

  /**
   * Assign task locations to a player
   */
  assignTasks(gameId: string, player: string, taskLocations: number[]): void {
    const internal = this.internalState.get(gameId);
    if (!internal) return;

    internal.taskLocations.set(player.toLowerCase(), [...taskLocations]);
    logger.debug(`Assigned tasks to ${player}: ${taskLocations.join(", ")}`);
  }

  /**
   * Get a player's assigned task locations
   */
  getTaskLocations(gameId: string, player: string): number[] {
    const internal = this.internalState.get(gameId);
    if (!internal) return [];
    return internal.taskLocations.get(player.toLowerCase()) || [];
  }

  /**
   * Check if player can complete a task at location
   */
  canCompleteTask(gameId: string, player: string, location: Location): boolean {
    const internal = this.internalState.get(gameId);
    if (!internal) return false;

    const tasks = internal.taskLocations.get(player.toLowerCase());
    if (!tasks) return false;

    return tasks.includes(location);
  }

  /**
   * Complete a task and remove it from the player's list
   */
  completeTask(gameId: string, player: string, location: Location): boolean {
    const internal = this.internalState.get(gameId);
    if (!internal) return false;

    const tasks = internal.taskLocations.get(player.toLowerCase());
    if (!tasks) return false;

    const index = tasks.indexOf(location);
    if (index === -1) return false;

    tasks.splice(index, 1);
    return true;
  }

  /**
   * Delete a game and its internal state
   */
  deleteGame(gameId: string): boolean {
    this.internalState.delete(gameId);
    const deleted = this.games.delete(gameId);
    if (deleted) {
      logger.info(`Game ${gameId} deleted`);
    }
    return deleted;
  }
}
