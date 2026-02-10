// Stealth Impostor Strategy

import { Role, GamePhase, Location } from '@/types/game';
import {
  BaseDecisionEngine,
  DecisionContext,
  DecisionResult,
} from '../DecisionEngine';
import { WorkerActionType } from '../../workers/WorkerMessage';

/**
 * Stealth Strategy (Impostor)
 *
 * - Only kills when completely alone with target
 * - Builds alibis by being seen doing "tasks"
 * - Never sabotages (too suspicious)
 * - Votes carefully to blend in
 * - Patient - waits for perfect opportunities
 */
export class StealthStrategy extends BaseDecisionEngine {
  private killCooldown: number = 0;
  private lastKillTime: number = 0;
  private readonly KILL_COOLDOWN_MS = 15000; // 15 seconds (longer than aggressive)
  private alibiLocation: Location | null = null;
  private alibiWitnesses: Set<`0x${string}`> = new Set();

  decide(context: DecisionContext): DecisionResult {
    const { phase, role } = context;

    if (role !== Role.Impostor) {
      console.warn('Stealth strategy used for non-impostor');
      return this.blendInBehavior(context);
    }

    if (phase === GamePhase.Voting) {
      return this.decideVote(context);
    }

    const now = Date.now();
    this.killCooldown = Math.max(0, this.KILL_COOLDOWN_MS - (now - this.lastKillTime));

    // Priority: Safe kill > Build alibi > Blend in
    return this.decideAction(context);
  }

  private decideAction(context: DecisionContext): DecisionResult {
    const { availableActions, gameState, agentAddress } = context;

    const playersHere = this.getPlayersInLocation(
      gameState.players,
      gameState.myLocation,
      agentAddress
    );

    const adjacentRooms = this.getAdjacentRooms(gameState.myLocation);
    const playersNearby = gameState.players.filter(
      (p) =>
        p.isAlive &&
        p.address !== agentAddress &&
        adjacentRooms.includes(p.location)
    );

    // Track who sees us (for alibi)
    for (const p of playersHere) {
      this.alibiWitnesses.add(p.address);
    }

    // 1. Only kill if COMPLETELY safe
    if (
      this.killCooldown <= 0 &&
      this.canPerformAction(availableActions, WorkerActionType.KILL) &&
      playersHere.length === 1 && // Only target present
      playersNearby.length === 0   // No one can walk in
    ) {
      const killAction = this.findActionOfType(availableActions, WorkerActionType.KILL);
      const target = killAction?.targets?.[0];

      if (target) {
        this.lastKillTime = Date.now();
        this.alibiWitnesses.clear(); // Reset alibi

        return {
          action: this.createKillAction(target),
          reasoning: `Perfect opportunity: alone with ${target}, no witnesses nearby`,
          confidence: 0.95,
        };
      }
    }

    // 2. Build alibi - be seen by crewmates
    if (playersHere.length === 0 || this.alibiWitnesses.size < 2) {
      const moveResult = this.moveToAlibi(context);
      if (moveResult) return moveResult;
    }

    // 3. Pretend to do tasks (blend in)
    if (playersHere.length > 0 && this.canPerformAction(availableActions, WorkerActionType.WAIT)) {
      // Just stand near a task location to look busy
      this.alibiLocation = gameState.myLocation;

      return {
        action: this.createWaitAction(),
        reasoning: `Blending in at ${Location[gameState.myLocation]} with ${playersHere.length} witnesses`,
        confidence: 0.8,
      };
    }

    // 4. Move to find opportunities
    return this.huntCarefully(context);
  }

  private moveToAlibi(context: DecisionContext): DecisionResult | null {
    const { availableActions, gameState, agentAddress } = context;

    if (!this.canPerformAction(availableActions, WorkerActionType.MOVE)) {
      return null;
    }

    const moveAction = this.findActionOfType(availableActions, WorkerActionType.MOVE);
    const locations = moveAction?.locations || [];

    // Find location with 2-3 players (good for alibi, but not too crowded)
    const scored: Array<{ loc: Location; score: number }> = [];

    for (const loc of locations) {
      const players = gameState.players.filter(
        (p) => p.isAlive && p.location === loc && p.address !== agentAddress
      ).length;

      let score = 0;
      if (players >= 2 && players <= 3) {
        score = 10; // Ideal for alibi
      } else if (players === 1) {
        score = 3; // Possible kill opportunity later
      } else if (players > 3) {
        score = 5; // Too many witnesses but safe
      }

      scored.push({ loc, score });
    }

    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best && best.score > 0) {
      return {
        action: this.createMoveAction(best.loc),
        reasoning: `Moving to ${Location[best.loc]} to build alibi (score: ${best.score})`,
        confidence: 0.7,
      };
    }

