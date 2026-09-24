import { useState, useCallback } from 'react';
import { useSSE } from './hooks/useSSE';
import { useNotifications } from './hooks/useNotifications';
import { Header } from './components/Header';
import { SessionGrid } from './components/SessionGrid';
import { playApprovalChime } from './utils/audio';
import type { SessionSnapshot } from '@agentstat/shared';
import { StatusFilterBar, StatusFilterValue } from './components/StatusFilterBar';
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

  const { sessions, connected } = useSSE({
    token: token || undefined,
    onApprovalRequired: handleApprovalRequired,
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

  const statusCounts: Record<StatusFilterValue, number> = {
    all: sessions.length,
    waiting_approval: sessions.filter((s) => s.state === 'waiting_approval').length,
    working: sessions.filter((s) => s.state === 'working').length,
    idle: sessions.filter((s) => s.state === 'idle').length,
    completed: sessions.filter((s) => s.state === 'completed').length,
    crashed: sessions.filter((s) => s.state === 'crashed').length,
    stale: sessions.filter((s) => s.state === 'stale').length,
  };

  const filteredSessions = selectedStatus === 'all'
    ? sessions
    : sessions.filter((s) => s.state === selectedStatus);

  return (
    <div className="min-h-screen flex flex-col bg-[#090d16] text-slate-100">
      <Header
        connected={connected}
        activeCount={sessions.length}
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
        />

        <SessionGrid
          sessions={filteredSessions}
          emptyMessage={
            selectedStatus !== 'all'
              ? `No sessions found in "${selectedStatus.replace('_', ' ')}" state.`
              : undefined
          }
        />
      </main>

      <footer className="border-t border-slate-800/80 py-4 px-6 text-center text-xs text-slate-500">
        Agent Status (`agentstat`) &bull; Lightweight AI Agent Companion
      </footer>
    </div>
  );
}

export default App;
