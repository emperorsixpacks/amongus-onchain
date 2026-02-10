// Detective Crewmate Strategy

import { Role, GamePhase, Location } from '@/types/game';
import {
  BaseDecisionEngine,
  DecisionContext,
  DecisionResult,
  AgentMemory,
} from '../DecisionEngine';
import { WorkerActionType, WorkerGameState } from '../../workers/WorkerMessage';

interface DetectiveMemory extends AgentMemory {
  // Track player movements
  movementHistory: Map<`0x${string}`, Array<{ location: Location; timestamp: number }>>;
  // Track who was with whom
  colocations: Map<string, number>; // "addr1-addr2" -> count
  // Body discovery info
  bodyDiscoveries: Array<{
    victim: `0x${string}`;
    location: Location;
    playersNearby: `0x${string}`[];
    timestamp: number;
  }>;
  // Vote patterns
  votePatterns: Map<`0x${string}`, Array<{ target: `0x${string}` | null; round: number }>>;
}

/**
 * Detective Strategy (Crewmate)
 *
 * - Actively investigates suspicious behavior
 * - Tracks player movements and patterns
 * - Reports bodies and analyzes crime scenes
 * - Votes based on gathered evidence
 * - Patrols high-traffic areas
 */
export class DetectiveStrategy extends BaseDecisionEngine {
  protected override memory: DetectiveMemory;

  private readonly SUSPICIOUS_THRESHOLD = 60;
  private readonly PATROL_LOCATIONS: Location[] = [
    Location.Cafeteria,
    Location.Admin,
    Location.Electrical,
    Location.Security,
  ];

  constructor() {
    super();
    this.memory = this.createDetectiveMemory();
  }

  private createDetectiveMemory(): DetectiveMemory {
    return {
      ...this.createEmptyMemory(),
      movementHistory: new Map(),
      colocations: new Map(),
      bodyDiscoveries: [],
      votePatterns: new Map(),
    };
  }

  decide(context: DecisionContext): DecisionResult {
    const { phase } = context;

    if (phase === GamePhase.Voting) {
      return this.decideVote(context);
    }

    return this.decideAction(context);
  }

  private decideAction(context: DecisionContext): DecisionResult {
    const { availableActions, gameState, agentAddress } = context;

    // 1. Report any bodies and analyze scene
    if (this.canPerformAction(availableActions, WorkerActionType.REPORT_BODY)) {
      const bodies = gameState.deadBodies.filter(
        (b) => !b.reported && b.location === gameState.myLocation
      );

      if (bodies.length > 0) {
        // Record who's at the crime scene
        const playersNearby = this.getPlayersInLocation(
          gameState.players,
          gameState.myLocation,
          agentAddress
        ).map((p) => p.address);

        this.memory.bodyDiscoveries.push({
          victim: bodies[0].victim,
          location: bodies[0].location,
          playersNearby,
          timestamp: Date.now(),
        });

        // Increase suspicion for players at crime scene
        for (const addr of playersNearby) {
          const current = this.memory.suspicionLevels.get(addr) || 0;
          this.memory.suspicionLevels.set(addr, Math.min(100, current + 25));
        }

        return {
          action: this.createReportAction(bodies[0].victim),
          reasoning: `Found body, ${playersNearby.length} suspects at scene`,
          confidence: 0.95,
        };
      }
    }

    // 2. Do tasks if safe (detectives still need to contribute)
    const playersHere = this.getPlayersInLocation(
      gameState.players,
      gameState.myLocation,
      agentAddress
    );

    if (
      playersHere.length >= 1 &&
      this.canPerformAction(availableActions, WorkerActionType.COMPLETE_TASK)
    ) {
      const taskAction = this.findActionOfType(availableActions, WorkerActionType.COMPLETE_TASK);
      const taskId = taskAction?.taskIds?.[0];

      if (taskId && Math.random() < 0.4) {
        // 40% chance to do task while observing
        return {
          action: this.createTaskAction(taskId),
          reasoning: `Completing task while observing ${playersHere.length} players`,
          confidence: 0.7,
        };
      }
    }

    // 3. Patrol and investigate
    return this.patrol(context);
  }

