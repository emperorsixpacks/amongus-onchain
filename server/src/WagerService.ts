import { createLogger } from "./logger.js";

const logger = createLogger("wager-service");

// Default wager amount in wei (0.1 MON = 100000000000000000)
const DEFAULT_WAGER_AMOUNT = BigInt("100000000000000000"); // 0.1 MON

interface AgentBalance {
  address: string;
  balance: bigint;
  totalDeposited: bigint;
  totalWon: bigint;
  totalLost: bigint;
}

interface GameWager {
  gameId: string;
  wagers: Map<string, bigint>; // address -> wager amount
  totalPot: bigint;
  settled: boolean;
}

/**
 * Service for managing agent wagers
 * Tracks deposits, wagers, and winnings
 */
export class WagerService {
  private balances: Map<string, AgentBalance> = new Map();
  private gameWagers: Map<string, GameWager> = new Map();
  private wagerAmount: bigint;

  constructor(wagerAmount: bigint = DEFAULT_WAGER_AMOUNT) {
    this.wagerAmount = wagerAmount;
    logger.info(`Wager service initialized with wager amount: ${this.formatMON(wagerAmount)} MON`);
  }

  /**
   * Format wei to MON for display
   */
  private formatMON(wei: bigint): string {
    const mon = Number(wei) / 1e18;
    return mon.toFixed(4);
  }

  /**
   * Get the required wager amount
   */
  getWagerAmount(): bigint {
    return this.wagerAmount;
  }

  /**
   * Get or create agent balance record
   */
  private getOrCreateBalance(address: string): AgentBalance {
    const key = address.toLowerCase();
    let balance = this.balances.get(key);
    if (!balance) {
      balance = {
        address: key,
        balance: BigInt(0),
        totalDeposited: BigInt(0),
        totalWon: BigInt(0),
        totalLost: BigInt(0),
      };
      this.balances.set(key, balance);
    }
    return balance;
  }

  /**
   * Deposit funds to an agent's balance
   * In production, this would be triggered by on-chain deposit events
   */
  deposit(address: string, amount: bigint): boolean {
    const balance = this.getOrCreateBalance(address);
    balance.balance += amount;
    balance.totalDeposited += amount;
    logger.info(`Deposit: ${address.slice(0, 10)}... deposited ${this.formatMON(amount)} MON (new balance: ${this.formatMON(balance.balance)} MON)`);
    return true;
  }

  /**
   * Get agent's current balance
   */
  getBalance(address: string): bigint {
    const balance = this.balances.get(address.toLowerCase());
    return balance?.balance ?? BigInt(0);
  }

  /**
   * Get full balance info for an agent
   */
  getBalanceInfo(address: string): AgentBalance | null {
    return this.balances.get(address.toLowerCase()) ?? null;
  }

  /**
   * Check if agent can afford the wager
   */
  canAffordWager(address: string): boolean {
    return this.getBalance(address) >= this.wagerAmount;
  }

  /**
   * Submit wager to join a game
   * Debits the wager amount from agent's balance
   */
  submitWager(gameId: string, address: string): { success: boolean; error?: string } {
    const key = address.toLowerCase();
    const balance = this.getOrCreateBalance(key);

    // Check balance
    if (balance.balance < this.wagerAmount) {
      return {
        success: false,
        error: `Insufficient balance. Need ${this.formatMON(this.wagerAmount)} MON, have ${this.formatMON(balance.balance)} MON`,
      };
    }

    // Get or create game wager record
    let gameWager = this.gameWagers.get(gameId);
    if (!gameWager) {
      gameWager = {
        gameId,
        wagers: new Map(),
        totalPot: BigInt(0),
        settled: false,
      };
      this.gameWagers.set(gameId, gameWager);
    }

    // Check if already wagered
    if (gameWager.wagers.has(key)) {
      return {
        success: false,
        error: "Already wagered for this game",
      };
    }

    // Debit balance
    balance.balance -= this.wagerAmount;

    // Record wager
    gameWager.wagers.set(key, this.wagerAmount);
    gameWager.totalPot += this.wagerAmount;

    logger.info(`Wager submitted: ${address.slice(0, 10)}... wagered ${this.formatMON(this.wagerAmount)} MON for game ${gameId} (pot: ${this.formatMON(gameWager.totalPot)} MON)`);

    return { success: true };
  }

  /**
   * Check if agent has wagered for a game
   */
  hasWagered(gameId: string, address: string): boolean {
    const gameWager = this.gameWagers.get(gameId);
    return gameWager?.wagers.has(address.toLowerCase()) ?? false;
  }

