import type { Address } from "viem";
import { parseEther } from "viem";
import winston from "winston";
import {
  AgentConfig,
  GameState,
  GamePhase,
  Role,
  Player,
  Action,
  ActionCommitment,
  DeadBody,
  DiscussionMessage,
  ActionType,
} from "../types.js";
import { GameObserver } from "./GameObserver.js";
import { ActionSubmitter } from "./ActionSubmitter.js";
import { GameMemory } from "../memory/GameMemory.js";
import { IStrategy, StrategyContext } from "../strategies/BaseStrategy.js";
import { CrewmateStrategy, CrewmateStyle } from "../strategies/CrewmateStrategy.js";
import { ImpostorStrategy, ImpostorStyle } from "../strategies/ImpostorStrategy.js";
import { WebSocketClient } from "./WebSocketClient.js";

export interface AgentOptions {
  crewmateStyle?: CrewmateStyle;
  impostorStyle?: ImpostorStyle;
  wsServerUrl?: string;
}

export class Agent {
  private config: AgentConfig;
  private observer: GameObserver;
  private submitter: ActionSubmitter;
  private memory: GameMemory;
  private logger: winston.Logger;
  private wsClient: WebSocketClient | null = null;

  private currentGameId: bigint | null = null;
  private currentGameAddress: Address | null = null;
  private myRole: Role = Role.None;
  private strategy: IStrategy | null = null;
  private pendingCommitment: ActionCommitment | null = null;
  private lastPhase: GamePhase | null = null;

  private crewmateStyle: CrewmateStyle;
  private impostorStyle: ImpostorStyle;

