"use client";

import { useState, useEffect, useCallback } from "react";
import { TestHarness, TestRunResult } from "@/test-workers/harness/TestHarness";
import {
  QUICK_TEST,
  STANDARD_6_PLAYER,
  AGGRESSIVE_IMPOSTOR,
  ALL_BASIC_SCENARIOS,
} from "@/test-workers/config/scenarios/basic-game";
import { TestScenarioConfig } from "@/test-workers/config/WorkerConfig";

export default function TestPage() {
  const [results, setResults] = useState<TestRunResult[]>([]);
  const [running, setRunning] = useState(false);
  const [currentScenario, setCurrentScenario] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = useCallback((message: string) => {
    setLogs((prev) => [...prev.slice(-100), `[${new Date().toISOString()}] ${message}`]);
  }, []);

  const runScenario = async (scenario: TestScenarioConfig) => {
    setRunning(true);
    setCurrentScenario(scenario.name);
    addLog(`Starting scenario: ${scenario.name}`);

    const harness = new TestHarness({
      verbose: true,
      logToConsole: false,
    });

    try {
      const result = await harness.runScenario(scenario);
      setResults((prev) => [...prev, result]);

      if (result.passed) {
        addLog(`✅ ${scenario.name} PASSED (${result.duration}ms)`);
      } else {
        addLog(`❌ ${scenario.name} FAILED (${result.duration}ms)`);
        result.assertions.forEach((a) => {
          if (!a.passed) {
            addLog(`   - ${a.name}: ${a.message || "Failed"}`);
          }
        });
      }
    } catch (error) {
      addLog(`❌ ${scenario.name} ERROR: ${error}`);
    }

    setRunning(false);
    setCurrentScenario(null);
  };

  const runAllBasic = async () => {
    setResults([]);
    for (const scenario of ALL_BASIC_SCENARIOS) {
      await runScenario(scenario);
    }
  };

  const clearResults = () => {
    setResults([]);
    setLogs([]);
  };

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <h1 className="text-3xl font-bold mb-6">Among Us Test Workers</h1>

      {/* Controls */}
      <div className="flex gap-4 mb-8">
        <button
          onClick={() => runScenario(QUICK_TEST)}
          disabled={running}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded font-bold"
        >
          Quick Test
        </button>
        <button
          onClick={() => runScenario(STANDARD_6_PLAYER)}
          disabled={running}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded font-bold"
        >
          Standard 6-Player
        </button>
        <button
          onClick={() => runScenario(AGGRESSIVE_IMPOSTOR)}
          disabled={running}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 rounded font-bold"
        >
          Aggressive Impostor
        </button>
        <button
          onClick={runAllBasic}
          disabled={running}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded font-bold"
        >
          Run All Basic
        </button>
        <button
          onClick={clearResults}
          disabled={running}
          className="px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-600 rounded font-bold"
        >
          Clear
        </button>
      </div>

      {/* Status */}
      {running && (
        <div className="mb-6 p-4 bg-yellow-900/50 border border-yellow-600 rounded">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
            <span>Running: {currentScenario}</span>
          </div>
        </div>
      )}

      {/* Summary */}
      {results.length > 0 && (
        <div className="mb-6 p-4 bg-gray-800 rounded">
          <h2 className="text-xl font-bold mb-2">Results Summary</h2>
          <div className="flex gap-6">
            <span>Total: {results.length}</span>
            <span className="text-green-400">Passed: {passedCount}</span>
            <span className="text-red-400">Failed: {failedCount}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Results */}
        <div className="bg-gray-800 rounded p-4">
          <h2 className="text-xl font-bold mb-4">Test Results</h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {results.map((result, i) => (
              <div
                key={i}
                className={`p-3 rounded ${
                  result.passed ? "bg-green-900/30 border border-green-700" : "bg-red-900/30 border border-red-700"
                }`}
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold">{result.scenario.name}</span>
                  <span className={result.passed ? "text-green-400" : "text-red-400"}>
                    {result.passed ? "PASS" : "FAIL"}
                  </span>
                </div>
                <div className="text-sm text-gray-400 space-y-1">
                  <div>Duration: {result.duration}ms</div>
                  <div>Rounds: {result.testResult.roundsPlayed}</div>
                  <div>Kills: {result.testResult.killCount}</div>
                  <div>Tasks: {result.testResult.tasksCompleted}</div>
                  <div>Decisions: {result.testResult.agentDecisions.length}</div>
                  {result.testResult.finalState && (
                    <div>
                      Winner: {result.testResult.finalState.winner || "N/A"} (
                      {result.testResult.finalState.reason || "N/A"})
                    </div>
                  )}
                </div>
                <div className="mt-2 text-sm">
                  <div className="font-medium mb-1">Assertions:</div>
                  {result.assertions.map((a, j) => (
                    <div key={j} className={a.passed ? "text-green-400" : "text-red-400"}>
                      {a.passed ? "✓" : "✗"} {a.name}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {results.length === 0 && (
              <div className="text-gray-500 text-center py-8">No tests run yet</div>
            )}
          </div>
        </div>

        {/* Logs */}
        <div className="bg-gray-800 rounded p-4">
          <h2 className="text-xl font-bold mb-4">Logs</h2>
          <div className="font-mono text-xs space-y-1 max-h-96 overflow-y-auto bg-black/50 p-3 rounded">
            {logs.map((log, i) => (
              <div key={i} className="text-gray-300">
                {log}
              </div>
            ))}
            {logs.length === 0 && (
              <div className="text-gray-500">Logs will appear here...</div>
            )}
          </div>
        </div>
      </div>

      {/* Decision Details */}
      {results.length > 0 && results[results.length - 1].testResult.agentDecisions.length > 0 && (
        <div className="mt-6 bg-gray-800 rounded p-4">
          <h2 className="text-xl font-bold mb-4">
            Recent Decisions ({results[results.length - 1].scenario.name})
          </h2>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-400">
                <tr>
                  <th className="p-2">Agent</th>
                  <th className="p-2">Phase</th>
                  <th className="p-2">Action</th>
                  <th className="p-2">Reasoning</th>
                </tr>
              </thead>
              <tbody>
                {results[results.length - 1].testResult.agentDecisions.slice(-20).map((d, i) => (
                  <tr key={i} className="border-t border-gray-700">
                    <td className="p-2 font-mono">{d.agentAddress.slice(0, 10)}</td>
                    <td className="p-2">{d.phase}</td>
                    <td className="p-2 font-bold">{d.action}</td>
                    <td className="p-2 text-gray-400">{d.reasoning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
