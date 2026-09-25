/**
 * Session lifecycle states conforming to Agent Status PRD specification
 */
export type SessionState = 'working' | 'waiting_approval' | 'completed' | 'idle' | 'crashed' | 'stale';

/**
 * Event ingested by collector daemon from PTY runner or native hooks
 */
export interface AgentEvent {
  eventId: string;
  sessionId: string;
  agentType: string;
  state: SessionState;
  project: string;
  displayPath: string;
  gitBranch?: string;
  promptSnippet?: string;
  outputSnippet?: string;
  exitCode?: number;
  pid?: number;
  timestamp: string; // ISO 8601
}

/**
 * Aggregated live state of an active/historical session
 */
export interface SessionSnapshot {
  sessionId: string;
  agentType: string;
  state: SessionState;
  project: string;
  displayPath: string;
  gitBranch?: string;
  promptSnippet?: string;
  outputSnippet?: string;
  pid?: number;
  exitCode?: number;
  startedAt: string;
  lastSeenAt: string;
  historySummary?: string[];
}

/**
 * Collector configuration
 */
export interface CollectorConfig {
  port: number;
  host: string;
  lan: boolean;
  token?: string;
  staleTimeoutMs: number;  // Default: 1 hour
  purgeTimeoutMs: number;  // Default: 1 hour
}