  constructor(
    config: AgentConfig,
    options: AgentOptions = {}
  ) {
    const {
      crewmateStyle = "task-focused",
      impostorStyle = "stealth",
      wsServerUrl,
    } = options;

    this.config = config;
    this.observer = new GameObserver(config.rpcUrl, config.factoryAddress);
    this.submitter = new ActionSubmitter(config.privateKey, config.rpcUrl, config.factoryAddress);
    this.memory = new GameMemory();
    this.crewmateStyle = crewmateStyle;
    this.impostorStyle = impostorStyle;

    this.logger = winston.createLogger({
      level: "info",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [${config.agentName}] ${level.toUpperCase()}: ${message}`;
        })
      ),
      transports: [new winston.transports.Console()],
    });

    // Initialize WebSocket client if server URL provided
    if (wsServerUrl) {
      this.wsClient = new WebSocketClient(
        {
          serverUrl: wsServerUrl,
          agentAddress: this.submitter.address,
          agentName: config.agentName,
        },
        this.logger
      );
    }
  }

  /**
   * Connect to WebSocket server (call before joining game)
   */
  async connectWebSocket(): Promise<void> {
    if (this.wsClient) {
      await this.wsClient.connect();
      this.logger.info("WebSocket connected");
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnectWebSocket(): void {
    if (this.wsClient) {
      this.wsClient.disconnect();
      this.logger.info("WebSocket disconnected");
    }
  }

  get address(): Address {
    return this.submitter.address;
  }

  // ============ GAME LIFECYCLE ============

  async findAndJoinGame(
    maxWager: bigint = parseEther("0.01")
  ): Promise<{ gameId: bigint; gameAddress: Address } | null> {
    this.logger.info("Looking for available games...");

    const availableGames = await this.observer.getAvailableGames();
    const suitableGames = availableGames.filter(
      (g) => g.wagerAmount <= maxWager
    );

    if (suitableGames.length === 0) {
      this.logger.info("No suitable games found");
      return null;
    }

    // Join the first suitable game
    const game = suitableGames[0];
    this.logger.info(`Joining game ${game.gameId} with wager ${game.wagerAmount}`);

    const colorId = Math.floor(Math.random() * 12);
    await this.submitter.joinGame(game.gameId, colorId, game.wagerAmount);

    const gameAddress = await this.observer.getGameAddress(game.gameId);
    this.setGame(game.gameId, gameAddress);

    return { gameId: game.gameId, gameAddress };
  }

  async createAndJoinGame(
    wagerAmount: bigint = parseEther("0.01")
  ): Promise<{ gameId: bigint; gameAddress: Address }> {
    this.logger.info(`Creating new game with wager ${wagerAmount}`);

    const result = await this.submitter.createGame(wagerAmount);
    this.setGame(result.gameId, result.gameAddress);

    return { gameId: result.gameId, gameAddress: result.gameAddress };
  }

  setGame(gameId: bigint, gameAddress: Address, colorId: number = 0): void {
    this.currentGameId = gameId;
    this.currentGameAddress = gameAddress;
    this.observer.setGame(gameAddress, gameId);
    this.submitter.setGame(gameAddress);
    this.memory.reset();
    this.myRole = Role.None;
    this.strategy = null;
    this.pendingCommitment = null;
    this.lastPhase = null;
    this.logger.info(`Set active game: ${gameId} at ${gameAddress}`);

    // Join WebSocket game room
    if (this.wsClient) {
      this.wsClient.joinGame(gameId, colorId);
    }
  }

  async startGame(): Promise<void> {
    this.logger.info("Starting game...");
    await this.submitter.startGame();
  }

  // ============ MAIN GAME LOOP ============

  async playGame(): Promise<void> {
    if (!this.currentGameId || !this.currentGameAddress) {
      throw new Error("No game set. Call setGame() or findAndJoinGame() first.");
    }

    this.logger.info("Starting game loop...");

    while (true) {
      try {
        const gameState = await this.observer.getGameState();
        this.memory.setCurrentRound(gameState.round);

        // Broadcast phase change via WebSocket
        if (this.lastPhase !== gameState.phase) {
          this.broadcastPhaseChange(gameState);
          this.lastPhase = gameState.phase;
        }

        if (gameState.phase === GamePhase.Ended) {
          this.logger.info(`Game ended! Crewmates won: ${gameState.crewmatesWon}`);
          // Leave WebSocket game room
          if (this.wsClient) {
            this.wsClient.leaveGame();
          }
          break;
        }

        await this.handlePhase(gameState);

        // Small delay between checks
        await this.sleep(1000);
      } catch (error) {
        this.logger.error(`Error in game loop: ${error}`);
        await this.sleep(2000);
      }
    }
  }

  /**
   * Broadcast phase change to WebSocket server
   */
  private broadcastPhaseChange(gameState: GameState): void {
    if (this.wsClient) {
      this.wsClient.sendPhaseChange(
        gameState.phase,
        gameState.round,
        gameState.phaseEndTime
      );
    }
  }

  private async handlePhase(gameState: GameState): Promise<void> {
    switch (gameState.phase) {
      case GamePhase.Lobby:
        // Wait for game to start
        this.logger.debug("Waiting in lobby...");
        break;

      case GamePhase.Starting:
        // Roles being assigned
        this.logger.info("Game starting, roles being assigned...");
        break;

      case GamePhase.ActionCommit:
        await this.handleActionCommit(gameState);
        break;

      case GamePhase.ActionReveal:
        await this.handleActionReveal(gameState);
        break;

      case GamePhase.Discussion:
        await this.handleDiscussion(gameState);
        break;

      case GamePhase.Voting:
        await this.handleVoting(gameState);
        break;

      case GamePhase.VoteResult:
        // Wait for result processing
        this.logger.debug("Waiting for vote result...");
        break;

      default:
        this.logger.debug(`Unknown phase: ${gameState.phase}`);
    }
  }

  // ============ PHASE HANDLERS ============

  private async handleActionCommit(gameState: GameState): Promise<void> {
    // Check if already committed
    const hasCommitted = await this.observer.hasCommitted(gameState.round, this.address);
    if (hasCommitted) {
      this.logger.debug("Already committed action for this round");
      return;
    }

    // Initialize role and strategy if not done
    if (this.myRole === Role.None || !this.strategy) {
      await this.initializeRoleAndStrategy();
    }

    // Build context
    const context = await this.buildStrategyContext(gameState);

    // Decide action
    const action = await this.strategy!.decideAction(context);
    this.logger.info(`Decided action: ${JSON.stringify(action)}`);

    // Create and store commitment
    this.pendingCommitment = this.submitter.createActionCommitment(action);

    // Submit commitment
    await this.submitter.commitAction(this.pendingCommitment);
    this.logger.info(`Committed action hash: ${this.pendingCommitment.hash}`);
  }

  private async handleActionReveal(gameState: GameState): Promise<void> {
    // Check if already revealed
    const hasRevealed = await this.observer.hasRevealed(gameState.round, this.address);
    if (hasRevealed) {
      this.logger.debug("Already revealed action for this round");
      return;
    }

    if (!this.pendingCommitment) {
      this.logger.error("No pending commitment to reveal!");
      return;
    }

    const revealedAction = this.pendingCommitment.action;

    // Reveal action
    await this.submitter.revealAction(this.pendingCommitment);
    this.logger.info(`Revealed action: ${JSON.stringify(revealedAction)}`);

    // Update memory
    const myPlayer = await this.observer.getPlayer(this.address);
    this.memory.setMyLocation(myPlayer.location);

    // Send action result to WebSocket server
    if (this.wsClient) {
      this.wsClient.sendActionResult(revealedAction, gameState.round);

      // If it was a move, also send position update
      if (revealedAction.type === ActionType.Move && revealedAction.destination !== undefined) {
        this.wsClient.sendPositionUpdate(revealedAction.destination, gameState.round);
      }

      // If it was a kill, notify the server
      if (revealedAction.type === ActionType.Kill && revealedAction.target) {
        this.wsClient.sendKill(
          this.address,
          revealedAction.target,
          myPlayer.location,
          gameState.round
        );
      }

      // If it was a task, notify the server
      if (revealedAction.type === ActionType.DoTask) {
        this.wsClient.sendTaskComplete(
          this.address,
          myPlayer.tasksCompleted,
          myPlayer.totalTasks
        );
      }
    }

    this.pendingCommitment = null;
  }

  private async handleDiscussion(gameState: GameState): Promise<void> {
    if (!this.strategy) return;

    const context = await this.buildStrategyContext(gameState);

    // Generate and submit discussion messages
    const messages = await this.strategy.generateMessages(context);
    for (const msg of messages) {
      try {
        await this.submitter.submitMessage(
          msg.msgType,
          msg.target,
          msg.reason,
          msg.location
        );
        this.logger.info(`Sent message: ${JSON.stringify(msg)}`);
      } catch (error) {
        this.logger.error(`Failed to send message: ${error}`);
      }
    }

    // Record messages in memory
    const allMessages = await this.observer.getDiscussionMessages();
    for (const msg of allMessages) {
      if (msg.msgType === 0) {
        // Accuse
        this.memory.recordAccusation(msg);
      } else if (msg.msgType === 1) {
        // Defend
        this.memory.recordDefense(msg);
      }
    }
  }

  private async handleVoting(gameState: GameState): Promise<void> {
    // Check if already voted
    const myPlayer = await this.observer.getPlayer(this.address);
    if (myPlayer.hasVoted) {
      this.logger.debug("Already voted this round");
      return;
    }

    if (!this.strategy) {
      await this.initializeRoleAndStrategy();
    }

    const context = await this.buildStrategyContext(gameState);

    // Decide vote
    const voteTarget = await this.strategy!.decideVote(context);
    this.logger.info(`Voting for: ${voteTarget || "SKIP"}`);

    // Submit vote
    await this.submitter.submitVote(voteTarget);

    // Send vote to WebSocket server
    if (this.wsClient) {
      this.wsClient.sendVote(this.address, voteTarget, gameState.round);
    }
  }

  // ============ HELPERS ============

  private async initializeRoleAndStrategy(): Promise<void> {
    // In actual game, role is revealed to player
    // For now, we need to determine our role from the contract
    const myPlayer = await this.observer.getPlayer(this.address);

    // The contract stores role privately, but we can infer from gameplay
    // For MVP, let's assume we can read our role (this would need contract support)
    // In production, the agent would call getMyRole() which only works for the player

    // For now, randomly assign for testing - in real game, read from contract
    this.myRole = Math.random() > 0.8 ? Role.Impostor : Role.Crewmate;

    if (this.myRole === Role.Impostor) {
      this.strategy = new ImpostorStrategy(this.impostorStyle);
      this.logger.info(`Assigned role: IMPOSTOR (${this.impostorStyle})`);
    } else {
      this.strategy = new CrewmateStrategy(this.crewmateStyle);
      this.logger.info(`Assigned role: CREWMATE (${this.crewmateStyle})`);
    }
  }

  private async buildStrategyContext(gameState: GameState): Promise<StrategyContext> {
    const allPlayerAddresses = await this.observer.getAllPlayers();
    const allPlayers: Player[] = [];
    const alivePlayers: Player[] = [];

    for (const addr of allPlayerAddresses) {
      const player = await this.observer.getPlayer(addr);
      allPlayers.push(player);
      if (player.isAlive) {
        alivePlayers.push(player);
      }
    }

    const myPlayer = allPlayers.find((p) => p.address === this.address)!;
    const deadBodies = await this.observer.getDeadBodies();
    const messages = await this.observer.getDiscussionMessages();

    return {
      gameState,
      myPlayer,
      allPlayers,
      alivePlayers,
      deadBodies,
      messages,
      memory: this.memory,
      observer: this.observer,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============ PUBLIC GETTERS ============

  getRole(): Role {
    return this.myRole;
  }

  getStrategy(): IStrategy | null {
    return this.strategy;
  }

  getMemory(): GameMemory {
    return this.memory;
  }

  getCurrentGameId(): bigint | null {
    return this.currentGameId;
  }
}
