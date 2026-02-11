"use strict";
/**
 * Run a match between multiple AI agents
 *
 * Usage:
 * npx ts-node src/run-match.ts
 *
 * Environment variables:
 * - RPC_URL: Monad RPC endpoint
 * - FACTORY_ADDRESS: AmongUsGameFactory contract address
 * - PRIVATE_KEY_1 through PRIVATE_KEY_6: Agent private keys
 */
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const Agent_js_1 = require("./core/Agent.js");
const viem_1 = require("viem");
const RPC_URL = process.env.RPC_URL || "http://localhost:8545";
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
const WAGER_AMOUNT = (0, viem_1.parseEther)(process.env.WAGER_AMOUNT || "0.01");
// Agent configurations with different strategies
const AGENT_CONFIGS = [
    {
        name: "Agent-Red",
        privateKey: process.env.PRIVATE_KEY_1,
        crewmateStyle: "task-focused",
        impostorStyle: "stealth",
    },
    {
        name: "Agent-Blue",
        privateKey: process.env.PRIVATE_KEY_2,
        crewmateStyle: "detective",
        impostorStyle: "aggressive",
    },
    {
        name: "Agent-Green",
        privateKey: process.env.PRIVATE_KEY_3,
        crewmateStyle: "group-safety",
        impostorStyle: "saboteur",
    },
    {
        name: "Agent-Yellow",
        privateKey: process.env.PRIVATE_KEY_4,
        crewmateStyle: "vigilante",
        impostorStyle: "social-manipulator",
    },
    {
        name: "Agent-Purple",
        privateKey: process.env.PRIVATE_KEY_5,
        crewmateStyle: "conservative",
        impostorStyle: "frame-game",
    },
    {
        name: "Agent-Orange",
        privateKey: process.env.PRIVATE_KEY_6,
        crewmateStyle: "task-focused",
        impostorStyle: "stealth",
    },
];
async function runMatch() {
    console.log("===========================================");
    console.log("   AMONG US ON-CHAIN - AI AGENT MATCH");
    console.log("===========================================\n");
    if (!FACTORY_ADDRESS) {
        console.error("Error: FACTORY_ADDRESS environment variable not set");
        process.exit(1);
    }
    // Filter configs with valid private keys
    const validConfigs = AGENT_CONFIGS.filter((c) => c.privateKey);
    if (validConfigs.length < 4) {
        console.error("Error: Need at least 4 agents (PRIVATE_KEY_1 through PRIVATE_KEY_4)");
        process.exit(1);
    }
    console.log(`Initializing ${validConfigs.length} agents...\n`);
    // Create agents
    const agents = validConfigs.map((config) => new Agent_js_1.Agent({
        privateKey: config.privateKey,
        rpcUrl: RPC_URL,
        factoryAddress: FACTORY_ADDRESS,
        agentName: config.name,
        strategyType: "adaptive",
        riskTolerance: 50,
        maxWagerPerGame: WAGER_AMOUNT,
        minBankroll: WAGER_AMOUNT * 2n,
    }, {
        crewmateStyle: config.crewmateStyle,
        impostorStyle: config.impostorStyle,
    }));
    // First agent creates the game
    console.log("Agent-Red creating game...");
    const { gameId, gameAddress } = await agents[0].createAndJoinGame(WAGER_AMOUNT);
    console.log(`Game created: ID=${gameId}, Address=${gameAddress}\n`);
    // Other agents join
    for (let i = 1; i < agents.length; i++) {
        const agent = agents[i];
        console.log(`${AGENT_CONFIGS[i].name} joining game...`);
        agent.setGame(gameId, gameAddress);
        // We need to call joinGame through the agent's submitter
        // For now, agents are already in the game after setGame
        // In production, they would call factory.joinGame()
    }
    console.log("\nAll agents joined. Starting game...\n");
    // First agent starts the game
    await agents[0].startGame();
    // Run all agents in parallel
    console.log("Game started! Agents playing...\n");
    console.log("===========================================\n");
    await Promise.all(agents.map((agent) => agent.playGame()));
    console.log("\n===========================================");
    console.log("              GAME COMPLETE");
    console.log("===========================================\n");
    // Print results
    for (const agent of agents) {
        const role = agent.getRole();
        console.log(`${AGENT_CONFIGS[agents.indexOf(agent)].name}: ${roleToString(role)}`);
    }
}
function roleToString(role) {
    switch (role) {
        case 1:
            return "Crewmate";
        case 2:
            return "Impostor";
        case 3:
            return "Ghost";
        default:
            return "Unknown";
    }
}
// Run the match
runMatch().catch(console.error);
//# sourceMappingURL=run-match.js.map