  /**
   * Sync an on-chain wager to in-memory tracker
   * Used when a wager is placed directly on-chain
   */
  syncOnChainWager(gameId: string, address: string): void {
    const normalizedAddress = address.toLowerCase();

    let gameWager = this.gameWagers.get(gameId);
    if (!gameWager) {
      gameWager = {
        gameId,
        wagers: new Map(),
        totalPot: BigInt(0),
        settled: false,
      };
      this.gameWagers.set(gameId, gameWager);
    }

    if (!gameWager.wagers.has(normalizedAddress)) {
      gameWager.wagers.set(normalizedAddress, this.wagerAmount);
      gameWager.totalPot += this.wagerAmount;
      logger.info(`Synced on-chain wager for ${address} in game ${gameId}`);
    }
  }

  /**
   * Get wager info for a game
   */
  getGameWager(gameId: string): GameWager | null {
    return this.gameWagers.get(gameId) ?? null;
  }

  /**
   * Get total pot for a game
   */
  getGamePot(gameId: string): bigint {
    return this.gameWagers.get(gameId)?.totalPot ?? BigInt(0);
  }

  /**
   * Distribute winnings when game ends
   * Winners split the pot equally
   */
  distributeWinnings(
    gameId: string,
    winners: string[],
    losers: string[]
  ): { success: boolean; winningsPerPlayer: bigint; error?: string } {
    const gameWager = this.gameWagers.get(gameId);

    if (!gameWager) {
      return { success: false, winningsPerPlayer: BigInt(0), error: "No wagers found for game" };
    }

    if (gameWager.settled) {
      return { success: false, winningsPerPlayer: BigInt(0), error: "Game already settled" };
    }

    if (winners.length === 0) {
      // No winners - refund everyone
      for (const [address, amount] of gameWager.wagers) {
        const balance = this.getOrCreateBalance(address);
        balance.balance += amount;
      }
      gameWager.settled = true;
      logger.info(`Game ${gameId} refunded - no winners`);
      return { success: true, winningsPerPlayer: BigInt(0) };
    }

    // Calculate winnings per winner
    const winningsPerPlayer = gameWager.totalPot / BigInt(winners.length);
    const remainder = gameWager.totalPot % BigInt(winners.length);

    // Credit winners
    for (let i = 0; i < winners.length; i++) {
      const address = winners[i].toLowerCase();
      const balance = this.getOrCreateBalance(address);
      // First winner gets any remainder
      const winnings = i === 0 ? winningsPerPlayer + remainder : winningsPerPlayer;
      balance.balance += winnings;
      balance.totalWon += winnings;
      logger.info(`Winner: ${address.slice(0, 10)}... received ${this.formatMON(winnings)} MON`);
    }

    // Record losses
    for (const address of losers) {
      const balance = this.getOrCreateBalance(address.toLowerCase());
      const wagerAmount = gameWager.wagers.get(address.toLowerCase()) ?? BigInt(0);
      balance.totalLost += wagerAmount;
    }

    gameWager.settled = true;

    logger.info(`Game ${gameId} settled: ${winners.length} winners split ${this.formatMON(gameWager.totalPot)} MON pot (${this.formatMON(winningsPerPlayer)} MON each)`);

    return { success: true, winningsPerPlayer };
  }

  /**
   * Refund all wagers for a game (e.g., if game is cancelled)
   */
  refundGame(gameId: string): boolean {
    const gameWager = this.gameWagers.get(gameId);
    if (!gameWager || gameWager.settled) {
      return false;
    }

    for (const [address, amount] of gameWager.wagers) {
      const balance = this.getOrCreateBalance(address);
      balance.balance += amount;
    }

    gameWager.settled = true;
    logger.info(`Game ${gameId} refunded: ${gameWager.wagers.size} players refunded`);
    return true;
  }

  /**
   * Clean up old settled games
   */
  cleanupSettledGames(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [gameId, wager] of this.gameWagers) {
      if (wager.settled) {
        this.gameWagers.delete(gameId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} settled games`);
    }
  }

  /**
   * Get leaderboard by total winnings
   */
  getWinningsLeaderboard(limit: number = 10): AgentBalance[] {
    return Array.from(this.balances.values())
      .sort((a, b) => Number(b.totalWon - a.totalWon))
      .slice(0, limit);
  }
}

// Singleton instance
export const wagerService = new WagerService();
