// Passive Crewmate Strategy

import { Role, GamePhase, Location } from '@/types/game';
import {
  BaseDecisionEngine,
  DecisionContext,
  DecisionResult,
} from '../DecisionEngine';
import { WorkerActionType } from '../../workers/WorkerMessage';

/**
 * Passive Strategy (Crewmate)
 *
 * - Focuses on survival and avoiding conflict
 * - Does tasks when safe
 * - Avoids isolated areas
 * - Reports bodies but doesn't actively hunt
 * - Votes cautiously (often skips)
 */
export class PassiveStrategy extends BaseDecisionEngine {
  private readonly SAFE_PLAYER_COUNT = 2; // Want at least 2 others nearby

  decide(context: DecisionContext): DecisionResult {
    const { phase, role } = context;

    // Verify we're a crewmate (or handle gracefully)
    if (role === Role.Impostor) {
      console.warn('Passive strategy used for impostor');
    }

    // Handle voting phase
    if (phase === GamePhase.Voting) {
      return this.decideVote(context);
    }

    // Priority: Report bodies > Stay safe > Do tasks carefully
    return this.decideAction(context);
  }

  private decideAction(context: DecisionContext): DecisionResult {
    const { availableActions, gameState, agentAddress } = context;

    // 1. Report any unreported bodies in current location
    if (this.canPerformAction(availableActions, WorkerActionType.REPORT_BODY)) {
      const bodies = gameState.deadBodies.filter(
        (b) => !b.reported && b.location === gameState.myLocation
      );

      if (bodies.length > 0) {
        return {
          action: this.createReportAction(bodies[0].victim),
          reasoning: `Found body of ${bodies[0].victim}, reporting immediately`,
          confidence: 0.95,
        };
      }
    }

    const playersHere = this.getPlayersInLocation(
      gameState.players,
      gameState.myLocation,
      agentAddress
    );

    // 2. If alone or with few people, move to safety
    if (playersHere.length < this.SAFE_PLAYER_COUNT) {
      const moveResult = this.moveToSafety(context);
      if (moveResult) return moveResult;
    }

    // 3. Do tasks if we feel safe enough
    if (
      playersHere.length >= this.SAFE_PLAYER_COUNT &&
      this.canPerformAction(availableActions, WorkerActionType.COMPLETE_TASK)
    ) {
      const taskAction = this.findActionOfType(availableActions, WorkerActionType.COMPLETE_TASK);
      const taskId = this.pickRandom(taskAction?.taskIds || []);

      if (taskId) {
        return {
          action: this.createTaskAction(taskId),
          reasoning: `Feeling safe with ${playersHere.length} others, doing task`,
          confidence: 0.7,
        };
      }
    }

    // 4. If unsafe and can't move, wait
    return {
      action: this.createWaitAction(),
      reasoning: `Waiting cautiously (${playersHere.length} players nearby)`,
      confidence: 0.5,
    };
  }

  private moveToSafety(context: DecisionContext): DecisionResult | null {
    const { availableActions, gameState, agentAddress } = context;

    if (!this.canPerformAction(availableActions, WorkerActionType.MOVE)) {
      return null;
    }

    const moveAction = this.findActionOfType(availableActions, WorkerActionType.MOVE);
    const locations = moveAction?.locations || [];

    if (locations.length === 0) return null;

    // Find the safest location (most other players)
    const locationScores: Array<{ location: Location; score: number }> = [];

    for (const loc of locations) {
      const playersAtLoc = gameState.players.filter(
        (p) => p.isAlive && p.location === loc && p.address !== agentAddress
      ).length;

      // Score: prefer locations with 2-4 players (too many could include impostor)
      let score = playersAtLoc;
      if (playersAtLoc >= 2 && playersAtLoc <= 4) {
        score += 3; // Bonus for ideal range
      }

      locationScores.push({ location: loc, score });
    }

    // Sort by score descending
    locationScores.sort((a, b) => b.score - a.score);

    // Pick the safest location
    const safest = locationScores[0];
    if (safest && safest.score > 0) {
      return {
        action: this.createMoveAction(safest.location),
        reasoning: `Moving to ${Location[safest.location]} for safety (score: ${safest.score})`,
        confidence: 0.8,
      };
    }

    // If all locations seem empty, pick random (might as well move)
    const randomLoc = this.pickRandom(locations);
    if (randomLoc !== undefined) {
      return {
        action: this.createMoveAction(randomLoc),
        reasoning: `No safe location found, moving randomly to ${Location[randomLoc]}`,
        confidence: 0.4,
      };
    }

    return null;
  }

  private decideVote(context: DecisionContext): DecisionResult {
    const { gameState, agentAddress } = context;

    // Passive crewmates are cautious voters
    // They skip more often than they accuse

    const alivePlayers = this.getAlivePlayers(gameState.players, agentAddress);

    // Check suspicion levels from memory
    const suspicious: Array<{ address: `0x${string}`; level: number }> = [];

    for (const player of alivePlayers) {
      const level = this.memory.suspicionLevels.get(player.address) || 0;
      if (level > 50) {
        suspicious.push({ address: player.address, level });
      }
    }

    // Only vote if highly suspicious of someone
    if (suspicious.length > 0) {
      suspicious.sort((a, b) => b.level - a.level);
      const mostSuspicious = suspicious[0];

      return {
        action: this.createVoteAction(mostSuspicious.address),
        reasoning: `Voting for ${mostSuspicious.address} (suspicion: ${mostSuspicious.level})`,
        confidence: mostSuspicious.level / 100,
      };
    }

    // Otherwise, skip (cautious approach)
    return {
      action: this.createSkipAction(),
      reasoning: 'No strong suspicions, skipping vote',
      confidence: 0.7,
    };
  }

  // Override updateMemory to track suspicion
  updateMemory(
    gameState: Parameters<BaseDecisionEngine['updateMemory']>[0]
  ): void {
    super.updateMemory(gameState);

    // Increase suspicion for players who were alone with a victim
    for (const body of gameState.deadBodies) {
      if (!this.memory.bodiesFound.includes(body.victim)) {
        // New body discovered - who was nearby?
        const nearbyPlayers = gameState.players.filter(
          (p) =>
            p.isAlive &&
            p.location === body.location &&
            p.address !== body.victim
        );

        for (const suspect of nearbyPlayers) {
          const current = this.memory.suspicionLevels.get(suspect.address) || 0;
          this.memory.suspicionLevels.set(suspect.address, Math.min(100, current + 30));
        }
      }
    }
  }
}
