// Decision Logger - Specialized logger for AI agent decisions

import { AgentDecision } from '../config/WorkerConfig';
import { GamePhase, Location, PlayerColors } from '@/types/game';

export interface DecisionSummary {
  totalDecisions: number;
  decisionsByPhase: Record<string, number>;
  decisionsByAction: Record<string, number>;
  decisionsByAgent: Record<`0x${string}`, number>;
  averageConfidence: number;
  averageDecisionTime: number;
}

export interface AgentProfile {
  agentAddress: `0x${string}`;
  totalDecisions: number;
  actionDistribution: Record<string, number>;
  averageConfidence: number;
  decisionTimeline: Array<{ timestamp: number; action: string }>;
}

export class DecisionLogger {
  private decisions: AgentDecision[] = [];
  private maxDecisions: number;

  constructor(maxDecisions: number = 5000) {
    this.maxDecisions = maxDecisions;
  }

  // ============ Add Decisions ============

  log(decision: AgentDecision): void {
    this.decisions.push(decision);

    // Trim if over limit
    if (this.decisions.length > this.maxDecisions) {
      this.decisions = this.decisions.slice(-this.maxDecisions);
    }
  }

  logBatch(decisions: AgentDecision[]): void {
    for (const decision of decisions) {
      this.log(decision);
    }
  }

  // ============ Query Decisions ============

  getAll(): AgentDecision[] {
    return [...this.decisions];
  }

  getByAgent(agentAddress: `0x${string}`): AgentDecision[] {
    return this.decisions.filter((d) => d.agentAddress === agentAddress);
  }

  getByPhase(phase: string): AgentDecision[] {
    return this.decisions.filter((d) => d.phase === phase);
  }

  getByAction(action: string): AgentDecision[] {
    return this.decisions.filter((d) => d.action === action);
  }

  getRecent(count: number): AgentDecision[] {
    return this.decisions.slice(-count);
  }

  // ============ Analysis ============

  getSummary(): DecisionSummary {
    const summary: DecisionSummary = {
      totalDecisions: this.decisions.length,
      decisionsByPhase: {},
      decisionsByAction: {},
      decisionsByAgent: {},
      averageConfidence: 0,
      averageDecisionTime: 0,
    };

    if (this.decisions.length === 0) return summary;

    let totalConfidence = 0;
    let totalTime = 0;
    let timeCount = 0;

    for (const decision of this.decisions) {
      // By phase
      summary.decisionsByPhase[decision.phase] =
        (summary.decisionsByPhase[decision.phase] || 0) + 1;

      // By action
      summary.decisionsByAction[decision.action] =
        (summary.decisionsByAction[decision.action] || 0) + 1;

      // By agent
      summary.decisionsByAgent[decision.agentAddress] =
        (summary.decisionsByAgent[decision.agentAddress] || 0) + 1;

      // Confidence
      const confidence = decision.context?.confidence as number | undefined;
      if (confidence !== undefined) {
        totalConfidence += confidence;
      }

      // Decision time
      const decisionTime = decision.context?.decisionTimeMs as number | undefined;
      if (decisionTime !== undefined) {
        totalTime += decisionTime;
        timeCount++;
      }
    }

    summary.averageConfidence = totalConfidence / this.decisions.length;
    summary.averageDecisionTime = timeCount > 0 ? totalTime / timeCount : 0;

    return summary;
  }

  getAgentProfile(agentAddress: `0x${string}`): AgentProfile {
    const agentDecisions = this.getByAgent(agentAddress);

    const profile: AgentProfile = {
      agentAddress,
      totalDecisions: agentDecisions.length,
      actionDistribution: {},
      averageConfidence: 0,
      decisionTimeline: [],
    };

    if (agentDecisions.length === 0) return profile;

    let totalConfidence = 0;

    for (const decision of agentDecisions) {
      // Action distribution
      profile.actionDistribution[decision.action] =
        (profile.actionDistribution[decision.action] || 0) + 1;

      // Confidence
      const confidence = decision.context?.confidence as number | undefined;
      if (confidence !== undefined) {
        totalConfidence += confidence;
      }

      // Timeline
      profile.decisionTimeline.push({
        timestamp: decision.timestamp,
        action: decision.action,
      });
    }

    profile.averageConfidence = totalConfidence / agentDecisions.length;

    return profile;
  }

  // ============ Export ============

  toJSON(): string {
    return JSON.stringify(this.decisions, null, 2);
  }

  toHumanReadable(): string {
    const lines: string[] = [];

    for (const decision of this.decisions) {
      const time = new Date(decision.timestamp).toISOString();
      const agent = this.formatAgentAddress(decision.agentAddress);
      const confidence = decision.context?.confidence as number | undefined;
      const confStr = confidence !== undefined ? ` (${(confidence * 100).toFixed(0)}%)` : '';

      lines.push(`[${time}] ${agent} in ${decision.phase}: ${decision.action}${confStr}`);

      if (decision.reasoning) {
        lines.push(`  Reasoning: ${decision.reasoning}`);
      }
    }

    return lines.join('\n');
  }

  toSummaryReport(): string {
    const summary = this.getSummary();
    const lines: string[] = [
      '=== DECISION SUMMARY ===',
      `Total Decisions: ${summary.totalDecisions}`,
      `Average Confidence: ${(summary.averageConfidence * 100).toFixed(1)}%`,
      `Average Decision Time: ${summary.averageDecisionTime.toFixed(1)}ms`,
      '',
      '--- Decisions by Phase ---',
    ];

    for (const [phase, count] of Object.entries(summary.decisionsByPhase)) {
      lines.push(`  ${phase}: ${count}`);
    }

    lines.push('', '--- Decisions by Action ---');
    for (const [action, count] of Object.entries(summary.decisionsByAction)) {
      const pct = ((count / summary.totalDecisions) * 100).toFixed(1);
      lines.push(`  ${action}: ${count} (${pct}%)`);
    }

    lines.push('', '--- Decisions by Agent ---');
    for (const [agent, count] of Object.entries(summary.decisionsByAgent)) {
      const pct = ((count / summary.totalDecisions) * 100).toFixed(1);
      lines.push(`  ${this.formatAgentAddress(agent as `0x${string}`)}: ${count} (${pct}%)`);
    }

    return lines.join('\n');
  }

  // ============ Management ============

  clear(): void {
    this.decisions = [];
  }

  // ============ Private Methods ============

  private formatAgentAddress(address: `0x${string}`): string {
    // Try to get color name from address
    const index = parseInt(address.slice(2), 16) - 1;
    if (index >= 0 && index < 12) {
      return PlayerColors[index]?.name || address.slice(0, 10);
    }
    return address.slice(0, 10);
  }
}
