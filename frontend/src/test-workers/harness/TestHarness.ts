// Test Harness - Orchestrates test runs

import {
  TestScenarioConfig,
  TestResult,
  TestAssertionResult,
  WorkerInitConfig,
  TestLog,
  AgentDecision,
} from '../config/WorkerConfig';
import { MockGameServer, MockGameServerConfig } from '../connection/MockGameServer';
import { IGameConnection, GameConnectionCallbacks } from '../connection/GameConnection';
import { WorkerAgent, WorkerAgentCallbacks } from '../workers/WorkerAgent';
import { WorkerAction, WorkerActionType, WorkerGameState } from '../workers/WorkerMessage';
import { LogAggregator } from '../logging/LogAggregator';
import { DecisionLogger } from '../logging/DecisionLogger';
import { GamePhase, Role, Location, PlayerColors } from '@/types/game';

export interface TestHarnessOptions {
  verbose?: boolean;
  logToConsole?: boolean;
}

export interface TestRunResult {
  scenario: TestScenarioConfig;
  testResult: TestResult;
  assertions: TestAssertionResult[];
  passed: boolean;
  duration: number;
}

export class TestHarness {
  private options: TestHarnessOptions;
  private logAggregator: LogAggregator;
  private decisionLogger: DecisionLogger;

  constructor(options: TestHarnessOptions = {}) {
    this.options = {
      verbose: false,
      logToConsole: true,
      ...options,
    };

    this.logAggregator = new LogAggregator();
    this.decisionLogger = new DecisionLogger();
  }

  // ============ Public API ============

  async runScenario(scenario: TestScenarioConfig): Promise<TestRunResult> {
    const startTime = Date.now();

    this.log('info', `Starting scenario: ${scenario.name}`);

    // Reset loggers
    this.logAggregator.clear();
    this.decisionLogger.clear();

    // Create test result collector
    const result: TestResult = {
      gameId: `test-${Date.now()}`,
      finalState: null,
      killCount: 0,
      ejectionCount: 0,
      tasksCompleted: 0,
      roundsPlayed: 0,
      duration: 0,
      logs: [],
      agentDecisions: [],
    };

    // Create agents
    const agents: WorkerAgent[] = [];
    const agentCallbacks: WorkerAgentCallbacks = {
      onAction: (action) => this.handleAction(result, action),
      onDecision: (decision) => {
        result.agentDecisions.push(decision);
        this.decisionLogger.log(decision);
      },
      onLog: (log) => {
        result.logs.push(log);
        this.logAggregator.add(log);
      },
      onError: (error) => this.log('error', error),
    };

    for (let i = 0; i < scenario.agents.length; i++) {
      const config = scenario.agents[i];
      const agentAddress = this.generateAddress(i);

      const initConfig: WorkerInitConfig = {
        workerId: `agent-${i}`,
        agentAddress,
        gameId: result.gameId,
        colorId: config.colorId,
        strategy: config.strategy,
        serverUrl: 'mock',
      };

      const agent = new WorkerAgent(initConfig, agentCallbacks);
      agents.push(agent);
    }

    // Create mock game server
    const serverConfig: MockGameServerConfig = {
      gameId: result.gameId,
      agents: scenario.agents,
      settings: scenario.gameSettings,
    };

    const gameCallbacks: GameConnectionCallbacks = {
      onGameStateUpdate: (state) => this.handleGameStateUpdate(agents, state, result),
      onRoleAssigned: (addr, role, teammates) => this.handleRoleAssigned(agents, addr, role, teammates),
      onActionRequest: (addr, phase, deadline) => this.handleActionRequest(agents, addr, phase, deadline),
      onVotingStarted: (duration, alivePlayers) => this.log('info', `Voting started: ${alivePlayers.length} alive`),
      onGameEnded: (winner, reason) => this.handleGameEnded(result, winner, reason),
      onError: (error) => this.log('error', error),
    };

    const server = new MockGameServer(serverConfig, gameCallbacks);

    // Run game
    try {
      // Connect and register agents
      await server.connect();

      for (let i = 0; i < agents.length; i++) {
        await server.registerAgent(this.generateAddress(i));
        agents[i].start();
      }

      // Start game
      server.startGame();

      // Wait for game to complete or timeout
      await this.waitForCompletion(result, scenario.timeout);
    } catch (error) {
      this.log('error', `Test error: ${error}`);
    } finally {
      // Cleanup
      for (const agent of agents) {
        agent.stop();
      }
      server.disconnect();
    }

    // Calculate duration
    result.duration = Date.now() - startTime;

    // Run assertions
    const assertions = this.runAssertions(scenario.assertions, result);
    const passed = assertions.every((a) => a.passed);

    this.log('info', `Scenario ${scenario.name}: ${passed ? 'PASSED' : 'FAILED'}`);
    this.logAssertionResults(assertions);

    return {
      scenario,
      testResult: result,
      assertions,
      passed,
      duration: result.duration,
    };
  }

