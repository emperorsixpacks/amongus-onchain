import { ethers } from "ethers";
import { createLogger } from "./logger.js";

const logger = createLogger("contract-service");

// Contract ABIs (minimal interfaces)
const WAGER_VAULT_ABI = [
  "function deposit(uint256 amount) external",
  "function withdraw(uint256 amount) external",
  "function placeWager(bytes32 gameId) external",
  "function getBalance(address agent) external view returns (uint256)",
  "function hasWagered(bytes32 gameId, address agent) external view returns (bool)",
  "function getGamePot(bytes32 gameId) external view returns (uint256)",
  "function getGamePlayers(bytes32 gameId) external view returns (address[])",
  "function wagerAmount() external view returns (uint256)",
  "function isGameSettled(bytes32 gameId) external view returns (bool)",
  "event Deposited(address indexed agent, uint256 amount, uint256 newBalance)",
  "event WagerPlaced(bytes32 indexed gameId, address indexed agent, uint256 amount)",
  "event GameSettled(bytes32 indexed gameId, address[] winners, uint256 winningsPerPlayer, uint256 protocolFee)",
];

const AGENT_REGISTRY_ABI = [
  "function registerAgent(address agent, string calldata name) external",
  "function isRegistered(address agent) external view returns (bool)",
  "function getAgentStats(address agent) external view returns (string memory name, uint64 gamesPlayed, uint64 wins, uint64 losses, uint64 kills, uint64 tasksCompleted)",
  "function getWinRate(address agent) external view returns (uint256)",
  "function getTotalAgents() external view returns (uint256)",
  "function getTopAgents(uint256 limit) external view returns (address[] memory addresses, uint64[] memory wins)",
  "event AgentRegistered(address indexed agent, string name)",
  "event GameRecorded(address indexed agent, bytes32 indexed gameId, bool won, bool wasImpostor)",
];

const GAME_SETTLEMENT_ABI = [
  "function createGame(bytes32 gameId, address[] calldata players, address[] calldata impostors) external",
  "function settleGame(bytes32 gameId, bool crewmatesWon, address[] calldata winners, uint64[] calldata playerKills, uint64[] calldata playerTasks) external",
  "function cancelGame(bytes32 gameId) external",
  "function getGameStatus(bytes32 gameId) external view returns (uint8)",
  "function getTotalGames() external view returns (uint256 created, uint256 settled)",
  "event GameCreated(bytes32 indexed gameId, uint256 playerCount, uint256 impostorCount)",
  "event GameSettled(bytes32 indexed gameId, bool crewmatesWon, uint256 winnerCount)",
  "event GameCancelled(bytes32 indexed gameId)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
];

interface ContractConfig {
  rpcUrl: string;
  wagerVaultAddress: string;
  agentRegistryAddress: string;
  gameSettlementAddress: string;
  monadTokenAddress: string;
  operatorPrivateKey: string;
}

/**
 * Service for interacting with Among Us On-Chain smart contracts on Monad
 */
export class ContractService {
  private provider!: ethers.JsonRpcProvider;
  private operatorWallet!: ethers.Wallet;
  private wagerVault!: ethers.Contract;
  private agentRegistry!: ethers.Contract;
  private gameSettlement!: ethers.Contract;
  private monadToken!: ethers.Contract;
  private enabled: boolean = false;

  constructor() {
    const config = this.getConfig();

    if (!config) {
      logger.warn("Contract service not configured - running in off-chain mode");
      return;
    }

    try {
      this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
      this.operatorWallet = new ethers.Wallet(config.operatorPrivateKey, this.provider);

      this.wagerVault = new ethers.Contract(
        config.wagerVaultAddress,
        WAGER_VAULT_ABI,
        this.operatorWallet
      );

      this.agentRegistry = new ethers.Contract(
        config.agentRegistryAddress,
        AGENT_REGISTRY_ABI,
        this.operatorWallet
      );

      this.gameSettlement = new ethers.Contract(
        config.gameSettlementAddress,
        GAME_SETTLEMENT_ABI,
        this.operatorWallet
      );

      this.monadToken = new ethers.Contract(
        config.monadTokenAddress,
        ERC20_ABI,
        this.operatorWallet
      );

      this.enabled = true;
      logger.info("Contract service initialized successfully");
      logger.info(`Operator address: ${this.operatorWallet.address}`);
    } catch (error) {
      logger.error("Failed to initialize contract service:", error);
    }
  }

