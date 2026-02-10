// Log Aggregator - Collects and manages logs from multiple workers

import { TestLog } from '../config/WorkerConfig';

export interface LogFilter {
  level?: TestLog['level'] | TestLog['level'][];
  source?: string | string[];
  startTime?: number;
  endTime?: number;
  messageContains?: string;
}

export interface LogStats {
  total: number;
  byLevel: Record<TestLog['level'], number>;
  bySource: Record<string, number>;
  errorCount: number;
  warningCount: number;
}

export class LogAggregator {
  private logs: TestLog[] = [];
  private maxLogs: number;

  constructor(maxLogs: number = 10000) {
    this.maxLogs = maxLogs;
  }

  // ============ Add Logs ============

  add(log: TestLog): void {
    this.logs.push(log);

    // Trim if over limit
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  addBatch(logs: TestLog[]): void {
    for (const log of logs) {
      this.add(log);
    }
  }

  // ============ Query Logs ============

  getAll(): TestLog[] {
    return [...this.logs];
  }

  filter(criteria: LogFilter): TestLog[] {
    return this.logs.filter((log) => this.matchesCriteria(log, criteria));
  }

  getByLevel(level: TestLog['level']): TestLog[] {
    return this.filter({ level });
  }

  getBySource(source: string): TestLog[] {
    return this.filter({ source });
  }

  getErrors(): TestLog[] {
    return this.filter({ level: 'error' });
  }

  getWarnings(): TestLog[] {
    return this.filter({ level: 'warn' });
  }

  getRecent(count: number): TestLog[] {
    return this.logs.slice(-count);
  }

  getInTimeRange(startTime: number, endTime: number): TestLog[] {
    return this.filter({ startTime, endTime });
  }

  search(query: string): TestLog[] {
    return this.filter({ messageContains: query });
  }

  // ============ Statistics ============

  getStats(): LogStats {
    const stats: LogStats = {
      total: this.logs.length,
      byLevel: { debug: 0, info: 0, warn: 0, error: 0 },
      bySource: {},
      errorCount: 0,
      warningCount: 0,
    };

    for (const log of this.logs) {
      stats.byLevel[log.level]++;
      stats.bySource[log.source] = (stats.bySource[log.source] || 0) + 1;

      if (log.level === 'error') stats.errorCount++;
      if (log.level === 'warn') stats.warningCount++;
    }

    return stats;
  }

  // ============ Export ============

  toJSON(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  toCSV(): string {
    const headers = ['timestamp', 'level', 'source', 'message', 'data'];
    const rows = this.logs.map((log) => [
      new Date(log.timestamp).toISOString(),
      log.level,
      log.source,
      `"${log.message.replace(/"/g, '""')}"`,
      log.data ? JSON.stringify(log.data) : '',
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  toConsoleFormat(): string {
    return this.logs
      .map((log) => {
        const time = new Date(log.timestamp).toISOString();
        const level = log.level.toUpperCase().padEnd(5);
        const source = log.source.padEnd(15);
        const data = log.data ? ` ${JSON.stringify(log.data)}` : '';
        return `[${time}] [${level}] [${source}] ${log.message}${data}`;
      })
      .join('\n');
  }

  // ============ Management ============

  clear(): void {
    this.logs = [];
  }

  trim(keepCount: number): void {
    if (this.logs.length > keepCount) {
      this.logs = this.logs.slice(-keepCount);
    }
  }

  // ============ Private Methods ============

  private matchesCriteria(log: TestLog, criteria: LogFilter): boolean {
    // Level filter
    if (criteria.level) {
      const levels = Array.isArray(criteria.level) ? criteria.level : [criteria.level];
      if (!levels.includes(log.level)) return false;
    }

    // Source filter
    if (criteria.source) {
      const sources = Array.isArray(criteria.source) ? criteria.source : [criteria.source];
      if (!sources.includes(log.source)) return false;
    }

    // Time range filter
    if (criteria.startTime && log.timestamp < criteria.startTime) return false;
    if (criteria.endTime && log.timestamp > criteria.endTime) return false;

    // Message contains filter
    if (criteria.messageContains) {
      if (!log.message.toLowerCase().includes(criteria.messageContains.toLowerCase())) {
        return false;
      }
    }

    return true;
  }
}
