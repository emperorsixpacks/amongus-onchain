import {
  PrivyClient,
  type AuthorizationContext,
  verifyAccessToken,
} from "@privy-io/node";
import { createLogger } from "./logger.js";
import { databaseService } from "./DatabaseService.js";

const logger = createLogger("privy-wallet");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`❌ Missing required environment variable: ${name}`);
  }
  return value;
}

function sanitizeKey(key: string): string {
  // Handle escaped newlines (common when setting keys from .env or shell)
  return key.replace(/\\n/g, "\n").trim();
}

const PRIVY_APP_ID = requireEnv("PRIVY_APP_ID");
const PRIVY_APP_SECRET = requireEnv("PRIVY_APP_SECRET");

const PRIVY_WALLET_AUTHORIZATION_KEY = requireEnv(
  "PRIVY_WALLET_AUTHORIZATION_KEY",
);
const PRIVY_WALLET_AUTHORIZATION_KEY_ID = requireEnv(
  "PRIVY_WALLET_AUTHORIZATION_KEY_ID",
);
const PRIVY_VERIFICATION_KEY = requireEnv("PRIVY_VERIFICATION_KEY");

interface AgentWallet {
  userId: string; // Privy user ID
  address: string; // Wallet address
  walletId: string; // Privy wallet ID
  operatorKey: string; // Operator key that owns this agent
  createdAt: number;
}

/**
 * Service for creating and managing agent wallets via Privy
 */
export class PrivyWalletService {
  private client: PrivyClient | null = null;