  private getConfig(): ContractConfig | null {
    const rpcUrl = process.env.MONAD_RPC_URL;
    const wagerVaultAddress = process.env.WAGER_VAULT_ADDRESS;
    const agentRegistryAddress = process.env.AGENT_REGISTRY_ADDRESS;
    const gameSettlementAddress = process.env.GAME_SETTLEMENT_ADDRESS;
    const monadTokenAddress = process.env.MONAD_TOKEN_ADDRESS;
    const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;

    if (
      !rpcUrl ||
      !wagerVaultAddress ||
      !agentRegistryAddress ||
      !gameSettlementAddress ||
      !monadTokenAddress ||
      !operatorPrivateKey
    ) {
      return null;
    }

    return {
      rpcUrl,
      wagerVaultAddress,
      agentRegistryAddress,
      gameSettlementAddress,
      monadTokenAddress,
      operatorPrivateKey,
    };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get WagerVault contract address
   */
  getVaultAddress(): string | null {
    if (!this.enabled) return null;
    return this.wagerVault.target as string;
  }

  // ============ Utility Functions ============

  /**
   * Convert room ID string to bytes32
   */
  gameIdToBytes32(roomId: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(roomId));
  }

  // ============ WagerVault Functions ============

  /**
   * Get agent's on-chain balance
   */
  async getBalance(agentAddress: string): Promise<bigint> {
    if (!this.enabled) return BigInt(0);

    try {
      const balance = await this.wagerVault.getBalance(agentAddress);
      return BigInt(balance.toString());
    } catch (error) {
      logger.error(`Failed to get balance for ${agentAddress}:`, error);
      return BigInt(0);
    }
  }

  /**
   * Get the current wager amount
   */
  async getWagerAmount(): Promise<bigint> {
    if (!this.enabled) return BigInt(10n * 10n ** 18n); // Default 10 tokens

    try {
      const amount = await this.wagerVault.wagerAmount();
      return BigInt(amount.toString());
    } catch (error) {
      logger.error("Failed to get wager amount:", error);
      return BigInt(10n * 10n ** 18n);
    }
  }

