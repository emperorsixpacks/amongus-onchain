import { createLogger } from "./logger.js";
import { contractService } from "./ContractService.js";
import { databaseService } from "./DatabaseService.js";

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
 * Balances are queried from on-chain, wagers tracked in-memory for active games
 */
export class WagerService {
  // Removed: private balances - balances now come from on-chain
  private gameWagers: Map<string, GameWager> = new Map();
  private wagerAmount: bigint;

  constructor(wagerAmount: bigint = DEFAULT_WAGER_AMOUNT) {
    this.wagerAmount = wagerAmount;
    logger.info(
      `Wager service initialized with wager amount: ${this.formatMON(wagerAmount)} MON`,
    );
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
   * Deposit funds to an agent's balance
   * This syncs the database after an on-chain deposit event
   */
  async deposit(address: string, amount: bigint): Promise<boolean> {
    // Perform on-chain deposit first
    const txHash = await contractService.deposit(address, amount);

    if (!txHash) {
      logger.error(`Failed to perform on-chain deposit for ${address}`);
      return false;
    }

    // Update database balance tracking
    databaseService.updateAgentBalance(address, amount, "deposit");

    logger.info(
      `Deposit: ${address.slice(0, 10)}... deposited ${this.formatMON(amount)} MON (TX: ${txHash})`,
    );
    return true;
  }

  /**
   * Get agent's current balance from on-chain (wager balance)
   * This is the source of truth for balances
   */
  async getBalance(address: string): Promise<bigint> {
    // Query on-chain balance (source of truth)
    const onChainBalance = await contractService.getBalance(address);
    return onChainBalance;
  }

  /**
   * Get agent's actual wallet balance (native MON)
   */
  async getWalletBalance(address: string): Promise<bigint> {
    return await contractService.getWalletBalance(address);
  }

  /**
   * Get full balance info for an agent from database
   * Includes totalDeposited, totalWon, totalLost
   */
  async getBalanceInfo(address: string): Promise<AgentBalance | null> {
    // Get from database which tracks historical data
    const agent = await databaseService.getAgentByWallet(address);
    if (!agent) return null;

    return {
      address: agent.walletAddress,
      balance: BigInt(agent.balance),
      totalDeposited: BigInt(agent.totalDeposited),
      totalWon: BigInt(agent.totalWon),
      totalLost: BigInt(agent.totalLost),
    };
  }

  /**
   * Check if agent can afford the wager
   */
  async canAffordWager(address: string): Promise<boolean> {
    const balance = await this.getBalance(address);
    return balance >= this.wagerAmount;
  }

  /**
   * Submit wager to join a game
   * NOTE: Wagers should be placed on-chain first, then synced here
   * This method is deprecated in favor of on-chain wager placement
   */
  async submitWager(
    gameId: string,
    address: string,
    customWagerAmount?: bigint,
  ): Promise<{ success: boolean; error?: string }> {
    const key = address.toLowerCase();
    const wagerToUse = customWagerAmount || this.wagerAmount;

    // Check on-chain balance
    const balance = await this.getBalance(key);
    if (balance < wagerToUse) {
      return {
        success: false,
        error: `Insufficient balance. Need ${this.formatMON(wagerToUse)} MON, have ${this.formatMON(balance)} MON`,
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

    // Record wager (actual debit happens on-chain)
    // Perform on-chain wager first
    const txHash = await contractService.placeWager(address, gameId);

    if (!txHash) {
      return {
        success: false,
        error: "Failed to place on-chain wager",
      };
    }

    gameWager.wagers.set(key, wagerToUse);
    gameWager.totalPot += wagerToUse;

    // Update database
    databaseService.updateAgentBalance(address, -wagerToUse, "wager");

    logger.info(
      `Wager submitted: ${address.slice(0, 10)}... wagered ${this.formatMON(wagerToUse)} MON for game ${gameId} (TX: ${txHash}, pot: ${this.formatMON(gameWager.totalPot)} MON)`,
    );

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
  syncOnChainWager(
    gameId: string,
    address: string,
    customWagerAmount?: bigint,
  ): void {
    const normalizedAddress = address.toLowerCase();
    const wagerToUse = customWagerAmount || this.wagerAmount;

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
      gameWager.wagers.set(normalizedAddress, wagerToUse);
      gameWager.totalPot += wagerToUse;
      logger.info(
        `Synced on-chain wager for ${address} in game ${gameId} with amount ${this.formatMON(wagerToUse)} MON`,
      );
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
   * Updates database to track winnings and losses
   */
  distributeWinnings(
    gameId: string,
    winners: string[],
    losers: string[],
  ): { success: boolean; winningsPerPlayer: bigint; error?: string } {
    const gameWager = this.gameWagers.get(gameId);

    if (!gameWager) {
      return {
        success: false,
        winningsPerPlayer: BigInt(0),
        error: "No wagers found for game",
      };
    }

    if (gameWager.settled) {
      return {
        success: false,
        winningsPerPlayer: BigInt(0),
        error: "Game already settled",
      };
    }

    if (winners.length === 0) {
      // No winners - refund everyone
      for (const [address, amount] of gameWager.wagers) {
        databaseService.updateAgentBalance(address, amount, "refund");
      }
      gameWager.settled = true;
      logger.info(`Game ${gameId} refunded - no winners`);
      return { success: true, winningsPerPlayer: BigInt(0) };
    }

    // Calculate winnings per winner
    const winningsPerPlayer = gameWager.totalPot / BigInt(winners.length);
    const remainder = gameWager.totalPot % BigInt(winners.length);

    // Credit winners in database
    for (let i = 0; i < winners.length; i++) {
      const address = winners[i].toLowerCase();
      // First winner gets any remainder
      const winnings =
        i === 0 ? winningsPerPlayer + remainder : winningsPerPlayer;

      // Update database (on-chain settlement happens separately)
      databaseService.updateAgentBalance(address, winnings, "winnings");

      logger.info(
        `Winner: ${address.slice(0, 10)}... received ${this.formatMON(winnings)} MON`,
      );
    }

    // Record losses in database
    for (const address of losers) {
      const wagerAmount =
        gameWager.wagers.get(address.toLowerCase()) ?? BigInt(0);
      // Loss is already recorded when wager was placed, no need to update again
    }

    gameWager.settled = true;

    logger.info(
      `Game ${gameId} settled: ${winners.length} winners split ${this.formatMON(gameWager.totalPot)} MON pot (${this.formatMON(winningsPerPlayer)} MON each)`,
    );

    return { success: true, winningsPerPlayer };
  }

  /**
   * Refund all wagers for a game (e.g., if game is cancelled)
   * Updates database to refund balances
   */
  refundGame(gameId: string): boolean {
    const gameWager = this.gameWagers.get(gameId);
    if (!gameWager || gameWager.settled) {
      return false;
    }

    // Refund all players in database
    for (const [address, amount] of gameWager.wagers) {
      databaseService.updateAgentBalance(address, amount, "refund");
    }

    gameWager.settled = true;
    logger.info(
      `Game ${gameId} refunded: ${gameWager.wagers.size} players refunded`,
    );
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
   * Get leaderboard by total winnings from database
   */
  async getWinningsLeaderboard(limit: number = 10): Promise<AgentBalance[]> {
    const agents = await databaseService.getLeaderboard(limit);
    return (agents as any[]).map((agent: any) => ({
      address: agent.walletAddress,
      balance: BigInt(0),
      totalDeposited: BigInt(0),
      totalWon: BigInt(0),
      totalLost: BigInt(0),
    }));
  }
}

// Singleton instance
export const wagerService = new WagerService();
