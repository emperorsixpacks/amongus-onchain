// Mock Game Server for Local Testing
// Simulates the game server locally without network

import {
  Player,
  DeadBody,
  GamePhase,
  Role,
  Location,
  SabotageType,
  RoomConnections,
  PlayerColors,
} from '@/types/game';
import { WorkerAction, WorkerActionType, WorkerGameState } from '../workers/WorkerMessage';
import {
  BaseGameConnection,
  GameConnectionConfig,
  GameConnectionCallbacks,
} from './GameConnection';
import { AgentConfig, DEFAULT_GAME_SETTINGS, GameSettings } from '../config/WorkerConfig';

export interface MockGameServerConfig extends GameConnectionConfig {
  agents: AgentConfig[];
  settings?: Partial<GameSettings>;
}

export class MockGameServer extends BaseGameConnection {
  private mockConfig: MockGameServerConfig;
  private settings: GameSettings;
  private players: Player[] = [];
  private deadBodies: DeadBody[] = [];
  private phase: GamePhase = GamePhase.Lobby;
  private round: number = 0;
  private phaseEndTime: number = 0;
  private activeSabotage: SabotageType = SabotageType.None;
  private votes: Map<`0x${string}`, `0x${string}` | null> = new Map();
  private killCooldowns: Map<`0x${string}`, number> = new Map();
  private pendingActions: Map<`0x${string}`, WorkerAction> = new Map();
  private gameLoopInterval: ReturnType<typeof setInterval> | null = null;
  private tasksCompleted: number = 0;
  private totalTasks: number = 0;

  constructor(config: MockGameServerConfig, callbacks: GameConnectionCallbacks) {
    super(config, callbacks);
    this.mockConfig = config;
    this.settings = { ...DEFAULT_GAME_SETTINGS, ...config.settings };
  }

  async connect(): Promise<void> {
    // Initialize players from agent configs
    this.initializePlayers();
    this.connected = true;
    this.phase = GamePhase.Lobby;

    // Broadcast initial state
    this.broadcastGameState();
  }