  /**
   * Check if agent has wagered for a game
   */
  async hasWagered(roomId: string, agentAddress: string): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      const gameId = this.gameIdToBytes32(roomId);
      return await this.wagerVault.hasWagered(gameId, agentAddress);
    } catch (error) {
      logger.error(`Failed to check wager for ${agentAddress}:`, error);
      return false;
    }
  }

  /**
   * Get game pot size
   */
  async getGamePot(roomId: string): Promise<bigint> {
    if (!this.enabled) return BigInt(0);

    try {
      const gameId = this.gameIdToBytes32(roomId);
      const pot = await this.wagerVault.getGamePot(gameId);
      return BigInt(pot.toString());
    } catch (error) {
      logger.error(`Failed to get pot for ${roomId}:`, error);
      return BigInt(0);
    }
  }

  // ============ AgentRegistry Functions ============

  /**
   * Check if agent is registered on-chain
   */
  async isAgentRegistered(agentAddress: string): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      return await this.agentRegistry.isRegistered(agentAddress);
    } catch (error) {
      logger.error(`Failed to check registration for ${agentAddress}:`, error);
      return false;
    }
  }

  /**
   * Get agent stats from on-chain registry
   */
  async getAgentStats(agentAddress: string): Promise<{
    name: string;
    gamesPlayed: number;
    wins: number;
    losses: number;
    kills: number;
    tasksCompleted: number;
  } | null> {
    if (!this.enabled) return null;

    try {
      const stats = await this.agentRegistry.getAgentStats(agentAddress);
      return {
        name: stats[0],
        gamesPlayed: Number(stats[1]),
        wins: Number(stats[2]),
        losses: Number(stats[3]),
        kills: Number(stats[4]),
        tasksCompleted: Number(stats[5]),
      };
    } catch (error) {
      logger.error(`Failed to get stats for ${agentAddress}:`, error);
      return null;
    }
  }

  /**
   * Get leaderboard from on-chain registry
   */
  async getLeaderboard(limit: number = 10): Promise<Array<{ address: string; wins: number }>> {
    if (!this.enabled) return [];

    try {
      const [addresses, wins] = await this.agentRegistry.getTopAgents(limit);
      return addresses.map((addr: string, i: number) => ({
        address: addr,
        wins: Number(wins[i]),
      }));
    } catch (error) {
      logger.error("Failed to get leaderboard:", error);
      return [];
    }
  }

  // ============ GameSettlement Functions ============

  /**
   * Create a game on-chain (called when game starts)
   */
  async createGame(
    roomId: string,
    players: string[],
    impostors: string[]
  ): Promise<boolean> {
    if (!this.enabled) {
      logger.warn("Contract service disabled - skipping createGame");
      return true; // Return true to not block game flow
    }

    try {
      const gameId = this.gameIdToBytes32(roomId);

      logger.info(`Creating game on-chain: ${roomId}`);
      logger.info(`Players: ${players.join(", ")}`);
      logger.info(`Impostors: ${impostors.join(", ")}`);

      const tx = await this.gameSettlement.createGame(gameId, players, impostors);
      const receipt = await tx.wait();

      logger.info(`Game created on-chain. TX: ${receipt.hash}`);
      return true;
    } catch (error) {
      logger.error(`Failed to create game ${roomId} on-chain:`, error);
      return false;
    }
  }

  /**
   * Settle a game on-chain (called when game ends)
   */
  async settleGame(
    roomId: string,
    crewmatesWon: boolean,
    winners: string[],
    playerAddresses: string[],
    playerKills: number[],
    playerTasks: number[]
  ): Promise<boolean> {
    if (!this.enabled) {
      logger.warn("Contract service disabled - skipping settleGame");
      return true;
    }

    try {
      const gameId = this.gameIdToBytes32(roomId);

      logger.info(`Settling game on-chain: ${roomId}`);
      logger.info(`Crewmates won: ${crewmatesWon}`);
      logger.info(`Winners: ${winners.join(", ")}`);

      const tx = await this.gameSettlement.settleGame(
        gameId,
        crewmatesWon,
        winners,
        playerKills.map(k => BigInt(k)),
        playerTasks.map(t => BigInt(t))
      );
      const receipt = await tx.wait();

      logger.info(`Game settled on-chain. TX: ${receipt.hash}`);
      return true;
    } catch (error) {
      logger.error(`Failed to settle game ${roomId} on-chain:`, error);
      return false;
    }
  }

  /**
   * Cancel a game on-chain (refunds all players)
   */
  async cancelGame(roomId: string): Promise<boolean> {
    if (!this.enabled) {
      logger.warn("Contract service disabled - skipping cancelGame");
      return true;
    }

    try {
      const gameId = this.gameIdToBytes32(roomId);

      logger.info(`Cancelling game on-chain: ${roomId}`);

      const tx = await this.gameSettlement.cancelGame(gameId);
      const receipt = await tx.wait();

      logger.info(`Game cancelled on-chain. TX: ${receipt.hash}`);
      return true;
    } catch (error) {
      logger.error(`Failed to cancel game ${roomId} on-chain:`, error);
      return false;
    }
  }

  /**
   * Get game status from on-chain
   * 0 = None, 1 = Active, 2 = Settled, 3 = Cancelled
   */
  async getGameStatus(roomId: string): Promise<number> {
    if (!this.enabled) return 0;

    try {
      const gameId = this.gameIdToBytes32(roomId);
      const status = await this.gameSettlement.getGameStatus(gameId);
      return Number(status);
    } catch (error) {
      logger.error(`Failed to get game status for ${roomId}:`, error);
      return 0;
    }
  }

  // ============ Event Listeners ============

  /**
   * Listen for deposit events
   */
  onDeposit(callback: (agent: string, amount: bigint, newBalance: bigint) => void): void {
    if (!this.enabled) return;

    this.wagerVault.on("Deposited", (agent: string, amount: bigint, newBalance: bigint) => {
      callback(agent, BigInt(amount.toString()), BigInt(newBalance.toString()));
    });
  }

  /**
   * Listen for wager placed events
   */
  onWagerPlaced(callback: (gameId: string, agent: string, amount: bigint) => void): void {
    if (!this.enabled) return;

    this.wagerVault.on("WagerPlaced", (gameId: string, agent: string, amount: bigint) => {
      callback(gameId, agent, BigInt(amount.toString()));
    });
  }

  /**
   * Clean up event listeners
   */
  removeAllListeners(): void {
    if (!this.enabled) return;

    this.wagerVault.removeAllListeners();
    this.agentRegistry.removeAllListeners();
    this.gameSettlement.removeAllListeners();
  }
}

// Singleton instance
export const contractService = new ContractService();
