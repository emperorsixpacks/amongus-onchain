// Individual Agent WebSocket Connection Client

import {
  ConnectionState,
  ServerEvent,
  ServerEventType,
  AgentCommand,
  AgentCommandType,
  AuthPayload,
  AgentConnectionStatus,
} from './types';
import { WS_CONFIG, WS_CLOSE_CODES, WS_ERRORS } from './constants';

export type ServerEventHandler = (event: ServerEvent) => void;
export type ConnectionStateHandler = (state: ConnectionState, error?: string) => void;

export interface AgentWebSocketClientOptions {
  url?: string;
  autoReconnect?: boolean;
  onEvent?: ServerEventHandler;
  onStateChange?: ConnectionStateHandler;
}

export class AgentWebSocketClient {
  private ws: WebSocket | null = null;
  private agentAddress: `0x${string}`;
  private gameId: string;
  private url: string;
  private autoReconnect: boolean;

  private state: ConnectionState = ConnectionState.Disconnected;
  private reconnectAttempts: number = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  private authTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastHeartbeat: number | null = null;

  private messageQueue: AgentCommand[] = [];
  private pendingActions: Map<string, { command: AgentCommand; timestamp: number }> = new Map();

  private onEvent: ServerEventHandler | null = null;
  private onStateChange: ConnectionStateHandler | null = null;

  constructor(
    agentAddress: `0x${string}`,
    gameId: string,
    options: AgentWebSocketClientOptions = {}
  ) {
    this.agentAddress = agentAddress;
    this.gameId = gameId;
    this.url = options.url || WS_CONFIG.DEFAULT_URL;
    this.autoReconnect = options.autoReconnect ?? true;
    this.onEvent = options.onEvent || null;
    this.onStateChange = options.onStateChange || null;
  }

  // ============ Public API ============

  get connectionState(): ConnectionState {
    return this.state;
  }

  get status(): AgentConnectionStatus {
    return {
      agentAddress: this.agentAddress,
      state: this.state,
      lastHeartbeat: this.lastHeartbeat,
      reconnectAttempts: this.reconnectAttempts,
      error: this.state === ConnectionState.Error ? WS_ERRORS.CONNECTION_FAILED : null,
    };
  }

