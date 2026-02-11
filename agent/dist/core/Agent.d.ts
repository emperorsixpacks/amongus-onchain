import type { Address } from "viem";
import { AgentConfig, Role } from "../types.js";
import { GameMemory } from "../memory/GameMemory.js";
import { IStrategy } from "../strategies/BaseStrategy.js";
import { CrewmateStyle } from "../strategies/CrewmateStrategy.js";
import { ImpostorStyle } from "../strategies/ImpostorStrategy.js";
export interface AgentOptions {
    crewmateStyle?: CrewmateStyle;
    impostorStyle?: ImpostorStyle;
    wsServerUrl?: string;
}
export declare class Agent {
    private config;
    private observer;
    private submitter;
    private memory;
    private logger;
    private wsClient;
    private currentGameId;
    private currentGameAddress;
    private myRole;
    private strategy;
    private pendingCommitment;
    private lastPhase;
    private crewmateStyle;
    private impostorStyle;
    constructor(config: AgentConfig, options?: AgentOptions);
    /**
     * Connect to WebSocket server (call before joining game)
     */
    connectWebSocket(): Promise<void>;
    /**
     * Disconnect from WebSocket server
     */
    disconnectWebSocket(): void;
    get address(): Address;
    findAndJoinGame(maxWager?: bigint): Promise<{
        gameId: bigint;
        gameAddress: Address;
    } | null>;
    createAndJoinGame(wagerAmount?: bigint): Promise<{
        gameId: bigint;
        gameAddress: Address;
    }>;
    setGame(gameId: bigint, gameAddress: Address, colorId?: number): void;
    startGame(): Promise<void>;
    playGame(): Promise<void>;
    /**
     * Broadcast phase change to WebSocket server
     */
    private broadcastPhaseChange;
    private handlePhase;
    private handleActionCommit;
    private handleActionReveal;
    private handleDiscussion;
    private handleVoting;
    private initializeRoleAndStrategy;
    private buildStrategyContext;
    private sleep;
    getRole(): Role;
    getStrategy(): IStrategy | null;
    getMemory(): GameMemory;
    getCurrentGameId(): bigint | null;
}
//# sourceMappingURL=Agent.d.ts.map