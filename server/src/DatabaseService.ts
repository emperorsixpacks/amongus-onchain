import { PrismaClient, GameStatus, TransactionType } from "@prisma/client";
import { createLogger } from "./logger.js";

const logger = createLogger("database-service");

type WriteOperation = () => Promise<void>;

/**
 * DatabaseService handles all database operations with background writes
 * to prevent blocking agent calls and game logic.
 */
export class DatabaseService {
  private prisma: PrismaClient;
  private writeQueue: WriteOperation[] = [];
  private isProcessing = false;
  private enabled = false;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      logger.warn("DATABASE_URL not set - running without persistence");
      this.prisma = null as unknown as PrismaClient;
      return;
    }

    try {
      this.prisma = new PrismaClient();
      this.enabled = true;
      logger.info("Database service initialized");
    } catch (error) {
      logger.error("Failed to initialize database:", error);
      this.prisma = null as unknown as PrismaClient;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Connect to the database
   */
  async connect(): Promise<void> {
    if (!this.enabled) return;

    try {
      await this.prisma.$connect();
      logger.info("Connected to database");
    } catch (error) {
      logger.error("Failed to connect to database:", error);
      this.enabled = false;
    }
  }

  /**
   * Disconnect from the database
   */
  async disconnect(): Promise<void> {
    if (!this.enabled) return;

    // Process remaining writes before disconnecting
    await this.flushQueue();
    await this.prisma.$disconnect();
    logger.info("Disconnected from database");
  }

  /**
   * Queue a write operation to be processed in the background
   */
  private queueWrite(operation: WriteOperation): void {
    if (!this.enabled) return;

    this.writeQueue.push(operation);
    this.processQueue();
  }

  /**
   * Process the write queue in the background
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.writeQueue.length === 0) return;

    this.isProcessing = true;

    while (this.writeQueue.length > 0) {
      const operation = this.writeQueue.shift();
      if (operation) {
        try {
          await operation();
        } catch (error) {
          logger.error("Background write failed:", error);
        }
      }
    }

    this.isProcessing = false;
  }

  /**
   * Flush all pending writes (blocking)
   */
  async flushQueue(): Promise<void> {
    while (this.writeQueue.length > 0 || this.isProcessing) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  // ============ Operator Operations ============

  /**
   * Create or update an operator
   */
  upsertOperator(data: {
    name: string;
    operatorKey: string;
    walletAddress: string;
  }): void {
    this.queueWrite(async () => {
      await this.prisma.operator.upsert({
        where: { operatorKey: data.operatorKey },
        update: { name: data.name, walletAddress: data.walletAddress },
        create: data,
      });
      logger.debug(`Upserted operator: ${data.name}`);
    });
  }

  /**
   * Get operator by key (synchronous read from cache or DB)
   */
  async getOperatorByKey(operatorKey: string) {
    if (!this.enabled) return null;

    try {
      return await this.prisma.operator.findUnique({
        where: { operatorKey },
        include: { agents: true },
      });
    } catch (error) {
      logger.error("Failed to get operator:", error);
      return null;
    }
  }

  /**
   * Get operator by wallet address
   */
  async getOperatorByWallet(walletAddress: string) {
    if (!this.enabled) return null;

    try {
      return await this.prisma.operator.findUnique({
        where: { walletAddress: walletAddress.toLowerCase() },
      });
    } catch (error) {
      logger.error("Failed to get operator by wallet:", error);
      return null;
    }
  }

  // ============ Agent Operations ============

  /**
   * Create or update an agent
   */
  upsertAgent(data: {
    walletAddress: string;
    name: string;
    operatorId: string;
  }): void {
    this.queueWrite(async () => {
      await this.prisma.agent.upsert({
        where: { walletAddress: data.walletAddress.toLowerCase() },
        update: { name: data.name },
        create: {
          walletAddress: data.walletAddress.toLowerCase(),
          name: data.name,
          operatorId: data.operatorId,
        },
      });
      logger.debug(`Upserted agent: ${data.name} (${data.walletAddress})`);
    });
  }

  /**
   * Get agent by wallet address
   */
  async getAgentByWallet(walletAddress: string) {
    if (!this.enabled) return null;

    try {
      return await this.prisma.agent.findUnique({
        where: { walletAddress: walletAddress.toLowerCase() },
        include: { operator: true },
      });
    } catch (error) {
      logger.error("Failed to get agent:", error);
      return null;
    }
  }

  /**
   * Update agent stats (background)
   */
  updateAgentStats(
    walletAddress: string,
    stats: {
      gamesPlayed?: number;
      wins?: number;
      losses?: number;
      kills?: number;
      tasksCompleted?: number;
    }
  ): void {
    this.queueWrite(async () => {
      await this.prisma.agent.update({
        where: { walletAddress: walletAddress.toLowerCase() },
        data: {
          gamesPlayed: stats.gamesPlayed !== undefined ? { increment: stats.gamesPlayed } : undefined,
          wins: stats.wins !== undefined ? { increment: stats.wins } : undefined,
          losses: stats.losses !== undefined ? { increment: stats.losses } : undefined,
          kills: stats.kills !== undefined ? { increment: stats.kills } : undefined,
          tasksCompleted: stats.tasksCompleted !== undefined ? { increment: stats.tasksCompleted } : undefined,
        },
      });
      logger.debug(`Updated stats for agent: ${walletAddress}`);
    });
  }

  /**
   * Update agent balance (background)
   */
  updateAgentBalance(
    walletAddress: string,
    balanceChange: bigint,
    type: "deposit" | "wager" | "winnings" | "refund"
  ): void {
    this.queueWrite(async () => {
      const agent = await this.prisma.agent.findUnique({
        where: { walletAddress: walletAddress.toLowerCase() },
      });

      if (!agent) {
        logger.warn(`Agent not found for balance update: ${walletAddress}`);
        return;
      }

      const currentBalance = BigInt(agent.balance);
      const newBalance = currentBalance + balanceChange;

      const updateData: Record<string, string> = {
        balance: newBalance.toString(),
      };

      if (type === "deposit") {
        updateData.totalDeposited = (BigInt(agent.totalDeposited) + balanceChange).toString();
      } else if (type === "winnings") {
        updateData.totalWon = (BigInt(agent.totalWon) + balanceChange).toString();
      } else if (type === "wager") {
        updateData.totalLost = (BigInt(agent.totalLost) + (-balanceChange)).toString();
      }

      await this.prisma.agent.update({
        where: { walletAddress: walletAddress.toLowerCase() },
        data: updateData,
      });

      logger.debug(`Updated balance for ${walletAddress}: ${type} ${balanceChange.toString()}`);
    });
  }

  /**
   * Get leaderboard
   */
  async getLeaderboard(limit = 10) {
    if (!this.enabled) return [];

    try {
      return await this.prisma.agent.findMany({
        orderBy: { wins: "desc" },
        take: limit,
        select: {
          walletAddress: true,
          name: true,
          gamesPlayed: true,
          wins: true,
          losses: true,
          kills: true,
          tasksCompleted: true,
        },
      });
    } catch (error) {
      logger.error("Failed to get leaderboard:", error);
      return [];
    }
  }

  // ============ Game Operations ============

  /**
   * Create a new game
   */
  createGame(roomId: string): void {
    this.queueWrite(async () => {
      await this.prisma.game.create({
        data: {
          roomId,
          status: GameStatus.CREATED,
        },
      });
      logger.debug(`Created game: ${roomId}`);
    });
  }

  /**
   * Start a game
   */
  startGame(
    roomId: string,
    participants: Array<{
      walletAddress: string;
      isImpostor: boolean;
      colorId?: number;
      wagerAmount: bigint;
    }>
  ): void {
    this.queueWrite(async () => {
      const game = await this.prisma.game.findUnique({
        where: { roomId },
      });

      if (!game) {
        logger.warn(`Game not found for start: ${roomId}`);
        return;
      }

      // Create participants
      for (const p of participants) {
        const agent = await this.prisma.agent.findUnique({
          where: { walletAddress: p.walletAddress.toLowerCase() },
        });

        if (agent) {
          await this.prisma.gameParticipant.create({
            data: {
              gameId: game.id,
              agentId: agent.id,
              isImpostor: p.isImpostor,
              colorId: p.colorId,
              wagerAmount: p.wagerAmount.toString(),
            },
          });
        }
      }

      // Update game status
      const totalPot = participants.reduce((sum, p) => sum + p.wagerAmount, 0n);
      await this.prisma.game.update({
        where: { roomId },
        data: {
          status: GameStatus.ACTIVE,
          phase: "playing",
          startedAt: new Date(),
          totalPot: totalPot.toString(),
        },
      });

      logger.debug(`Started game: ${roomId} with ${participants.length} participants`);
    });
  }

  /**
   * End a game
   */
  endGame(
    roomId: string,
    result: {
      crewmatesWon: boolean;
      winReason: string;
      winners: string[];
      playerStats: Array<{
        walletAddress: string;
        kills: number;
        tasksCompleted: number;
        isAlive: boolean;
      }>;
      winningsPerPlayer: bigint;
      settlementTxHash?: string;
    }
  ): void {
    this.queueWrite(async () => {
      const game = await this.prisma.game.findUnique({
        where: { roomId },
        include: { participants: { include: { agent: true } } },
      });

      if (!game) {
        logger.warn(`Game not found for end: ${roomId}`);
        return;
      }

      // Update participants
      for (const p of game.participants) {
        const stats = result.playerStats.find(
          (s) => s.walletAddress.toLowerCase() === p.agent.walletAddress
        );
        const isWinner = result.winners
          .map((w) => w.toLowerCase())
          .includes(p.agent.walletAddress);

        await this.prisma.gameParticipant.update({
          where: { id: p.id },
          data: {
            kills: stats?.kills ?? 0,
            tasksCompleted: stats?.tasksCompleted ?? 0,
            isAlive: stats?.isAlive ?? false,
            isWinner,
            winnings: isWinner ? result.winningsPerPlayer.toString() : "0",
          },
        });

        // Update agent stats
        await this.prisma.agent.update({
          where: { id: p.agentId },
          data: {
            gamesPlayed: { increment: 1 },
            wins: isWinner ? { increment: 1 } : undefined,
            losses: !isWinner ? { increment: 1 } : undefined,
            kills: { increment: stats?.kills ?? 0 },
            tasksCompleted: { increment: stats?.tasksCompleted ?? 0 },
          },
        });
      }

      // Update game
      await this.prisma.game.update({
        where: { roomId },
        data: {
          status: GameStatus.SETTLED,
          phase: "ended",
          crewmatesWon: result.crewmatesWon,
          winReason: result.winReason,
          winningsPerPlayer: result.winningsPerPlayer.toString(),
          endedAt: new Date(),
          settlementTxHash: result.settlementTxHash,
        },
      });

      logger.debug(`Ended game: ${roomId} - ${result.crewmatesWon ? "Crewmates" : "Impostors"} won`);
    });
  }

  /**
   * Cancel a game
   */
  cancelGame(roomId: string): void {
    this.queueWrite(async () => {
      await this.prisma.game.update({
        where: { roomId },
        data: {
          status: GameStatus.CANCELLED,
          phase: "cancelled",
          endedAt: new Date(),
        },
      });
      logger.debug(`Cancelled game: ${roomId}`);
    });
  }

  /**
   * Get game by room ID
   */
  async getGameByRoomId(roomId: string) {
    if (!this.enabled) return null;

    try {
      return await this.prisma.game.findUnique({
        where: { roomId },
        include: {
          participants: {
            include: { agent: true },
          },
        },
      });
    } catch (error) {
      logger.error("Failed to get game:", error);
      return null;
    }
  }

  /**
   * Get recent games
   */
  async getRecentGames(limit = 10) {
    if (!this.enabled) return [];

    try {
      return await this.prisma.game.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          participants: {
            include: { agent: true },
          },
        },
      });
    } catch (error) {
      logger.error("Failed to get recent games:", error);
      return [];
    }
  }

  // ============ Transaction Operations ============

  /**
   * Log a transaction (background)
   */
  logTransaction(data: {
    type: TransactionType;
    walletAddress: string;
    amount: bigint;
    gameRoomId?: string;
    txHash?: string;
    blockNumber?: number;
    description?: string;
  }): void {
    this.queueWrite(async () => {
      await this.prisma.transaction.create({
        data: {
          type: data.type,
          walletAddress: data.walletAddress.toLowerCase(),
          amount: data.amount.toString(),
          gameRoomId: data.gameRoomId,
          txHash: data.txHash,
          blockNumber: data.blockNumber,
          description: data.description,
        },
      });
      logger.debug(`Logged transaction: ${data.type} for ${data.walletAddress}`);
    });
  }

  /**
   * Get transactions for a wallet
   */
  async getTransactions(walletAddress: string, limit = 50) {
    if (!this.enabled) return [];

    try {
      return await this.prisma.transaction.findMany({
        where: { walletAddress: walletAddress.toLowerCase() },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    } catch (error) {
      logger.error("Failed to get transactions:", error);
      return [];
    }
  }
}

// Singleton instance
export const databaseService = new DatabaseService();
