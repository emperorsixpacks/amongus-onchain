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
  ws: WebSocket | null;
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
        ws: null,
      };
      this.agents.push(agent);
      logger.info(`Created ${agent.name} (${agent.isImpostor ? "IMPOSTOR" : "Crewmate"})`);
    }
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
    if (message.type === "server:room_list") {
      this.handleRoomList(message.rooms);
    } else if (message.type === "server:room_update") {
      this.handleRoomUpdate(message.room);
    }
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
      this.startAgentActions();
    }
  }

  /**
   * Connect all agents to the room
   */
  private async joinRoomWithAgents(roomId: string): Promise<void> {
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
    const aliveAgents = this.agents.filter((a) => a.isAlive);
    if (aliveAgents.length === 0 || Math.random() > 0.6) return;

    const mover = aliveAgents[Math.floor(Math.random() * aliveAgents.length)];
    const adjacent = ADJACENT_ROOMS[mover.location] || [];
    if (adjacent.length === 0) return;

    const newLocation = adjacent[Math.floor(Math.random() * adjacent.length)];
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
  }

  /**
   * Simulate task completion
   */
  private simulateTask(): void {
    const workers = this.agents.filter(
      (a) => a.isAlive && !a.isImpostor && a.tasksCompleted < a.totalTasks
    );
    if (workers.length === 0 || Math.random() > 0.5) return;

    const worker = workers[Math.floor(Math.random() * workers.length)];
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

    logger.debug(`${worker.name} completed task (${worker.tasksCompleted}/${worker.totalTasks})`);
  }

  /**
   * Simulate impostor kill
   */
  private simulateKill(): void {
    const impostor = this.agents.find((a) => a.isAlive && a.isImpostor);
    if (!impostor) return;

    // Find targets in same location
    const targets = this.agents.filter(
      (a) => a.isAlive && !a.isImpostor && a.location === impostor.location
    );
    if (targets.length !== 1) return; // Only kill if alone with one target

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

  getState() {
    return {
      roomId: this.roomId,
      agents: this.agents.map((a) => ({
        name: a.name,
        colorId: a.colorId,
        location: a.location,
        isAlive: a.isAlive,
        isImpostor: a.isImpostor,
        tasksCompleted: a.tasksCompleted,
      })),
    };
  }
}
