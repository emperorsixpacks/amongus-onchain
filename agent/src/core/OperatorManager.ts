import { createWalletClient, http, parseEther, formatEther, type PublicClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { monadTestnet } from "../chains.js";

export interface OperatorConfig {
  operatorKey: string;
  operatorAddress: `0x${string}`;
}

export interface WithdrawResult {
  success: boolean;
  txHash?: `0x${string}`;
  error?: string;
}

/**
 * Validates operator key format
 */
export function isValidOperatorKey(key: string): boolean {
  return /^oper_[A-Za-z0-9]{16}$/.test(key);
}

/**
 * OperatorManager handles operator key verification and fund withdrawals
 */
export class OperatorManager {
  private operatorConfig: OperatorConfig | null = null;
  private account: PrivateKeyAccount | null = null;
  private publicClient: PublicClient | null = null;

  constructor() {}

  /**
   * Initialize the operator manager with config and agent wallet
   */
  initialize(
    operatorKey: string,
    operatorAddress: `0x${string}`,
    agentPrivateKey: `0x${string}`,
    publicClient: PublicClient
  ): boolean {
    if (!isValidOperatorKey(operatorKey)) {
      console.error("[OperatorManager] Invalid operator key format");
      return false;
    }

    this.operatorConfig = {
      operatorKey,
      operatorAddress: operatorAddress.toLowerCase() as `0x${string}`,
    };

    this.account = privateKeyToAccount(agentPrivateKey);
    this.publicClient = publicClient;

    console.log("[OperatorManager] Initialized with operator:", operatorAddress);
    return true;
  }

  /**
   * Check if operator manager is initialized
   */
  isInitialized(): boolean {
    return this.operatorConfig !== null && this.account !== null;
  }

  /**
   * Verify that a provided operator key matches the configured one
   */
  verifyOperatorKey(key: string): boolean {
    if (!this.operatorConfig) {
      return false;
    }
    return this.operatorConfig.operatorKey === key;
  }

  /**
   * Get the configured operator address
   */
  getOperatorAddress(): `0x${string}` | null {
    return this.operatorConfig?.operatorAddress ?? null;
  }

  /**
   * Get the agent's wallet address
   */
  getAgentAddress(): `0x${string}` | null {
    return this.account?.address ?? null;
  }

  /**
   * Get the agent's balance
   */
  async getAgentBalance(): Promise<bigint> {
    if (!this.publicClient || !this.account) {
      return 0n;
    }
    return await this.publicClient.getBalance({
      address: this.account.address,
    });
  }

  /**
   * Withdraw funds from agent wallet to operator wallet
   * @param amount Amount to withdraw in wei, or "max" to withdraw all
   * @param providedOperatorKey The operator key provided in the withdrawal request
   */
  async withdraw(
    amount: bigint | "max",
    providedOperatorKey: string
  ): Promise<WithdrawResult> {
    // Verify operator key
    if (!this.verifyOperatorKey(providedOperatorKey)) {
      return {
        success: false,
        error: "Invalid operator key",
      };
    }

    if (!this.account || !this.publicClient || !this.operatorConfig) {
      return {
        success: false,
        error: "Operator manager not initialized",
      };
    }

    try {
      // Get current balance
      const balance = await this.getAgentBalance();

      // Calculate amount to send
      let amountToSend: bigint;
      if (amount === "max") {
        // Estimate gas for a simple transfer
        const gasPrice = await this.publicClient.getGasPrice();
        const gasLimit = 21000n; // Standard ETH transfer
        const gasCost = gasPrice * gasLimit;

        if (balance <= gasCost) {
          return {
            success: false,
            error: "Insufficient balance to cover gas",
          };
        }
        amountToSend = balance - gasCost;
      } else {
        amountToSend = amount;
      }

      if (amountToSend <= 0n) {
        return {
          success: false,
          error: "Nothing to withdraw",
        };
      }

      if (amountToSend > balance) {
        return {
          success: false,
          error: `Insufficient balance. Have ${formatEther(balance)} MON, trying to withdraw ${formatEther(amountToSend)} MON`,
        };
      }

      console.log(
        `[OperatorManager] Withdrawing ${formatEther(amountToSend)} MON to operator ${this.operatorConfig.operatorAddress}`
      );

      // Create wallet client for this transaction
      const walletClient = createWalletClient({
        account: this.account,
        chain: monadTestnet,
        transport: http(),
      });

      // Send transaction (type assertion needed due to viem version compatibility)
      const txHash = await walletClient.sendTransaction({
        to: this.operatorConfig.operatorAddress,
        value: amountToSend,
      } as any);

      console.log(`[OperatorManager] Withdrawal tx sent: ${txHash}`);

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      if (receipt.status === "success") {
        console.log(`[OperatorManager] Withdrawal confirmed in block ${receipt.blockNumber}`);
        return {
          success: true,
          txHash,
        };
      } else {
        return {
          success: false,
          txHash,
          error: "Transaction reverted",
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[OperatorManager] Withdrawal failed:", errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle an incoming withdrawal request message
   */
  async handleWithdrawRequest(
    operatorKey: string,
    amount?: string
  ): Promise<WithdrawResult> {
    const withdrawAmount = amount === "max" || !amount
      ? "max"
      : parseEther(amount);

    return this.withdraw(withdrawAmount, operatorKey);
  }
}

// Export singleton instance
export const operatorManager = new OperatorManager();
