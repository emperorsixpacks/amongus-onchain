import type {
  GameStateSnapshot,
  PlayerState,
  DeadBodyState,
  GamePhase,
  Location,
  SabotageType,
} from "./types.js";
import { createLogger } from "./logger.js";

const logger = createLogger("game-state-manager");

export class GameStateManager {
  // gameId -> GameStateSnapshot
  private games: Map<string, GameStateSnapshot> = new Map();

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
   * Delete a game
   */
  deleteGame(gameId: string): boolean {
    const deleted = this.games.delete(gameId);
    if (deleted) {
      logger.info(`Game ${gameId} deleted`);
    }
    return deleted;
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
}
