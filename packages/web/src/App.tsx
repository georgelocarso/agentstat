import { useState, useCallback } from 'react';
import { useSSE } from './hooks/useSSE';
import { useNotifications } from './hooks/useNotifications';
import { Header } from './components/Header';
import { SessionGrid } from './components/SessionGrid';
import { playApprovalChime } from './utils/audio';
import type { SessionSnapshot } from '@agentstat/shared';
import { StatusFilterBar, StatusFilterValue } from './components/StatusFilterBar';
import { SessionDetailModal } from './components/SessionDetailModal';
import { KeyRound } from 'lucide-react';

export function App() {
  const [token, setToken] = useState<string>(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paramToken = urlParams.get('token');
    if (paramToken) {
      localStorage.setItem('agentstat_token', paramToken);
      return paramToken;
    }
    return localStorage.getItem('agentstat_token') || '';
  });

  const [inputToken, setInputToken] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const { requestPermission, sendNotification } = useNotifications();

  const handleApprovalRequired = useCallback(
    (session: SessionSnapshot) => {
      if (audioEnabled) {
        playApprovalChime();
      }

      sendNotification(`Approval Required: ${session.project}`, {
        body: session.promptSnippet || `Session in ${session.displayPath} is waiting for user approval.`,
        tag: session.sessionId,
      });
    },
    [audioEnabled, sendNotification]
  );

  // ── Manual archive state ─────────────────────────────────────────────────
  const [archivedSessionIds, setArchivedSessionIds] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('agentstat_archived_sessions') || '[]'));
    } catch {
      return new Set();
    }
  });

  const archiveSessions = useCallback((sessionIds: string[]) => {
    setArchivedSessionIds((prev) => {
      const next = new Set([...prev, ...sessionIds]);
      localStorage.setItem('agentstat_archived_sessions', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const unarchiveSession = useCallback((sessionId: string) => {
    setArchivedSessionIds((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      localStorage.setItem('agentstat_archived_sessions', JSON.stringify([...next]));
      return next;
    });
  }, []);

  // Auto-unarchive when a session has fresh activity (called from useSSE)
  const handleAutoUnarchive = useCallback(
    (sessionId: string) => {
      unarchiveSession(sessionId);
    },
    [unarchiveSession]
  );
  // ────────────────────────────────────────────────────────────────────────

  const { sessions, connected } = useSSE({
    token: token || undefined,
    onApprovalRequired: handleApprovalRequired,
    onAutoUnarchive: handleAutoUnarchive,
  });

  const waitingCount = sessions.filter((s) => s.state === 'waiting_approval').length;

  const handleSaveToken = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputToken.trim()) {
      localStorage.setItem('agentstat_token', inputToken.trim());
      setToken(inputToken.trim());
      setInputToken('');
    }
  };

  const [selectedStatus, setSelectedStatus] = useState<StatusFilterValue>('all');
  const [selectedAgent, setSelectedAgent] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectedSession, setInspectedSession] = useState<SessionSnapshot | null>(null);

  // Keyboard shortcut '/' to focus search
  const handleSearchChange = (query: string) => setSearchQuery(query);

  const [pinnedSessionIds, setPinnedSessionIds] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('agentstat_pinned_sessions') || '[]'));
    } catch {
      return new Set();
    }
  });

  const togglePinned = (sessionId: string) => {
    setPinnedSessionIds((previous) => {
      const next = new Set(previous);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      localStorage.setItem('agentstat_pinned_sessions', JSON.stringify([...next]));
      return next;
    });
  };

  // A session is "visually archived" if manually archived OR daemon-stale.
  // For filtering purposes we treat both as 'stale'.
  const isVisuallyArchived = (s: SessionSnapshot) =>
    archivedSessionIds.has(s.sessionId) || s.state === 'stale';

  const statusCounts: Record<StatusFilterValue, number> = {
    all: sessions.filter((s) => !isVisuallyArchived(s)).length,
    waiting_approval: sessions.filter((s) => s.state === 'waiting_approval').length,
    working: sessions.filter((s) => s.state === 'working' && !archivedSessionIds.has(s.sessionId)).length,
    idle: sessions.filter((s) => s.state === 'idle' && !archivedSessionIds.has(s.sessionId)).length,
    completed: sessions.filter((s) => s.state === 'completed' && !archivedSessionIds.has(s.sessionId)).length,
    crashed: sessions.filter((s) => s.state === 'crashed' && !archivedSessionIds.has(s.sessionId)).length,
    stale: sessions.filter((s) => isVisuallyArchived(s)).length,
  };

  const agentTypes = Array.from(new Set(sessions.map((session) => session.agentType).filter(Boolean))).sort();
  const agentCounts = Object.fromEntries(
    agentTypes.map((agentType) => [agentType, sessions.filter((session) => session.agentType === agentType).length])
  );

  // Filter sessions for display.
  // "all" tab hides archived (both manual and stale).
  // "stale" tab shows all archived sessions (both manual and stale).
  const q = searchQuery.trim().toLowerCase();
  const filteredSessions = sessions.filter((session) => {
    const archived = isVisuallyArchived(session);
    const agentMatch = selectedAgent === 'all' || session.agentType === selectedAgent;

    const matchesSearch =
      !q ||
      session.project.toLowerCase().includes(q) ||
      session.displayPath.toLowerCase().includes(q) ||
      (session.gitBranch && session.gitBranch.toLowerCase().includes(q)) ||
      (session.promptSnippet && session.promptSnippet.toLowerCase().includes(q)) ||
      (session.outputSnippet && session.outputSnippet.toLowerCase().includes(q));

    if (!matchesSearch) return false;

    if (selectedStatus === 'stale') {
      return archived && agentMatch;
    }
    if (selectedStatus === 'all') {
      return !archived && agentMatch;
    }
    return session.state === selectedStatus && !archivedSessionIds.has(session.sessionId) && agentMatch;
  });

  return (
    <div className="min-h-screen flex flex-col bg-[#090d16] text-slate-100">
      <Header
        connected={connected}
        activeCount={statusCounts.all}
        waitingCount={waitingCount}
        audioEnabled={audioEnabled}
        onToggleAudio={() => setAudioEnabled((prev) => !prev)}
        onRequestNotifications={requestPermission}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {!connected && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="font-semibold">Disconnected or Remote Token Needed</p>
              <p className="text-xs text-amber-400/80 mt-0.5">
                If accessing via LAN/remote network, verify the daemon is running with <code className="bg-amber-950/40 px-1 py-0.5 rounded">--lan</code> and enter your token below.
              </p>
            </div>

            <form onSubmit={handleSaveToken} className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  placeholder="Paste token..."
                  value={inputToken}
                  onChange={(e) => setInputToken(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors"
              >
                Connect
              </button>
            </form>
          </div>
        )}

        <StatusFilterBar
          selectedStatus={selectedStatus}
          onSelectStatus={setSelectedStatus}
          statusCounts={statusCounts}
          selectedAgent={selectedAgent}
          onSelectAgent={setSelectedAgent}
          agentTypes={agentTypes}
          agentCounts={agentCounts}
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
        />

        <SessionGrid
          sessions={filteredSessions}
          pinnedSessionIds={pinnedSessionIds}
          onTogglePinned={togglePinned}
          archivedSessionIds={archivedSessionIds}
          onArchiveSessions={archiveSessions}
          onUnarchiveSession={unarchiveSession}
          isArchivedView={selectedStatus === 'stale'}
          onInspectSession={setInspectedSession}
          emptyMessage={
            searchQuery || selectedStatus !== 'all' || selectedAgent !== 'all'
              ? `No sessions found matching your current filter criteria.`
              : undefined
          }
        />

        <SessionDetailModal
          session={inspectedSession}
          onClose={() => setInspectedSession(null)}
          pinned={inspectedSession ? pinnedSessionIds.has(inspectedSession.sessionId) : false}
          onTogglePinned={togglePinned}
          isArchived={inspectedSession ? archivedSessionIds.has(inspectedSession.sessionId) : false}
          onArchive={(id) => {
            archiveSessions([id]);
          }}
          onUnarchive={(id) => {
            unarchiveSession(id);
          }}
        />
      </main>

      <footer className="border-t border-slate-800/80 py-4 px-6 text-center text-xs text-slate-500">
        Agent Status (`agentstat`) &bull; Lightweight AI Agent Companion
      </footer>
    </div>
  );
}

export default App;
