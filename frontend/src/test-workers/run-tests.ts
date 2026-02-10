#!/usr/bin/env npx tsx
// Test Runner Script for Agent Workers

import { TestHarness } from './harness/TestHarness';
import {
  ALL_SCENARIOS,
  ALL_BASIC_SCENARIOS,
  QUICK_TEST,
  STANDARD_6_PLAYER,
} from './config/scenarios/basic-game';

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const quick = args.includes('--quick') || args.includes('-q');
  const scenarioName = args.find((a) => !a.startsWith('-'));

  console.log('===========================================');
  console.log('  Among Us On-Chain - Test Worker Runner');
  console.log('===========================================\n');

  const harness = new TestHarness({
    verbose,
    logToConsole: true,
  });

  let scenarios;

  if (quick) {
    console.log('Running quick test...\n');
    scenarios = [QUICK_TEST];
  } else if (scenarioName) {
    const scenario = ALL_SCENARIOS.find(
      (s) => s.name.toLowerCase() === scenarioName.toLowerCase()
    );
    if (!scenario) {
      console.error(`Unknown scenario: ${scenarioName}`);
      console.log('\nAvailable scenarios:');
      for (const s of ALL_SCENARIOS) {
        console.log(`  - ${s.name}`);
      }
      process.exit(1);
    }
    scenarios = [scenario];
  } else {
    console.log('Running all basic scenarios...\n');
    scenarios = ALL_BASIC_SCENARIOS;
  }

  try {
    const results = await harness.runScenarios(scenarios);

    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;

    console.log('\n===========================================');
    console.log('  FINAL RESULTS');
    console.log('===========================================');
    console.log(`Total: ${results.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log('===========================================\n');

    // Exit with appropriate code
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Test run failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
main().catch(console.error);
