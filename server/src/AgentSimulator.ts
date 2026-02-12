import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { createLogger } from "./logger.js";

const logger = createLogger("agent-simulator");

// Room adjacency map (The Skeld)
const ADJACENT_ROOMS: Record<number, number[]> = {
  0: [1, 4, 5],     // Cafeteria -> Admin, MedBay, UpperEngine
  1: [0, 2],        // Admin -> Cafeteria, Storage
  2: [1, 3, 6],     // Storage -> Admin, Electrical, LowerEngine
  3: [2, 6],        // Electrical -> Storage, LowerEngine
  4: [0, 5, 7],     // MedBay -> Cafeteria, UpperEngine, Security
  5: [0, 4, 8],     // UpperEngine -> Cafeteria, MedBay, Reactor
  6: [2, 3, 7],     // LowerEngine -> Storage, Electrical, Security
  7: [4, 6, 8],     // Security -> MedBay, LowerEngine, Reactor
  8: [5, 7],        // Reactor -> UpperEngine, Security
};

const COLOR_NAMES = [
  "Red", "Blue", "Green", "Pink", "Orange", "Yellow",
  "Black", "White", "Purple", "Brown", "Cyan", "Lime"
];

interface SimulatedAgent {
  id: string;
  address: string;
  name: string;
  colorId: number;
  location: number;
  isAlive: boolean;
  isImpostor: boolean;
  tasksCompleted: number;
  totalTasks: number;
  taskLocations: number[]; // Assigned task locations
  hasVoted: boolean;
  ws: WebSocket | null;
}

interface DeadBodyInfo {
  victim: string;
  location: number;
  reported: boolean;
}

interface RoomInfo {
  roomId: string;
  players: any[];
  phase: string;
}

export interface SimulatorConfig {
  serverUrl: string;
  roomId?: string; // If provided, join this room. If not, wait for rooms.
  agentCount: number;
  impostorCount: number;
  moveInterval: number;
  taskInterval: number;
  killInterval: number;
}

export class AgentSimulator {
  private agents: SimulatedAgent[] = [];
  private config: SimulatorConfig;
  private roomId: string | null = null;
  private intervals: NodeJS.Timeout[] = [];
  private isRunning: boolean = false;
  private round: number = 1;
  private currentPhase: number = 0; // 0=Lobby, 2=ActionCommit, 4=Discussion, 5=Voting, 6=VoteResult, 7=Ended
  private deadBodies: DeadBodyInfo[] = [];
  private controlWs: WebSocket | null = null;

  constructor(config: Partial<SimulatorConfig> = {}) {
    this.config = {
      serverUrl: config.serverUrl || "ws://localhost:8080",
      roomId: config.roomId,
      agentCount: config.agentCount || 6,
      impostorCount: config.impostorCount || 1,
      moveInterval: config.moveInterval || 3000,
      taskInterval: config.taskInterval || 5000,
      killInterval: config.killInterval || 8000,
    };
  }

  /**
   * Start the simulator - connects to server and waits for a room
   */
  async start(): Promise<void> {
    logger.info(`Starting simulator with ${this.config.agentCount} agents`);

    // Create agents
    this.createAgents();

    // Connect control WebSocket to watch for rooms
    await this.connectControl();

    this.isRunning = true;
    logger.info("Simulator started, waiting for room...");
  }

  /**
   * Stop the simulation
   */
  stop(): void {
    this.isRunning = false;

    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];

    for (const agent of this.agents) {
      if (agent.ws) {
        agent.ws.close();
        agent.ws = null;
      }
    }

    if (this.controlWs) {
      this.controlWs.close();
      this.controlWs = null;
    }

