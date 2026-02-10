import { PrivyClient } from "@privy-io/node";
import { createLogger } from "./logger.js";

const logger = createLogger("privy-wallet");

// Privy configuration from environment
const PRIVY_APP_ID = process.env.PRIVY_APP_ID || "";
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || "";

interface AgentWallet {
  userId: string;       // Privy user ID
  address: string;      // Wallet address
  operatorKey: string;  // Operator key that owns this agent
  createdAt: number;
}

/**
 * Service for creating and managing agent wallets via Privy
 */
export class PrivyWalletService {
  private client: PrivyClient | null = null;
  private agentWallets: Map<string, AgentWallet> = new Map(); // address -> AgentWallet

  constructor() {
    if (PRIVY_APP_ID && PRIVY_APP_SECRET &&
        PRIVY_APP_ID !== "your-privy-app-id-here" &&
        PRIVY_APP_SECRET !== "your-privy-app-secret-here") {
      this.client = new PrivyClient({
        appId: PRIVY_APP_ID,
        appSecret: PRIVY_APP_SECRET,
      });
      logger.info("Privy wallet service initialized");
    } else {
      logger.warn("Privy not configured - wallet creation disabled. Set PRIVY_APP_ID and PRIVY_APP_SECRET in .env");
    }
  }

  /**
   * Check if Privy is enabled
   */
  isEnabled(): boolean {
    return this.client !== null;
  }

  /**
   * Create a new agent wallet for an operator
   * @param operatorKey The operator key (oper_XXXXX)
   * @returns The wallet address or null if failed
   */
  async createAgentWallet(operatorKey: string): Promise<{ address: string; userId: string } | null> {
    if (!this.client) {
      logger.error("Cannot create wallet: Privy not configured");
      return null;
    }

    try {
      // Create a new Privy user for this agent
      // Using a custom identifier based on operator key
      const customId = `agent_${operatorKey}_${Date.now()}`;

      // Create user with custom auth and an Ethereum wallet
      const user = await this.client.users().create({
        linked_accounts: [
          {
            type: "custom_auth",
            custom_user_id: customId,
          },
        ],
        wallets: [
          {
            chain_type: "ethereum",
          },
        ],
      });

      // Find the Ethereum embedded wallet in linked accounts
      // The wallet type for embedded wallets is "ethereum_embedded_wallet"
      let walletAddress: string | undefined;
      for (const account of user.linked_accounts) {
        if ("address" in account && account.type.includes("wallet")) {
          walletAddress = (account as { address: string }).address;
          break;
        }
      }

      if (!walletAddress) {
        logger.error("No Ethereum wallet created for agent");
        return null;
      }

      const address = walletAddress.toLowerCase();

      // Store the agent wallet info
      const agentWallet: AgentWallet = {
        userId: user.id,
        address,
        operatorKey,
        createdAt: Date.now(),
      };
      this.agentWallets.set(address, agentWallet);

      logger.info(`Created agent wallet: ${address} for operator: ${operatorKey}`);

      return {
        address,
        userId: user.id,
      };
    } catch (error) {
      logger.error("Failed to create agent wallet:", error);
      return null;
    }
  }

  /**
   * Get agent wallet info by address
   */
  getAgentWallet(address: string): AgentWallet | undefined {
    return this.agentWallets.get(address.toLowerCase());
  }

  /**
   * Check if an address is a known agent wallet
   */
  isAgentWallet(address: string): boolean {
    return this.agentWallets.has(address.toLowerCase());
  }

  /**
   * Get all agent wallets for an operator
   */
  getAgentWalletsForOperator(operatorKey: string): AgentWallet[] {
    return Array.from(this.agentWallets.values()).filter(
      (w) => w.operatorKey === operatorKey
    );
  }

  /**
   * Verify that an operator key owns a specific agent wallet
   */
  verifyOperatorOwnership(operatorKey: string, agentAddress: string): boolean {
    const wallet = this.agentWallets.get(agentAddress.toLowerCase());
    return wallet?.operatorKey === operatorKey;
  }
}

// Singleton instance
export const privyWalletService = new PrivyWalletService();