  async connect(signatureProvider: () => Promise<string>): Promise<void> {
    if (this.state === ConnectionState.Connected || this.state === ConnectionState.Connecting) {
      return;
    }

    this.setState(ConnectionState.Connecting);

    try {
      const wsUrl = `${this.url}/game/${this.gameId}/agent/${this.agentAddress}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = async () => {
        this.setState(ConnectionState.Authenticating);

        try {
          const signature = await signatureProvider();
          this.authenticate(signature);
        } catch (error) {
          this.handleError('Failed to get signature for authentication');
        }
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = () => {
        this.handleError(WS_ERRORS.CONNECTION_FAILED);
      };

      this.ws.onclose = (event) => {
        this.handleClose(event.code, event.reason);
      };
    } catch (error) {
      this.handleError(WS_ERRORS.CONNECTION_FAILED);
    }
  }

  disconnect(): void {
    this.autoReconnect = false;
    this.cleanup();

    if (this.ws) {
      this.ws.close(WS_CLOSE_CODES.NORMAL, 'Client disconnect');
      this.ws = null;
    }

    this.setState(ConnectionState.Disconnected);
  }

  send(command: AgentCommand): boolean {
    if (this.state !== ConnectionState.Connected || !this.ws) {
      // Queue message if not connected
      if (this.messageQueue.length < WS_CONFIG.MAX_QUEUE_SIZE) {
        this.messageQueue.push(command);
      }
      return false;
    }

    try {
      this.ws.send(JSON.stringify(command));

      // Track actions that need confirmation
      if ('actionId' in command) {
        this.pendingActions.set(command.actionId, {
          command,
          timestamp: Date.now(),
        });
      }

      return true;
    } catch (error) {
      this.messageQueue.push(command);
      return false;
    }
  }

  // Action helper methods
  move(targetLocation: number): string {
    const actionId = this.generateActionId();
    this.send({
      type: AgentCommandType.MOVE,
      actionId,
      targetLocation,
    });
    return actionId;
  }

  kill(target: `0x${string}`): string {
    const actionId = this.generateActionId();
    this.send({
      type: AgentCommandType.KILL,
      actionId,
      target,
    });
    return actionId;
  }

  reportBody(bodyVictim: `0x${string}`): string {
    const actionId = this.generateActionId();
    this.send({
      type: AgentCommandType.REPORT_BODY,
      actionId,
      bodyVictim,
    });
    return actionId;
  }

  vote(target: `0x${string}` | null): string {
    const actionId = this.generateActionId();
    this.send({
      type: AgentCommandType.VOTE,
      actionId,
      target,
    });
    return actionId;
  }

  completeTask(taskId: string): string {
    const actionId = this.generateActionId();
    this.send({
      type: AgentCommandType.COMPLETE_TASK,
      actionId,
      taskId,
    });
    return actionId;
  }

  sabotage(sabotageType: number): string {
    const actionId = this.generateActionId();
    this.send({
      type: AgentCommandType.SABOTAGE,
      actionId,
      sabotageType,
    });
    return actionId;
  }

  // ============ Private Methods ============

  private authenticate(signature: string): void {
    const authPayload: AuthPayload = {
      agentAddress: this.agentAddress,
      gameId: this.gameId,
      signature,
      timestamp: Date.now(),
    };

    this.send({
      type: AgentCommandType.AUTH,
      payload: authPayload,
    });

    // Set auth timeout
    this.authTimeout = setTimeout(() => {
      if (this.state === ConnectionState.Authenticating) {
        this.handleError(WS_ERRORS.AUTH_TIMEOUT);
      }
    }, WS_CONFIG.AUTH_TIMEOUT);
  }

  private handleMessage(data: string): void {
    try {
      const event = JSON.parse(data) as ServerEvent;

      switch (event.type) {
        case ServerEventType.AUTH_SUCCESS:
          this.handleAuthSuccess();
          break;

        case ServerEventType.AUTH_FAILURE:
          this.handleError(event.reason || WS_ERRORS.AUTH_FAILED);
          break;

        case ServerEventType.HEARTBEAT:
          this.handleHeartbeat(event.timestamp);
          break;

        case ServerEventType.ACTION_CONFIRMED:
          this.pendingActions.delete(event.actionId);
          break;

        case ServerEventType.ACTION_REJECTED:
          this.pendingActions.delete(event.actionId);
          break;

        case ServerEventType.ERROR:
          console.error(`[WS] Server error: ${event.code} - ${event.message}`);
          break;
      }

      // Forward event to handler
      if (this.onEvent) {
        this.onEvent(event);
      }
    } catch (error) {
      console.error('[WS] Failed to parse message:', error);
    }
  }

  private handleAuthSuccess(): void {
    if (this.authTimeout) {
      clearTimeout(this.authTimeout);
      this.authTimeout = null;
    }

    this.reconnectAttempts = 0;
    this.setState(ConnectionState.Connected);
    this.startHeartbeat();
    this.flushMessageQueue();
  }

  private handleHeartbeat(timestamp: number): void {
    this.lastHeartbeat = timestamp;

    // Clear existing timeout
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
    }

    // Send acknowledgment
    this.send({
      type: AgentCommandType.HEARTBEAT_ACK,
      timestamp,
    });

    // Set new timeout
    this.heartbeatTimeout = setTimeout(() => {
      this.handleError(WS_ERRORS.HEARTBEAT_TIMEOUT);
    }, WS_CONFIG.HEARTBEAT_TIMEOUT);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      // Check for stale pending actions
      const now = Date.now();
      for (const [actionId, { timestamp }] of this.pendingActions) {
        if (now - timestamp > WS_CONFIG.ACTION_TIMEOUT) {
          this.pendingActions.delete(actionId);
        }
      }
    }, WS_CONFIG.HEARTBEAT_INTERVAL);
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.state === ConnectionState.Connected) {
      const command = this.messageQueue.shift();
      if (command) {
        this.send(command);
      }
    }
  }

  private handleClose(code: number, reason: string): void {
    this.cleanup();

    // Check if we should reconnect
    const shouldReconnect =
      this.autoReconnect &&
      code !== WS_CLOSE_CODES.NORMAL &&
      code !== WS_CLOSE_CODES.AUTH_FAILED &&
      code !== WS_CLOSE_CODES.KICKED &&
      code !== WS_CLOSE_CODES.GAME_ENDED &&
      this.reconnectAttempts < WS_CONFIG.MAX_RECONNECT_ATTEMPTS;

    if (shouldReconnect) {
      this.scheduleReconnect();
    } else {
      this.setState(ConnectionState.Disconnected);
    }
  }

  private handleError(message: string): void {
    console.error(`[WS] Error for ${this.agentAddress}: ${message}`);
    this.setState(ConnectionState.Error, message);

    if (this.autoReconnect && this.reconnectAttempts < WS_CONFIG.MAX_RECONNECT_ATTEMPTS) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      return; // Already scheduled
    }

    this.setState(ConnectionState.Reconnecting);

    const delay = Math.min(
      WS_CONFIG.RECONNECT_INTERVAL_BASE * Math.pow(WS_CONFIG.RECONNECT_MULTIPLIER, this.reconnectAttempts),
      WS_CONFIG.RECONNECT_INTERVAL_MAX
    );

    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.ws = null;

      // Note: Caller must provide signature provider again
      // This is handled by AgentConnectionManager
    }, delay);
  }

  private cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }

    if (this.authTimeout) {
      clearTimeout(this.authTimeout);
      this.authTimeout = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private setState(state: ConnectionState, error?: string): void {
    this.state = state;

    if (this.onStateChange) {
      this.onStateChange(state, error);
    }
  }

  private generateActionId(): string {
    return `${this.agentAddress}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