  async runScenarios(scenarios: TestScenarioConfig[]): Promise<TestRunResult[]> {
    const results: TestRunResult[] = [];

    for (const scenario of scenarios) {
      const result = await this.runScenario(scenario);
      results.push(result);
    }

    // Summary
    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;

    this.log('info', `\n========== TEST SUMMARY ==========`);
    this.log('info', `Total: ${results.length}, Passed: ${passed}, Failed: ${failed}`);

    for (const result of results) {
      const status = result.passed ? 'PASS' : 'FAIL';
      this.log('info', `  [${status}] ${result.scenario.name} (${result.duration}ms)`);
    }

    return results;
  }

  // ============ Private Methods ============

  private handleAction(result: TestResult, action: WorkerAction): void {
    switch (action.type) {
      case WorkerActionType.KILL:
        result.killCount++;
        break;
      case WorkerActionType.COMPLETE_TASK:
        result.tasksCompleted++;
        break;
    }
  }

  private handleGameStateUpdate(
    agents: WorkerAgent[],
    state: WorkerGameState,
    result: TestResult
  ): void {
    result.roundsPlayed = state.round;

    // Update each agent with state
    for (let i = 0; i < agents.length; i++) {
      const agentAddress = this.generateAddress(i);
      const player = state.players.find((p) => p.address === agentAddress);

      if (player) {
        agents[i].updateGameState({
          ...state,
          myLocation: player.location,
        });
      }
    }
  }

  private handleRoleAssigned(
    agents: WorkerAgent[],
    agentAddress: `0x${string}`,
    role: Role,
    teammates: `0x${string}`[]
  ): void {
    const index = this.getAgentIndex(agentAddress);
    if (index >= 0 && index < agents.length) {
      agents[index].setRole(role, teammates);
    }
  }

  private handleActionRequest(
    agents: WorkerAgent[],
    agentAddress: `0x${string}`,
    phase: GamePhase,
    deadline: number
  ): void {
    const index = this.getAgentIndex(agentAddress);
    if (index >= 0 && index < agents.length) {
      agents[index].requestAction(phase, deadline);
    }
  }

  private handleGameEnded(
    result: TestResult,
    winner: 'crewmates' | 'impostors',
    reason: string
  ): void {
    result.finalState = {
      phase: 'Ended',
      winner,
      reason,
    };

    this.log('info', `Game ended: ${winner} win (${reason})`);
  }

  private async waitForCompletion(result: TestResult, timeout: number): Promise<void> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (result.finalState || Date.now() - startTime >= timeout) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }

  private runAssertions(
    assertions: TestScenarioConfig['assertions'],
    result: TestResult
  ): TestAssertionResult[] {
    return assertions.map((assertion) => {
      let passed = false;
      try {
        passed = assertion.check(result);
      } catch (error) {
        passed = false;
      }

      return {
        name: assertion.name,
        passed,
        message: passed ? undefined : assertion.message,
      };
    });
  }

  private logAssertionResults(assertions: TestAssertionResult[]): void {
    for (const assertion of assertions) {
      const status = assertion.passed ? 'PASS' : 'FAIL';
      const msg = assertion.message ? ` - ${assertion.message}` : '';
      this.log('info', `  [${status}] ${assertion.name}${msg}`);
    }
  }

  private generateAddress(index: number): `0x${string}` {
    return `0x${(index + 1).toString().padStart(40, '0')}` as `0x${string}`;
  }

  private getAgentIndex(address: `0x${string}`): number {
    // Parse the address to get the index
    const num = parseInt(address.slice(2), 16);
    return num - 1;
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    if (this.options.logToConsole) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
    }

    this.logAggregator.add({
      timestamp: Date.now(),
      level,
      source: 'harness',
      message,
    });
  }
}
