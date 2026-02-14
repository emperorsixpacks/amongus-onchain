import {
  createWalletClient,
  createPublicClient,
  http,
  type WalletClient,
  type PublicClient,
  type Address,
  type Account,
  type Chain,
  keccak256,
  encodePacked,
  parseEther,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AmongUsGameABI,
  AmongUsGameFactoryABI,
} from "../abi/index.js";
import {
  Action,
  ActionType,
  ActionCommitment,
  Location,
  SabotageType,
  MessageType,
  AccuseReason,
} from "../types.js";

// Define Monad chain (or local)
const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.monad.xyz"] },
  },
});

const localhost = defineChain({
  id: 31337,
  name: "Localhost",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://localhost:8545"] },
  },
});

export class ActionSubmitter {
  private walletClient: WalletClient;
  private publicClient: PublicClient;
  private account: Account;
  private factoryAddress: Address;
  private gameAddress: Address | null = null;
  private chain: Chain;

  constructor(privateKey: `0x${string}`, rpcUrl: string, factoryAddress: Address) {
    this.account = privateKeyToAccount(privateKey);

    // Determine chain based on RPC URL
    this.chain = rpcUrl.includes("localhost") || rpcUrl.includes("127.0.0.1")
      ? localhost
      : monadMainnet;

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(rpcUrl),
    });
    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(rpcUrl),
    });
    this.factoryAddress = factoryAddress;
  }

  get address(): Address {
    return this.account.address;
  }

  setGame(gameAddress: Address): void {
    this.gameAddress = gameAddress;
  }

  // ============ GAME MANAGEMENT ============

  async createGame(wagerAmount: bigint = parseEther("0.01")): Promise<{
    gameId: bigint;
    gameAddress: Address;
    txHash: `0x${string}`;
  }> {
    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.account,
      address: this.factoryAddress,
      abi: AmongUsGameFactoryABI as any,
      functionName: "createGame",
      args: [],
      value: wagerAmount,
    });

    await this.publicClient.waitForTransactionReceipt({ hash });

    const gameCount = (await this.publicClient.readContract({
      address: this.factoryAddress,
      abi: AmongUsGameFactoryABI as any,
      functionName: "gameCount",
    })) as bigint;

    const gameId = gameCount - 1n;
    const gameAddress = (await this.publicClient.readContract({
      address: this.factoryAddress,
      abi: AmongUsGameFactoryABI as any,
      functionName: "games",
      args: [gameId],
    })) as Address;

    this.gameAddress = gameAddress;

    return { gameId, gameAddress, txHash: hash };
  }

  async joinGame(gameId: bigint, colorId: number, wagerAmount: bigint): Promise<`0x${string}`> {
    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.factoryAddress,
      abi: AmongUsGameFactoryABI as any,
      functionName: "joinGame",
      args: [gameId, colorId],
      value: wagerAmount,
    });

    await this.publicClient.waitForTransactionReceipt({ hash });

    const gameAddress = (await this.publicClient.readContract({
      address: this.factoryAddress,
      abi: AmongUsGameFactoryABI as any,
      functionName: "games",
      args: [gameId],
    })) as Address;

    this.gameAddress = gameAddress;

    return hash;
  }

  async leaveGame(gameId: bigint): Promise<`0x${string}`> {
    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.factoryAddress,
      abi: AmongUsGameFactoryABI as any,
      functionName: "leaveGame",
      args: [gameId],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async startGame(): Promise<`0x${string}`> {
    if (!this.gameAddress) throw new Error("No game set");

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.gameAddress,
      abi: AmongUsGameABI as any,
      functionName: "startGame",
      args: [],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // ============ ACTION COMMIT-REVEAL ============

  generateSalt(): `0x${string}` {
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    return `0x${Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}` as `0x${string}`;
  }

  createActionCommitment(action: Action): ActionCommitment {
    const salt = this.generateSalt();

    const hash = keccak256(
      encodePacked(
        ["uint8", "address", "uint8", "uint8", "uint8", "bytes32", "address"],
        [
          action.type,
          action.target || "0x0000000000000000000000000000000000000000",
          action.destination ?? 0,
          action.taskId ?? 0,
          action.sabotage ?? 0,
          salt,
          this.account.address,
        ]
      )
    );

    return { hash, action, salt };
  }

  async commitAction(commitment: ActionCommitment): Promise<`0x${string}`> {
    if (!this.gameAddress) throw new Error("No game set");

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.gameAddress,
      abi: AmongUsGameABI as any,
      functionName: "commitAction",
      args: [commitment.hash],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async revealAction(commitment: ActionCommitment): Promise<`0x${string}`> {
    if (!this.gameAddress) throw new Error("No game set");

    const { action, salt } = commitment;

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.gameAddress,
      abi: AmongUsGameABI as any,
      functionName: "revealAction",
      args: [
        action.type,
        action.target || "0x0000000000000000000000000000000000000000",
        action.destination ?? 0,
        action.taskId ?? 0,
        action.sabotage ?? 0,
        salt,
      ],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // ============ VOTING ============

  async submitVote(suspect: Address | null): Promise<`0x${string}`> {
    if (!this.gameAddress) throw new Error("No game set");

    const targetAddress = suspect || "0x0000000000000000000000000000000000000000";

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.gameAddress,
      abi: AmongUsGameABI as any,
      functionName: "submitVote",
      args: [targetAddress],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async submitMessage(
    msgType: MessageType,
    target: Address,
    reason: AccuseReason,
    location: Location
  ): Promise<`0x${string}`> {
    if (!this.gameAddress) throw new Error("No game set");

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.gameAddress,
      abi: AmongUsGameABI as any,
      functionName: "submitMessage",
      args: [msgType, target, reason, location],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // ============ PHASE ADVANCE ============

  async advancePhase(): Promise<`0x${string}`> {
    if (!this.gameAddress) throw new Error("No game set");

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      address: this.gameAddress,
      abi: AmongUsGameABI as any,
      functionName: "advancePhase",
      args: [],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // ============ HELPER ACTIONS ============

  createMoveAction(destination: Location): Action {
    return {
      type: ActionType.Move,
      destination,
    };
  }

  createDoTaskAction(taskId: number): Action {
    return {
      type: ActionType.DoTask,
      taskId,
    };
  }

  createFakeTaskAction(): Action {
    return {
      type: ActionType.FakeTask,
    };
  }

  createKillAction(target: Address): Action {
    return {
      type: ActionType.Kill,
      target,
    };
  }

  createReportAction(): Action {
    return {
      type: ActionType.Report,
    };
  }

  createCallMeetingAction(): Action {
    return {
      type: ActionType.CallMeeting,
    };
  }

  createVentAction(destination: Location): Action {
    return {
      type: ActionType.Vent,
      destination,
    };
  }

  createSabotageAction(sabotageType: SabotageType): Action {
    return {
      type: ActionType.Sabotage,
      sabotage: sabotageType,
    };
  }

  createSkipAction(): Action {
    return {
      type: ActionType.Skip,
    };
  }
}