  private patrol(context: DecisionContext): DecisionResult {
    const { availableActions, gameState, agentAddress } = context;

    if (!this.canPerformAction(availableActions, WorkerActionType.MOVE)) {
      return {
        action: this.createWaitAction(),
        reasoning: 'Observing from current position',
        confidence: 0.6,
      };
    }

    const moveAction = this.findActionOfType(availableActions, WorkerActionType.MOVE);
    const adjacentLocations = moveAction?.locations || [];

    // Prioritize locations with suspicious players
    const suspiciousLocations: Array<{ loc: Location; suspicionSum: number }> = [];

    for (const loc of adjacentLocations) {
      const playersAtLoc = gameState.players.filter(
        (p) => p.isAlive && p.location === loc && p.address !== agentAddress
      );

      const suspicionSum = playersAtLoc.reduce(
        (sum, p) => sum + (this.memory.suspicionLevels.get(p.address) || 0),
        0
      );

      if (suspicionSum > 0) {
        suspiciousLocations.push({ loc, suspicionSum });
      }
    }

    // Follow most suspicious players
    if (suspiciousLocations.length > 0) {
      suspiciousLocations.sort((a, b) => b.suspicionSum - a.suspicionSum);
      const target = suspiciousLocations[0];

      return {
        action: this.createMoveAction(target.loc),
        reasoning: `Investigating suspicious activity at ${Location[target.loc]} (suspicion: ${target.suspicionSum})`,
        confidence: 0.8,
      };
    }

    // Patrol high-traffic areas
    const patrolTarget = this.PATROL_LOCATIONS.find((loc) =>
      adjacentLocations.includes(loc)
    );

    if (patrolTarget !== undefined) {
      return {
        action: this.createMoveAction(patrolTarget),
        reasoning: `Patrolling ${Location[patrolTarget]}`,
        confidence: 0.7,
      };
    }

    // Random patrol
    const randomLoc = this.pickRandom(adjacentLocations);
    if (randomLoc !== undefined) {
      return {
        action: this.createMoveAction(randomLoc),
        reasoning: `Patrolling to ${Location[randomLoc]}`,
        confidence: 0.5,
      };
    }

    return {
      action: this.createWaitAction(),
      reasoning: 'Maintaining position',
      confidence: 0.5,
    };
  }

  private decideVote(context: DecisionContext): DecisionResult {
    const { gameState, agentAddress } = context;
    const alivePlayers = this.getAlivePlayers(gameState.players, agentAddress);

    // Build case based on evidence
    const suspects: Array<{
      address: `0x${string}`;
      suspicion: number;
      evidence: string[];
    }> = [];

    for (const player of alivePlayers) {
      const suspicion = this.memory.suspicionLevels.get(player.address) || 0;
      const evidence: string[] = [];

      // Check body discovery evidence
      for (const discovery of this.memory.bodyDiscoveries) {
        if (discovery.playersNearby.includes(player.address)) {
          evidence.push(`Was at ${Location[discovery.location]} crime scene`);
        }
      }

      // Check movement patterns (player who moves a lot alone is suspicious)
      const history = this.memory.movementHistory.get(player.address) || [];
      if (history.length > 5) {
        evidence.push('Moves frequently');
      }

      if (suspicion > 0 || evidence.length > 0) {
        suspects.push({ address: player.address, suspicion, evidence });
      }
    }

    // Sort by suspicion
    suspects.sort((a, b) => b.suspicion - a.suspicion);

    // Vote for most suspicious if above threshold
    if (suspects.length > 0 && suspects[0].suspicion >= this.SUSPICIOUS_THRESHOLD) {
      const topSuspect = suspects[0];
      return {
        action: this.createVoteAction(topSuspect.address),
        reasoning: `Voting for ${topSuspect.address}: suspicion ${topSuspect.suspicion}, evidence: ${topSuspect.evidence.join(', ') || 'behavioral'}`,
        confidence: topSuspect.suspicion / 100,
      };
    }

    // Not enough evidence - skip
    return {
      action: this.createSkipAction(),
      reasoning: `Insufficient evidence (top suspicion: ${suspects[0]?.suspicion || 0})`,
      confidence: 0.7,
    };
  }

  override updateMemory(gameState: WorkerGameState): void {
    super.updateMemory(gameState);

    // Track all player movements
    for (const player of gameState.players) {
      if (player.isAlive) {
        const history = this.memory.movementHistory.get(player.address) || [];
        const lastEntry = history[history.length - 1];

        // Only add if location changed
        if (!lastEntry || lastEntry.location !== player.location) {
          history.push({ location: player.location, timestamp: Date.now() });

          // Keep only last 20 entries
          if (history.length > 20) {
            history.shift();
          }

          this.memory.movementHistory.set(player.address, history);
        }
      }
    }

    // Track colocations (who's together)
    const playersByLocation = new Map<Location, `0x${string}`[]>();

    for (const player of gameState.players) {
      if (player.isAlive) {
        const players = playersByLocation.get(player.location) || [];
        players.push(player.address);
        playersByLocation.set(player.location, players);
      }
    }

    for (const [, players] of playersByLocation) {
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          const key = [players[i], players[j]].sort().join('-');
          const count = this.memory.colocations.get(key) || 0;
          this.memory.colocations.set(key, count + 1);
        }
      }
    }

    // Increase suspicion for players who were last seen with victims
    for (const body of gameState.deadBodies) {
      if (!this.memory.bodiesFound.includes(body.victim)) {
        this.memory.bodiesFound.push(body.victim);

        // Find who was last seen with victim
        const victimHistory = this.memory.movementHistory.get(body.victim);
        if (victimHistory && victimHistory.length > 0) {
          const victimLastLoc = victimHistory[victimHistory.length - 1].location;

          for (const player of gameState.players) {
            if (
              player.isAlive &&
              player.address !== body.victim &&
              player.location === victimLastLoc
            ) {
              const current = this.memory.suspicionLevels.get(player.address) || 0;
              this.memory.suspicionLevels.set(player.address, Math.min(100, current + 35));
            }
          }
        }
      }
    }
  }

  override reset(): void {
    super.reset();
    this.memory = this.createDetectiveMemory();
  }
}