  constructor() {
    if (
      PRIVY_APP_ID &&
      PRIVY_APP_SECRET &&
      PRIVY_APP_ID !== "your-privy-app-id-here" &&
      PRIVY_APP_SECRET !== "your-privy-app-secret-here"
    ) {
      const config: any = {
        appId: PRIVY_APP_ID,
        appSecret: PRIVY_APP_SECRET,
      };

      this.client = new PrivyClient(config);
      logger.info(
        `Privy wallet service initialized (App ID: ${PRIVY_APP_ID.substring(0, 10)}...)`,
      );

      if (
        PRIVY_WALLET_AUTHORIZATION_KEY &&
        !PRIVY_WALLET_AUTHORIZATION_KEY_ID
      ) {
        logger.warn(
          "PRIVY_WALLET_AUTHORIZATION_KEY is set but PRIVY_WALLET_AUTHORIZATION_KEY_ID (owner_id) is missing. Server-side wallet signing will fail.",
        );
      }
      if (PRIVY_WALLET_AUTHORIZATION_KEY_ID) {
        logger.info(
          `Using authorization key owner_id: ${PRIVY_WALLET_AUTHORIZATION_KEY_ID}`,
        );
        logger.info(
          `Authorization key length: ${PRIVY_WALLET_AUTHORIZATION_KEY.length} chars`,
        );
      }
    } else {
      logger.warn(
        "Privy not configured - wallet creation disabled. Set PRIVY_APP_ID and PRIVY_APP_SECRET in .env",
      );
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
  async createAgentWallet(
    operatorKey: string,
  ): Promise<{ address: string; userId: string } | null> {
    if (!this.client) {
      logger.error("Cannot create wallet: Privy not configured");
      return null;
    }

    try {
      // Create a server-side managed wallet for this agent.
      // This wallet is owned by the app's authorization key, allowing for autonomous signing.
      const createOptions: any = {
        chain_type: "ethereum",
      };

      // Associate wallet with authorization key owner so it can sign transactions
      // The owner_id is the key quorum ID from the Privy dashboard
      if (PRIVY_WALLET_AUTHORIZATION_KEY_ID) {
        createOptions.owner_id = PRIVY_WALLET_AUTHORIZATION_KEY_ID;
      }

      const wallet = await this.client.wallets().create(createOptions);

      const address = wallet.address.toLowerCase();
      const walletId = wallet.id;

      // Persist to database
      const operator = await databaseService.getOperatorByKey(operatorKey);
      if (operator) {
        databaseService.upsertAgent({
          walletAddress: address,
          name: `Agent ${address.substring(0, 6)}`,
          operatorId: operator.id,
          privyUserId: undefined, // Server-managed wallets don't necessarily have a user ID
          privyWalletId: walletId,
        });
      } else {
        logger.warn(
          `Operator ${operatorKey} not found in DB - agent wallet persisted in memory only`,
        );
      }

      logger.info(
        `Created server-side agent wallet: ${address} (ID: ${walletId}) for operator: ${operatorKey}`,
      );

      return {
        address,
        userId: "server-managed", // Using a placeholder for the return type
      };
    } catch (error) {
      logger.error("Failed to create agent wallet:", error);
      return null;
    }
  }

  /**
   * Get agent wallet info by address from database
   */
  async getAgentWallet(address: string): Promise<AgentWallet | undefined> {
    const agent = (await databaseService.getAgentByWallet(address)) as any;
    if (!agent || !agent.privyWalletId) {
      return undefined;
    }

    return {
      userId: agent.privyUserId || "server-managed",
      address: agent.walletAddress,
      walletId: agent.privyWalletId,
      operatorKey: agent.operator?.operatorKey || "unknown",
      createdAt: agent.createdAt.getTime(),
    };
  }

  /**
   * Check if an address is a known agent wallet
   */
  async isAgentWallet(address: string): Promise<boolean> {
    const wallet = await this.getAgentWallet(address);
    return !!wallet;
  }

  /**
   * Get all agent wallets for an operator from database
   */
  async getAgentWalletsForOperator(
    operatorKey: string,
  ): Promise<AgentWallet[]> {
    const operator = await databaseService.getOperatorByKey(operatorKey);
    if (!operator) return [];

    return (operator.agents as any[])
      .filter((agent) => agent.privyWalletId)
      .map((agent) => ({
        userId: agent.privyUserId || "server-managed",
        address: agent.walletAddress,
        walletId: agent.privyWalletId!,
        operatorKey: operatorKey,
        createdAt: agent.createdAt.getTime(),
      }));
  }

  /**
   * Verify that an operator key owns a specific agent wallet
   */
  async verifyOperatorOwnership(
    operatorKey: string,
    agentAddress: string,
  ): Promise<boolean> {
    const wallet = await this.getAgentWallet(agentAddress);
    return wallet?.operatorKey === operatorKey;
  }
  /**
   * Send a transaction from an agent wallet (requires Privy to be configured)
   */
  async sendTransaction(
    address: string,
    to: string,
    data: string,
    value: string = "0",
  ): Promise<string | null> {
    if (!this.client) {
      logger.error("Cannot send transaction: Privy not configured");
      return null;
    }

    const wallet = await this.getAgentWallet(address);

    if (!wallet) {
      logger.error(`No agent wallet found for address: ${address}`);
      return null;
    }

    try {
      logger.info(`Sending transaction from agent ${address} to ${to}`);

      const chainId = parseInt(process.env.CHAIN_ID || "10143");

      // Correct API for server-side signing in @privy-io/node
      // Strip "wallet-auth:" prefix if present - SDK expects raw base64 PKCS8 key
      const privateKey = PRIVY_WALLET_AUTHORIZATION_KEY.replace(
        /^wallet-auth:/,
        "",
      );
      const authorizationContext: AuthorizationContext = {
        authorization_private_keys: [privateKey],
      };

      const response = await this.client
        .wallets()
        .ethereum()
        .sendTransaction(wallet.walletId, {
          caip2: `eip155:${chainId}`,
          authorization_context: authorizationContext,
          params: {
            transaction: {
              to,
              value: value.startsWith("0x")
                ? value
                : `0x${BigInt(value).toString(16)}`,
              data,
              chain_id: chainId,
            },
          },
        } as any);

      const hash = response.hash;
      logger.info(`Transaction sent! Hash: ${hash}`);
      return hash;
    } catch (error) {
      logger.error(`Failed to send transaction from agent ${address}:`, error);
      return null;
    }
  }

  /**
   * Verify a Privy JWT token
   * @param token The JWT token to verify
   * @returns The verified user ID and wallet address, or null if invalid
   */
  async verifyToken(
    token: string,
  ): Promise<{ userId: string; walletAddress: string } | null> {
    if (!this.client) {
      logger.error("Cannot verify token: Privy not configured");
      return null;
    }

    try {
      // In v0.8.0, if we don't have the verification key handy,
      // we can try to get the user directly if the token is an ID token,
      // or we can use the appId as the verification key if the SDK supports it.
      // Since we are in the backend and have the App Secret, we can also use that in some contexts.

      // For now, let's assume we need to verify the token.
      // If verifyAccessToken fails without a proper key, we'll try a different way.
      const claims = await verifyAccessToken({
        access_token: token,
        app_id: PRIVY_APP_ID,
        // The verification key is the public key provided in the Privy Dashboard.
        // It must be a valid SPKI formatted string (including headers/footers).
        verification_key: sanitizeKey(PRIVY_VERIFICATION_KEY),
      });

      if (!claims || !claims.user_id) {
        return null;
      }

      const user = await this.client.users()._get(claims.user_id);
      if (!user || !user.linked_accounts) {
        return null;
      }

      const walletAccount = (user.linked_accounts as any[]).find(
        (acc) => acc.type === "wallet",
      );

      if (!walletAccount || !walletAccount.address) {
        return null;
      }

      return {
        userId: user.id,
        walletAddress: walletAccount.address.toLowerCase(),
      };
    } catch (error: any) {
      if (error?.message?.includes("Failed to verify authentication token")) {
        logger.error(
          "Privy JWT verification failed: The verification key (PRIVY_VERIFICATION_KEY) might be invalid or the token is physically malformed.",
        );
      } else {
        logger.error("Failed to verify Privy token:", error);
      }
      return null;
    }
  }
}

// Singleton instance
export const privyWalletService = new PrivyWalletService();
