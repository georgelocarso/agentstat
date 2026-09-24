import type { AgentEvent, SessionSnapshot, SessionState } from '@agentstat/shared';
import { EventEmitter } from 'node:events';

export class SessionRegistry extends EventEmitter {
  private sessions = new Map<string, SessionSnapshot>();
  private staleTimer?: NodeJS.Timeout;
  private readonly staleTimeoutMs: number;
  private readonly purgeTimeoutMs: number;

  constructor(staleTimeoutMs = 15 * 60 * 1000, purgeTimeoutMs = 60 * 60 * 1000) {
    super();
    this.staleTimeoutMs = staleTimeoutMs;
    this.purgeTimeoutMs = purgeTimeoutMs;

    // Periodic sweep for stale and expired sessions
    this.staleTimer = setInterval(() => this.sweep(), 30 * 1000);
    if (this.staleTimer.unref) {
      this.staleTimer.unref();
    }
  }

  public recordEvent(event: AgentEvent): SessionSnapshot {
    const existing = this.sessions.get(event.sessionId);
    const now = event.timestamp || new Date().toISOString();

    const snapshot: SessionSnapshot = {
      sessionId: event.sessionId,
      agentType: event.agentType,
      state: event.state,
      project: event.project,
      displayPath: event.displayPath,
      gitBranch: event.gitBranch || existing?.gitBranch,
      promptSnippet: event.promptSnippet !== undefined ? event.promptSnippet : existing?.promptSnippet,
      outputSnippet: event.outputSnippet !== undefined ? event.outputSnippet : existing?.outputSnippet,
      pid: event.pid !== undefined ? event.pid : existing?.pid,
      exitCode: event.exitCode !== undefined ? event.exitCode : existing?.exitCode,
      startedAt: existing?.startedAt || now,
      lastSeenAt: now,
      historySummary: existing?.historySummary || [],
    };

    if (event.promptSnippet && (!existing || existing.promptSnippet !== event.promptSnippet)) {
      snapshot.historySummary = [
        ...(existing?.historySummary || []),
        `[${event.state}] ${event.promptSnippet.slice(0, 100)}`,
      ].slice(-10);
    }

    this.sessions.set(event.sessionId, snapshot);
    this.emit('session_update', snapshot);
    return snapshot;
  }

  public getSession(sessionId: string): SessionSnapshot | undefined {
    return this.sessions.get(sessionId);
  }

  public getAllSessions(): SessionSnapshot[] {
    return Array.from(this.sessions.values()).sort((a, b) => {
      // Prioritize waiting_approval sessions
      if (a.state === 'waiting_approval' && b.state !== 'waiting_approval') return -1;
      if (b.state === 'waiting_approval' && a.state !== 'waiting_approval') return 1;
      return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
    });
  }

  public sweep(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      const lastSeen = new Date(session.lastSeenAt).getTime();
      const age = now - lastSeen;

      // Purge finished/crashed sessions older than purgeTimeoutMs
      if ((session.state === 'completed' || session.state === 'crashed') && age > this.purgeTimeoutMs) {
        this.sessions.delete(id);
        this.emit('session_deleted', id);
        continue;
      }

      // Mark working/waiting_approval as stale if no activity for staleTimeoutMs
      if ((session.state === 'working' || session.state === 'waiting_approval') && age > this.staleTimeoutMs) {
        session.state = 'stale';
        this.sessions.set(id, session);
        this.emit('session_update', session);
      }
    }
  }

  public clear(): void {
    this.sessions.clear();
  }

  public stop(): void {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
    }
  }
}