    logger.info("Simulation stopped");
  }

  /**
   * Create simulated agents
   */
  private createAgents(): void {
    const impostorIndices = new Set<number>();
    while (impostorIndices.size < this.config.impostorCount) {
      impostorIndices.add(Math.floor(Math.random() * this.config.agentCount));
    }

    for (let i = 0; i < this.config.agentCount; i++) {
      const agent: SimulatedAgent = {
        id: uuidv4(),
        address: `0x${(i + 1).toString(16).padStart(40, "0")}`,
        name: `Agent ${COLOR_NAMES[i % 12]}`,
        colorId: i % 12,
        location: 0,
        isAlive: true,
        isImpostor: impostorIndices.has(i),
        tasksCompleted: 0,
        totalTasks: 5,
        taskLocations: this.generateTaskLocations(5),
        hasVoted: false,
        ws: null,
      };
      this.agents.push(agent);
      logger.info(`Created ${agent.name} (${agent.isImpostor ? "IMPOSTOR" : "Crewmate"})`);
    }
  }

  /**
   * Generate random task locations for a player
   */
  private generateTaskLocations(count: number): number[] {
    const locations: number[] = [];
    const available = [1, 2, 3, 4, 5, 6, 7, 8]; // All rooms except Cafeteria (0)
    for (let i = 0; i < count && available.length > 0; i++) {
      const idx = Math.floor(Math.random() * available.length);
      locations.push(available.splice(idx, 1)[0]);
    }
    return locations;
  }

  /**
   * Connect control WebSocket to monitor rooms
   */
  private async connectControl(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.controlWs = new WebSocket(this.config.serverUrl);

      this.controlWs.on("open", () => {
        logger.info("Control connection established");
        resolve();
      });

      this.controlWs.on("message", (data) => {
        const message = JSON.parse(data.toString());
        this.handleControlMessage(message);
      });

      this.controlWs.on("error", (error) => {
        logger.error(`Control connection error: ${error.message}`);
        reject(error);
      });

      this.controlWs.on("close", () => {
        logger.info("Control connection closed");
      });
    });
  }

  /**
   * Handle messages on control connection
   */
  private handleControlMessage(message: any): void {
    switch (message.type) {
      case "server:room_list":
        this.handleRoomList(message.rooms);
        break;
      case "server:room_update":
        this.handleRoomUpdate(message.room);
        break;
      case "server:phase_changed":
        this.handlePhaseChange(message.phase, message.round);
        break;
      case "server:kill_occurred":
        this.handleKillOccurred(message.victim, message.location);
        break;
      case "server:body_reported":
        this.handleBodyReported(message.victim);
        break;
      case "server:player_ejected":
        this.handlePlayerEjected(message.ejected);
        break;
      case "server:game_ended":
        this.handleGameEnded(message.crewmatesWon);
        break;
    }
  }

  /**
   * Handle phase change
   */
  private handlePhaseChange(phase: number, round: number): void {
    const previousPhase = this.currentPhase;
    this.currentPhase = phase;
    this.round = round;

    logger.info(`Phase changed: ${previousPhase} -> ${phase} (round ${round})`);

    // Reset hasVoted when entering voting phase
    if (phase === 5) {
      for (const agent of this.agents) {
        agent.hasVoted = false;
      }
      // Schedule voting behavior
      this.scheduleVoting();
    }

    // Clear reported bodies when returning to action phase
    if (phase === 2) {
      this.deadBodies = this.deadBodies.filter(b => !b.reported);
    }
  }

  /**
   * Handle kill occurred
   */
  private handleKillOccurred(victim: string, location: number): void {
    // Mark agent as dead
    const victimAgent = this.agents.find(a => a.address === victim);
    if (victimAgent) {
      victimAgent.isAlive = false;
    }

    // Track dead body
    this.deadBodies.push({
      victim,
      location,
      reported: false,
    });

    logger.debug(`Body added at location ${location}`);
  }

  /**
   * Handle body reported
   */
  private handleBodyReported(victim: string): void {
    const body = this.deadBodies.find(b => b.victim === victim);
    if (body) {
      body.reported = true;
    }
  }

  /**
   * Handle player ejected
   */
  private handlePlayerEjected(ejected: string): void {
    const agent = this.agents.find(a => a.address.toLowerCase() === ejected.toLowerCase());
    if (agent) {
      agent.isAlive = false;
      logger.info(`${agent.name} was ejected`);
    }
  }

  /**
   * Handle game ended
   */
  private handleGameEnded(crewmatesWon: boolean): void {
    logger.info(`Game ended! ${crewmatesWon ? "Crewmates" : "Impostors"} win!`);
    this.currentPhase = 7;
    // Stop all action loops
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
  }

  /**
   * Handle room list - join first available room in lobby phase
   */
  private async handleRoomList(rooms: RoomInfo[]): Promise<void> {
    if (this.roomId) return; // Already in a room

    // Find a room in lobby phase
    const availableRoom = rooms.find((r) => r.phase === "lobby");

    if (availableRoom) {
      logger.info(`Found room ${availableRoom.roomId}, joining with agents...`);
      this.roomId = availableRoom.roomId;
      await this.joinRoomWithAgents(availableRoom.roomId);
    }
  }

  /**
   * Handle room update
   */
  private handleRoomUpdate(room: RoomInfo): void {
    if (room.roomId !== this.roomId) return;

    if (room.phase === "playing" && this.intervals.length === 0) {
      logger.info("Game started! Beginning agent actions...");
      this.currentPhase = 2; // ActionCommit
      this.startAgentActions();
    }
  }

  /**
   * Connect all agents to the room
   */
  private async joinRoomWithAgents(roomId: string): Promise<void> {
    // Have control WS join as spectator to receive room updates
    if (this.controlWs && this.controlWs.readyState === WebSocket.OPEN) {
      this.controlWs.send(JSON.stringify({
        type: "client:join_room",
        roomId,
        asSpectator: true,
      }));
    }

    for (const agent of this.agents) {
      await this.connectAgent(agent, roomId);
      // Small delay between connections
      await new Promise((r) => setTimeout(r, 200));
    }
    logger.info(`All ${this.agents.length} agents joined room ${roomId}`);
  }

  /**
   * Connect a single agent
   */
  private connectAgent(agent: SimulatedAgent, roomId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.config.serverUrl);
      agent.ws = ws;

      ws.on("open", () => {
        // Authenticate as agent
        ws.send(JSON.stringify({
          type: "agent:authenticate",
          address: agent.address,
        }));

        // Join room
        ws.send(JSON.stringify({
          type: "client:join_room",
          roomId,
          colorId: agent.colorId,
        }));

        logger.debug(`${agent.name} connected`);
        resolve();
      });

      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === "server:error") {
          logger.error(`${agent.name} error: ${message.message}`);
        }
      });

      ws.on("error", (error) => {
        logger.error(`${agent.name} connection error: ${error.message}`);
        reject(error);
      });
    });
  }

  /**
   * Start agent action loops
   */
  private startAgentActions(): void {
    // Movement loop
    const moveInterval = setInterval(() => {
      if (!this.isRunning) return;
      this.simulateMovement();
    }, this.config.moveInterval);
    this.intervals.push(moveInterval);

    // Task loop
    const taskInterval = setInterval(() => {
      if (!this.isRunning) return;
      this.simulateTask();
    }, this.config.taskInterval);
    this.intervals.push(taskInterval);

    // Kill loop
    const killInterval = setInterval(() => {
      if (!this.isRunning) return;
      this.simulateKill();
    }, this.config.killInterval);
    this.intervals.push(killInterval);
  }

  /**
   * Simulate agent movement
   */
  private simulateMovement(): void {
    // Only move during ActionCommit phase
    if (this.currentPhase !== 2) return;

    const aliveAgents = this.agents.filter((a) => a.isAlive);
    if (aliveAgents.length === 0 || Math.random() > 0.6) return;

    const mover = aliveAgents[Math.floor(Math.random() * aliveAgents.length)];
    const adjacent = ADJACENT_ROOMS[mover.location] || [];
    if (adjacent.length === 0) return;

    const newLocation = adjacent[Math.floor(Math.random() * adjacent.length)];
    const previousLocation = mover.location;
    mover.location = newLocation;

    if (mover.ws && mover.ws.readyState === WebSocket.OPEN) {
      mover.ws.send(JSON.stringify({
        type: "agent:position_update",
        gameId: this.roomId,
        location: newLocation,
        round: this.round,
      }));
    }

    logger.debug(`${mover.name} moved to location ${newLocation}`);

    // Check for dead bodies in new location (crewmates only)
    if (!mover.isImpostor) {
      this.checkForBodies(mover);
    }
  }

  /**
   * Check if agent finds a dead body and report it
   */
  private checkForBodies(agent: SimulatedAgent): void {
    const bodyAtLocation = this.deadBodies.find(
      b => b.location === agent.location && !b.reported
    );

    if (bodyAtLocation) {
      logger.info(`${agent.name} found a body at location ${agent.location}!`);

      // Report the body
      if (agent.ws && agent.ws.readyState === WebSocket.OPEN) {
        agent.ws.send(JSON.stringify({
          type: "agent:report_body",
          gameId: this.roomId,
          reporter: agent.address,
          bodyLocation: agent.location,
          round: this.round,
        }));
      }
    }
  }

  /**
   * Simulate task completion
   */
  private simulateTask(): void {
    // Only do tasks during ActionCommit phase
    if (this.currentPhase !== 2) return;

    // Find crewmates who have a task at their current location
    const workers = this.agents.filter((a) => {
      if (!a.isAlive || a.isImpostor) return false;
      if (a.tasksCompleted >= a.totalTasks) return false;
      // Check if current location is in their task list
      return a.taskLocations.includes(a.location);
    });

    if (workers.length === 0 || Math.random() > 0.5) return;

    const worker = workers[Math.floor(Math.random() * workers.length)];

    // Remove this location from their task list
    const taskIndex = worker.taskLocations.indexOf(worker.location);
    if (taskIndex > -1) {
      worker.taskLocations.splice(taskIndex, 1);
    }

    worker.tasksCompleted++;

    if (worker.ws && worker.ws.readyState === WebSocket.OPEN) {
      worker.ws.send(JSON.stringify({
        type: "agent:task_complete",
        gameId: this.roomId,
        player: worker.address,
        tasksCompleted: worker.tasksCompleted,
        totalTasks: worker.totalTasks,
      }));
    }

    logger.debug(`${worker.name} completed task at location ${worker.location} (${worker.tasksCompleted}/${worker.totalTasks})`);
  }

  /**
   * Simulate impostor kill
   */
  private simulateKill(): void {
    // Only kill during ActionCommit phase
    if (this.currentPhase !== 2) return;

    const impostor = this.agents.find((a) => a.isAlive && a.isImpostor);
    if (!impostor) return;

    // Find all alive players in same location (excluding impostor)
    const playersInRoom = this.agents.filter(
      (a) => a.isAlive && a.address !== impostor.address && a.location === impostor.location
    );

    // Find potential targets (crewmates only)
    const targets = playersInRoom.filter(a => !a.isImpostor);

    // Check for witnesses (other impostors don't count as witnesses)
    const witnesses = playersInRoom.filter(a => !a.isImpostor);

    // Only kill if alone with exactly one target (no other witnesses)
    if (targets.length !== 1 || witnesses.length !== 1) return;

    if (Math.random() > 0.5) return;

    const victim = targets[0];
    victim.isAlive = false;

    if (impostor.ws && impostor.ws.readyState === WebSocket.OPEN) {
      impostor.ws.send(JSON.stringify({
        type: "agent:kill",
        gameId: this.roomId,
        killer: impostor.address,
        victim: victim.address,
        location: impostor.location,
        round: this.round,
      }));
    }

    logger.info(`${impostor.name} killed ${victim.name}!`);
  }

  /**
   * Schedule voting behavior for all agents
   */
  private scheduleVoting(): void {
    const alivePlayers = this.agents.filter(a => a.isAlive);

    for (const agent of alivePlayers) {
      // Random delay between 1-6 seconds
      const delay = 1000 + Math.random() * 5000;

      setTimeout(() => {
        this.castAgentVote(agent);
      }, delay);
    }
  }

  /**
   * Cast a vote for an agent
   */
  private castAgentVote(agent: SimulatedAgent): void {
    // Only vote during voting phase and if not already voted
    if (this.currentPhase !== 5 || agent.hasVoted || !agent.isAlive) return;

    const alivePlayers = this.agents.filter(a => a.isAlive && a.address !== agent.address);
    if (alivePlayers.length === 0) return;

    let target: string | null = null;

    if (agent.isImpostor) {
      // Impostors vote for crewmates
      const crewmates = alivePlayers.filter(a => !a.isImpostor);
      if (crewmates.length > 0) {
        target = crewmates[Math.floor(Math.random() * crewmates.length)].address;
      } else {
        target = null; // Skip if only impostors left
      }
    } else {
      // Crewmates vote randomly (or skip 20% of time)
      if (Math.random() < 0.2) {
        target = null; // Skip
      } else {
        target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)].address;
      }
    }

    agent.hasVoted = true;

    if (agent.ws && agent.ws.readyState === WebSocket.OPEN) {
      agent.ws.send(JSON.stringify({
        type: "agent:vote",
        gameId: this.roomId,
        voter: agent.address,
        target,
        round: this.round,
      }));
    }

    logger.debug(`${agent.name} voted for ${target || "skip"}`);
  }

  getState() {
    return {
      roomId: this.roomId,
      currentPhase: this.currentPhase,
      round: this.round,
      deadBodies: this.deadBodies.length,
      agents: this.agents.map((a) => ({
        name: a.name,
        colorId: a.colorId,
        location: a.location,
        isAlive: a.isAlive,
        isImpostor: a.isImpostor,
        tasksCompleted: a.tasksCompleted,
        taskLocations: a.taskLocations,
      })),
    };
  }
}
