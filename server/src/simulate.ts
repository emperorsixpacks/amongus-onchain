import "dotenv/config";
import { AgentSimulator } from "./AgentSimulator.js";
import { logger } from "./logger.js";

// Parse command line arguments
const args = process.argv.slice(2);
const roomId = args[0]; // Optional: join specific room, otherwise wait for rooms
const agentCount = parseInt(args[1] || "6", 10);
const impostorCount = parseInt(args[2] || "1", 10);

const serverUrl = process.env.WS_URL || "ws://localhost:8082";

logger.info(`Starting agent simulation`);
logger.info(`  Server: ${serverUrl}`);
logger.info(`  Room ID: ${roomId || "(waiting for rooms)"}`);
logger.info(`  Agents: ${agentCount}`);
logger.info(`  Impostors: ${impostorCount}`);

const simulator = new AgentSimulator({
  serverUrl,
  roomId,
  agentCount,
  impostorCount,
  moveInterval: 3000,
  taskInterval: 5000,
  killInterval: 8000,
});

// Handle graceful shutdown
process.on("SIGINT", () => {
  logger.info("Received SIGINT, stopping simulation...");
  simulator.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, stopping simulation...");
  simulator.stop();
  process.exit(0);
});

// Start simulation
simulator.start().then(() => {
  logger.info("Simulation running. Press Ctrl+C to stop.");

  // Log state periodically
  setInterval(() => {
    const state = simulator.getState();
    const alive = state.agents.filter((a) => a.isAlive).length;
    const tasks = state.agents.reduce((sum, a) => sum + a.tasksCompleted, 0);
    const totalTasks = state.agents.length * 5;
    logger.info(`Status: ${alive}/${state.agents.length} alive, ${tasks}/${totalTasks} tasks`);
  }, 10000);
}).catch((error) => {
  logger.error(`Failed to start simulation: ${error}`);
  process.exit(1);
});
