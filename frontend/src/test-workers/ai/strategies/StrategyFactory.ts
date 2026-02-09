// Strategy Factory - Creates Decision Engines for Different Strategies

import { StrategyType } from '../../config/WorkerConfig';
import { IDecisionEngine } from '../DecisionEngine';
import { RandomStrategy } from './RandomStrategy';
import { AggressiveStrategy } from './AggressiveStrategy';
import { PassiveStrategy } from './PassiveStrategy';
import { StealthStrategy } from './StealthStrategy';
import { TaskFocusedStrategy } from './TaskFocusedStrategy';
import { DetectiveStrategy } from './DetectiveStrategy';

export class StrategyFactory {
  private static instances: Map<string, IDecisionEngine> = new Map();

  /**
   * Create a new decision engine for the given strategy.
   * Each call returns a new instance.
   */
  static create(strategy: StrategyType): IDecisionEngine {
    switch (strategy) {
      case 'random':
        return new RandomStrategy();
      case 'aggressive':
        return new AggressiveStrategy();
      case 'passive':
        return new PassiveStrategy();
      case 'stealth':
        return new StealthStrategy();
      case 'task-focused':
        return new TaskFocusedStrategy();
      case 'detective':
        return new DetectiveStrategy();
      default:
        console.warn(`Unknown strategy: ${strategy}, falling back to random`);
        return new RandomStrategy();
    }
  }

  /**
   * Get or create a singleton instance for the given strategy and agent.
   * Useful for maintaining state across decisions.
   */
  static getOrCreate(
    strategy: StrategyType,
    agentAddress: `0x${string}`
  ): IDecisionEngine {
    const key = `${strategy}-${agentAddress}`;

    if (!this.instances.has(key)) {
      const engine = this.create(strategy);
      engine.init(strategy, agentAddress);
      this.instances.set(key, engine);
    }

    return this.instances.get(key)!;
  }

  /**
   * Clear all cached instances.
   */
  static clearCache(): void {
    this.instances.clear();
  }

  /**
   * Reset a specific agent's engine.
   */
  static reset(agentAddress: `0x${string}`): void {
    for (const [key, engine] of this.instances) {
      if (key.endsWith(agentAddress)) {
        engine.reset();
        this.instances.delete(key);
      }
    }
  }

  /**
   * Get strategy description for logging.
   */
  static getDescription(strategy: StrategyType): string {
    const descriptions: Record<StrategyType, string> = {
      random: 'Makes random decisions - useful as a baseline',
      aggressive: 'Impostor: Quick kills, takes risks, prioritizes eliminations',
      stealth: 'Impostor: Careful kills, builds alibis, avoids suspicion',
      passive: 'Crewmate: Focuses on survival, avoids conflict',
      'task-focused': 'Crewmate: Prioritizes task completion above all',
      detective: 'Crewmate: Gathers info, tracks player movements, reports suspicious behavior',
    };

    return descriptions[strategy] || 'Unknown strategy';
  }

  /**
   * Check if a strategy is valid for a given role.
   */
  static isValidForRole(
    strategy: StrategyType,
    role: 'Crewmate' | 'Impostor'
  ): boolean {
    const impostorStrategies: StrategyType[] = ['aggressive', 'stealth', 'random'];
    const crewmateStrategies: StrategyType[] = ['passive', 'task-focused', 'detective', 'random'];

    if (role === 'Impostor') {
      return impostorStrategies.includes(strategy);
    } else {
      return crewmateStrategies.includes(strategy);
    }
  }
}
