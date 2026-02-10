import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import crypto from "crypto";
import { createLogger } from "./logger.js";
import { privyWalletService } from "./PrivyWalletService.js";
import type { WebSocketRelayServer } from "./WebSocketServer.js";

const logger = createLogger("api");

// ============ OPERATOR KEY STORAGE ============

interface StoredOperatorKey {
  operatorKey: string;
  walletAddress: string;
  createdAt: number;
}

// In-memory storage (in production, use a database)
const operatorKeysByWallet = new Map<string, StoredOperatorKey>();
const operatorKeyLookup = new Map<string, string>(); // operatorKey -> walletAddress

function generateOperatorKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomBytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return `oper_${result}`;
}

function getOrCreateOperatorKey(walletAddress: string): StoredOperatorKey {
  const normalizedAddress = walletAddress.toLowerCase();

  // Check if already exists
  const existing = operatorKeysByWallet.get(normalizedAddress);
  if (existing) {
    return existing;
  }

  // Create new operator key
  const operatorKey = generateOperatorKey();
  const entry: StoredOperatorKey = {
    operatorKey,
    walletAddress: normalizedAddress,
    createdAt: Date.now(),
  };

  operatorKeysByWallet.set(normalizedAddress, entry);
  operatorKeyLookup.set(operatorKey, normalizedAddress);

  logger.info(`Created operator key for ${normalizedAddress.slice(0, 10)}...`);
  return entry;
}

function getOperatorKeyByWallet(walletAddress: string): StoredOperatorKey | null {
  return operatorKeysByWallet.get(walletAddress.toLowerCase()) || null;
}

function validateOperatorKey(operatorKey: string): string | null {
  return operatorKeyLookup.get(operatorKey) || null;
}

export function createApiServer(wsServer: WebSocketRelayServer) {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // ============ ROOMS ============

  // Get all rooms and server stats
  app.get("/api/rooms", (_req: Request, res: Response) => {
    const stats = wsServer.getStats();
    const rooms = wsServer.getRooms();

    res.json({
      rooms: rooms.map((room) => ({
        roomId: room.roomId,
        players: room.players.map((p) => ({
          address: p.address,
          colorId: p.colorId,
          isAlive: p.isAlive,
        })),
        spectators: room.spectators.length,
        maxPlayers: room.maxPlayers,
        phase: room.phase,
        createdAt: room.createdAt,
      })),
      stats,
    });
  });

  // Get specific room
  app.get("/api/rooms/:roomId", (req: Request<{ roomId: string }>, res: Response) => {
    const room = wsServer.getRoom(req.params.roomId);

    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    res.json({
      roomId: room.roomId,
      players: room.players,
      spectators: room.spectators.length,
      maxPlayers: room.maxPlayers,
      phase: room.phase,
      createdAt: room.createdAt,
    });
  });

  // ============ LEADERBOARD ============

  // Get leaderboard
  app.get("/api/leaderboard", (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
    const leaderboard = wsServer.getLeaderboard(limit);

    res.json({
      agents: leaderboard,
      timestamp: Date.now(),
    });
  });

  // Get specific agent stats
  app.get("/api/agents/:address/stats", (req: Request<{ address: string }>, res: Response) => {
    const stats = wsServer.getAgentStats(req.params.address);

    if (!stats) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    res.json(stats);
  });

  // ============ OPERATOR KEYS ============

  // Get or create operator key for a wallet address
  app.post("/api/operators", (req: Request, res: Response) => {
    const { walletAddress } = req.body;

    if (!walletAddress || typeof walletAddress !== "string") {
      res.status(400).json({ error: "walletAddress is required" });
      return;
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      res.status(400).json({ error: "Invalid wallet address format" });
      return;
    }

    const entry = getOrCreateOperatorKey(walletAddress);

    res.json({
      operatorKey: entry.operatorKey,
      walletAddress: entry.walletAddress,
      createdAt: entry.createdAt,
    });
  });

  // Get operator key by wallet address
  app.get("/api/operators/:walletAddress", (req: Request<{ walletAddress: string }>, res: Response) => {
    const { walletAddress } = req.params;

    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      res.status(400).json({ error: "Invalid wallet address format" });
      return;
    }

    const entry = getOperatorKeyByWallet(walletAddress);

    if (!entry) {
      res.status(404).json({ error: "No operator key found for this wallet" });
      return;
    }

    res.json({
      operatorKey: entry.operatorKey,
      walletAddress: entry.walletAddress,
      createdAt: entry.createdAt,
    });
  });

  // Validate an operator key (returns wallet address if valid)
  app.get("/api/operators/validate/:operatorKey", (req: Request<{ operatorKey: string }>, res: Response) => {
    const { operatorKey } = req.params;

    if (!operatorKey.startsWith("oper_")) {
      res.status(400).json({ error: "Invalid operator key format" });
      return;
    }

    const walletAddress = validateOperatorKey(operatorKey);

    if (!walletAddress) {
      res.status(404).json({ error: "Operator key not found", valid: false });
      return;
    }

    res.json({
      valid: true,
      walletAddress,
    });
  });

  // ============ OPERATOR / AGENTS ============

  // Create a new agent wallet
  app.post("/api/agents", async (req: Request, res: Response) => {
    const { operatorKey } = req.body;

    if (!operatorKey || typeof operatorKey !== "string") {
      res.status(400).json({ error: "operatorKey is required" });
      return;
    }

    if (!operatorKey.startsWith("oper_")) {
      res.status(400).json({ error: "Invalid operator key format. Must start with 'oper_'" });
      return;
    }

    if (!privyWalletService.isEnabled()) {
      res.status(503).json({
        error: "Privy wallet service not configured",
        message: "Set PRIVY_APP_ID and PRIVY_APP_SECRET in server environment",
      });
      return;
    }

    try {
      const result = await privyWalletService.createAgentWallet(operatorKey);

      if (result) {
        logger.info(`Agent wallet created via API: ${result.address}`);
        res.status(201).json({
          success: true,
          agentAddress: result.address,
          userId: result.userId,
          createdAt: Date.now(),
        });
      } else {
        res.status(500).json({ error: "Failed to create agent wallet" });
      }
    } catch (error) {
      logger.error("Error creating agent wallet:", error);
      res.status(500).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // List agents for an operator
  app.get("/api/agents", (req: Request, res: Response) => {
    const operatorKey = req.query.operatorKey as string;

    if (!operatorKey) {
      res.status(400).json({ error: "operatorKey query parameter is required" });
      return;
    }

    if (!operatorKey.startsWith("oper_")) {
      res.status(400).json({ error: "Invalid operator key format" });
      return;
    }

    const agents = privyWalletService.getAgentWalletsForOperator(operatorKey);

    res.json({
      agents: agents.map((a) => ({
        address: a.address,
        userId: a.userId,
        createdAt: a.createdAt,
      })),
      count: agents.length,
    });
  });

  // ============ SERVER INFO ============

  // Get server configuration and status
  app.get("/api/server", (_req: Request, res: Response) => {
    const stats = wsServer.getStats();

    res.json({
      version: "1.0.0",
      privy: {
        enabled: privyWalletService.isEnabled(),
      },
      limits: stats.limits,
      connections: stats.connections,
      rooms: stats.rooms,
    });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("API error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