  disconnect(): void {
    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
      this.gameLoopInterval = null;
    }
    this.connected = false;
  }

  async registerAgent(agentAddress: `0x${string}`): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected');
    }

    this.registeredAgents.add(agentAddress);

    // Find player and assign role
    const player = this.players.find((p) => p.address === agentAddress);
    if (player) {
      const teammates = this.players
        .filter((p) => p.role === Role.Impostor && p.address !== agentAddress)
        .map((p) => p.address);

      this.notifyRoleAssigned(agentAddress, player.role, player.role === Role.Impostor ? teammates : []);
    }
  }

  async submitAction(agentAddress: `0x${string}`, action: WorkerAction): Promise<boolean> {
    if (!this.connected) return false;

    // Store pending action
    this.pendingActions.set(agentAddress, action);
    return true;
  }

  // ============ Game Control ============

  startGame(): void {
    if (this.phase !== GamePhase.Lobby) return;

    this.phase = GamePhase.ActionCommit;
    this.round = 1;
    this.phaseEndTime = Date.now() + this.settings.actionTimeout * 1000;

    // Start game loop
    this.gameLoopInterval = setInterval(() => this.gameLoop(), 1000);

    this.broadcastGameState();

    // Request actions from all agents
    for (const agentAddress of this.registeredAgents) {
      this.notifyActionRequest(agentAddress, this.phase, this.phaseEndTime);
    }
  }

  // ============ Private Methods ============

  private initializePlayers(): void {
    const numImpostors = this.settings.numImpostors;

    // Determine which agents are impostors
    const impostorIndices = new Set<number>();
    const agentConfigs = this.mockConfig.agents;

    // First, handle forced roles
    agentConfigs.forEach((config, index) => {
      if (config.forcedRole === 'Impostor') {
        impostorIndices.add(index);
      }
    });

    // If we need more impostors, randomly select
    while (impostorIndices.size < numImpostors) {
      const index = Math.floor(Math.random() * agentConfigs.length);
      const config = agentConfigs[index];
      if (config.forcedRole !== 'Crewmate') {
        impostorIndices.add(index);
      }
    }

    // Create players
    this.players = agentConfigs.map((config, index) => {
      const isImpostor = impostorIndices.has(index);
      return {
        address: this.generateAddress(index),
        colorId: config.colorId,
        role: isImpostor ? Role.Impostor : Role.Crewmate,
        location: Location.Cafeteria,
        isAlive: true,
        tasksCompleted: 0,
        totalTasks: this.settings.tasksPerPlayer,
        hasVoted: false,
      };
    });

    // Calculate total tasks
    this.totalTasks = this.players.filter((p) => p.role === Role.Crewmate).length *
                      this.settings.tasksPerPlayer;
  }

  private generateAddress(index: number): `0x${string}` {
    return `0x${(index + 1).toString().padStart(40, '0')}` as `0x${string}`;
  }

  private gameLoop(): void {
    // Process pending actions
    this.processPendingActions();

    // Check game state
    this.checkPhaseTransition();
    this.checkWinConditions();

    // Broadcast updated state
    this.broadcastGameState();
  }

  private processPendingActions(): void {
    for (const [agentAddress, action] of this.pendingActions) {
      this.processAction(agentAddress, action);
    }
    this.pendingActions.clear();
  }

  private processAction(agentAddress: `0x${string}`, action: WorkerAction): void {
    const player = this.players.find((p) => p.address === agentAddress);
    if (!player || !player.isAlive) return;

    switch (action.type) {
      case WorkerActionType.MOVE:
        this.handleMove(player, action.targetLocation!);
        break;

      case WorkerActionType.KILL:
        this.handleKill(player, action.targetPlayer!);
        break;

      case WorkerActionType.REPORT_BODY:
        this.handleReportBody(player, action.targetPlayer!);
        break;

      case WorkerActionType.VOTE:
        this.handleVote(player, action.targetPlayer ?? null);
        break;

      case WorkerActionType.COMPLETE_TASK:
        this.handleCompleteTask(player);
        break;

      case WorkerActionType.SABOTAGE:
        this.handleSabotage(player, action.sabotageType!);
        break;
    }
  }

  private handleMove(player: Player, targetLocation: Location): void {
    // Validate move is to adjacent room
    const isAdjacent = RoomConnections.some(
      ([a, b]) =>
        (a === player.location && b === targetLocation) ||
        (b === player.location && a === targetLocation)
    );

    if (isAdjacent) {
      const playerIndex = this.players.findIndex((p) => p.address === player.address);
      if (playerIndex >= 0) {
        this.players[playerIndex] = { ...player, location: targetLocation };
      }
    }
  }

  private handleKill(player: Player, targetAddress: `0x${string}`): void {
    if (player.role !== Role.Impostor) return;

    // Check cooldown
    const cooldown = this.killCooldowns.get(player.address) || 0;
    if (Date.now() < cooldown) return;

    const target = this.players.find((p) => p.address === targetAddress);
    if (!target || !target.isAlive || target.location !== player.location) return;

    // Kill the target
    const targetIndex = this.players.findIndex((p) => p.address === targetAddress);
    if (targetIndex >= 0) {
      this.players[targetIndex] = { ...target, isAlive: false };
    }

    // Create dead body
    this.deadBodies.push({
      victim: targetAddress,
      location: target.location,
      round: BigInt(this.round),
      reported: false,
    });

    // Set cooldown
    this.killCooldowns.set(player.address, Date.now() + this.settings.killCooldown);
  }

  private handleReportBody(player: Player, victimAddress: `0x${string}`): void {
    const body = this.deadBodies.find(
      (b) => b.victim === victimAddress && !b.reported && b.location === player.location
    );

    if (body) {
      // Mark body as reported
      const bodyIndex = this.deadBodies.findIndex((b) => b.victim === victimAddress);
      if (bodyIndex >= 0) {
        this.deadBodies[bodyIndex] = { ...body, reported: true };
      }

      // Start meeting
      this.startMeeting();
    }
  }

  private handleVote(player: Player, target: `0x${string}` | null): void {
    if (this.phase !== GamePhase.Voting) return;

    this.votes.set(player.address, target);

    // Update hasVoted
    const playerIndex = this.players.findIndex((p) => p.address === player.address);
    if (playerIndex >= 0) {
      this.players[playerIndex] = { ...player, hasVoted: true };
    }
  }

  private handleCompleteTask(player: Player): void {
    if (player.role !== Role.Crewmate) return;
    if (player.tasksCompleted >= player.totalTasks) return;

    const playerIndex = this.players.findIndex((p) => p.address === player.address);
    if (playerIndex >= 0) {
      this.players[playerIndex] = {
        ...player,
        tasksCompleted: player.tasksCompleted + 1,
      };
      this.tasksCompleted++;
    }
  }

  private handleSabotage(player: Player, sabotageType: number): void {
    if (player.role !== Role.Impostor) return;
    if (this.activeSabotage !== SabotageType.None) return;

    this.activeSabotage = sabotageType as SabotageType;
  }

  private startMeeting(): void {
    this.phase = GamePhase.Discussion;
    this.phaseEndTime = Date.now() + this.settings.discussionDuration;
    this.votes.clear();

    // Reset hasVoted for all players
    this.players = this.players.map((p) => ({ ...p, hasVoted: false }));

    // Move all players to Cafeteria
    this.players = this.players.map((p) => ({ ...p, location: Location.Cafeteria }));

    // Clear sabotage
    this.activeSabotage = SabotageType.None;

    const alivePlayers = this.players.filter((p) => p.isAlive).map((p) => p.address);

    this.broadcastGameState();
    this.notifyVotingStarted(this.settings.votingDuration, alivePlayers);

    // Schedule transition to voting
    setTimeout(() => {
      if (this.phase === GamePhase.Discussion) {
        this.phase = GamePhase.Voting;
        this.phaseEndTime = Date.now() + this.settings.votingDuration;
        this.broadcastGameState();

        // Request votes from all agents
        for (const agentAddress of this.registeredAgents) {
          this.notifyActionRequest(agentAddress, this.phase, this.phaseEndTime);
        }
      }
    }, this.settings.discussionDuration);
  }

  private checkPhaseTransition(): void {
    const now = Date.now();

    if (this.phase === GamePhase.Voting && now >= this.phaseEndTime) {
      // Tally votes
      this.tallyVotes();
    }
  }

  private tallyVotes(): void {
    const voteCounts = new Map<`0x${string}` | 'skip', number>();

    for (const [, target] of this.votes) {
      const key = target ?? ('skip' as const);
      voteCounts.set(key, (voteCounts.get(key) || 0) + 1);
    }

    // Find max votes
    let maxVotes = 0;
    let ejected: `0x${string}` | null = null;
    let tie = false;

    for (const [target, count] of voteCounts) {
      if (target !== 'skip') {
        if (count > maxVotes) {
          maxVotes = count;
          ejected = target;
          tie = false;
        } else if (count === maxVotes) {
          tie = true;
        }
      }
    }

    // Eject if clear winner
    if (ejected && !tie) {
      const playerIndex = this.players.findIndex((p) => p.address === ejected);
      if (playerIndex >= 0) {
        this.players[playerIndex] = { ...this.players[playerIndex], isAlive: false };
      }
    }

    // Return to action phase
    this.phase = GamePhase.ActionCommit;
    this.round++;
    this.phaseEndTime = Date.now() + 30000; // 30 seconds per round

    this.broadcastGameState();

    // Request actions
    for (const agentAddress of this.registeredAgents) {
      const player = this.players.find((p) => p.address === agentAddress);
      if (player?.isAlive) {
        this.notifyActionRequest(agentAddress, this.phase, this.phaseEndTime);
      }
    }
  }

  private checkWinConditions(): void {
    const aliveCrewmates = this.players.filter(
      (p) => p.isAlive && p.role === Role.Crewmate
    ).length;
    const aliveImpostors = this.players.filter(
      (p) => p.isAlive && p.role === Role.Impostor
    ).length;

    // Impostors win if they equal or outnumber crewmates
    if (aliveImpostors >= aliveCrewmates && aliveCrewmates > 0) {
      this.endGame('impostors', 'crewmates_eliminated');
      return;
    }

    // Crewmates win if all impostors are eliminated
    if (aliveImpostors === 0) {
      this.endGame('crewmates', 'impostors_eliminated');
      return;
    }

    // Crewmates win if all tasks are completed
    if (this.tasksCompleted >= this.totalTasks) {
      this.endGame('crewmates', 'tasks_completed');
      return;
    }
  }

  private endGame(winner: 'crewmates' | 'impostors', reason: string): void {
    this.phase = GamePhase.Ended;

    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
      this.gameLoopInterval = null;
    }

    this.broadcastGameState();
    this.notifyGameEnded(winner, reason);
  }

  private broadcastGameState(): void {
    const state: WorkerGameState = {
      gameId: this.config.gameId,
      phase: this.phase,
      round: this.round,
      phaseEndTime: this.phaseEndTime,
      players: this.players,
      deadBodies: this.deadBodies,
      myLocation: Location.Cafeteria, // Will be overridden per-agent
      activeSabotage: this.activeSabotage,
    };

    // Update each registered agent with their location
    for (const agentAddress of this.registeredAgents) {
      const player = this.players.find((p) => p.address === agentAddress);
      if (player) {
        this.updateGameState({
          ...state,
          myLocation: player.location,
        });
      }
    }
  }
}