    return null;
  }

  private huntCarefully(context: DecisionContext): DecisionResult {
    const { availableActions, gameState, agentAddress } = context;

    if (!this.canPerformAction(availableActions, WorkerActionType.MOVE)) {
      return {
        action: this.createWaitAction(),
        reasoning: 'Cannot move, waiting',
        confidence: 0.5,
      };
    }

    const moveAction = this.findActionOfType(availableActions, WorkerActionType.MOVE);
    const locations = moveAction?.locations || [];

    // Look for isolated players (potential future targets)
    const opportunities: Array<{ loc: Location; isolatedCount: number }> = [];

    for (const loc of locations) {
      const players = gameState.players.filter(
        (p) => p.isAlive && p.location === loc && p.address !== agentAddress
      );

      if (players.length === 1) {
        // Check if that player is truly isolated
        const theirAdjacent = this.getAdjacentRooms(loc);
        const nearbyToThem = gameState.players.filter(
          (p) =>
            p.isAlive &&
            p.address !== agentAddress &&
            p.address !== players[0].address &&
            theirAdjacent.includes(p.location)
        ).length;

        if (nearbyToThem === 0) {
          opportunities.push({ loc, isolatedCount: 1 });
        }
      }
    }

    // Move towards isolated player if found
    if (opportunities.length > 0) {
      const target = this.pickRandom(opportunities);
      if (target) {
        return {
          action: this.createMoveAction(target.loc),
          reasoning: `Stalking isolated player at ${Location[target.loc]}`,
          confidence: 0.7,
        };
      }
    }

    // Otherwise patrol randomly
    const randomLoc = this.pickRandom(locations);
    if (randomLoc !== undefined) {
      return {
        action: this.createMoveAction(randomLoc),
        reasoning: `Patrolling to ${Location[randomLoc]}`,
        confidence: 0.5,
      };
    }

    return {
      action: this.createWaitAction(),
      reasoning: 'No good movement options',
      confidence: 0.4,
    };
  }

  private decideVote(context: DecisionContext): DecisionResult {
    const { gameState, agentAddress, teammates } = context;
    const alivePlayers = this.getAlivePlayers(gameState.players, agentAddress);

    // Never vote for teammates
    const nonTeammates = alivePlayers.filter(
      (p) => !teammates.includes(p.address)
    );

    if (nonTeammates.length === 0) {
      return {
        action: this.createSkipAction(),
        reasoning: 'Only teammates remain',
        confidence: 0.9,
      };
    }

    // Stealth: blend in with the crowd
    // Vote with what seems like consensus, or skip if unsure

    // Simple heuristic: skip 40% of the time to seem thoughtful
    if (Math.random() < 0.4) {
      return {
        action: this.createSkipAction(),
        reasoning: 'Skipping to seem thoughtful and avoid suspicion',
        confidence: 0.7,
      };
    }

    // Vote for a random crewmate (try to frame them)
    const target = this.pickRandom(nonTeammates);
    if (target) {
      return {
        action: this.createVoteAction(target.address),
        reasoning: `Voting for ${target.address} to blend in`,
        confidence: 0.6,
      };
    }

    return {
      action: this.createSkipAction(),
      reasoning: 'No valid vote target',
      confidence: 0.5,
    };
  }

  private blendInBehavior(context: DecisionContext): DecisionResult {
    const { availableActions } = context;

    if (this.canPerformAction(availableActions, WorkerActionType.COMPLETE_TASK)) {
      const taskAction = this.findActionOfType(availableActions, WorkerActionType.COMPLETE_TASK);
      const taskId = this.pickRandom(taskAction?.taskIds || []);
      if (taskId) {
        return {
          action: this.createTaskAction(taskId),
          reasoning: 'Doing tasks (not an impostor)',
          confidence: 0.7,
        };
      }
    }

    return {
      action: this.createWaitAction(),
      reasoning: 'Waiting',
      confidence: 0.5,
    };
  }
}
