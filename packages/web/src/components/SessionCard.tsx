import React from 'react';
import type { SessionSnapshot } from '@agentstat/shared';
import { StateBadge } from './StateBadge';
import { GitBranch, Folder, Terminal, Clock, CheckCircle2, Pin } from 'lucide-react';

interface SessionCardProps {
  session: SessionSnapshot;
  pinned: boolean;
  onTogglePinned: (sessionId: string) => void;
}

export const SessionCard: React.FC<SessionCardProps> = ({ session, pinned, onTogglePinned }) => {
  const isWaiting = session.state === 'waiting_approval';
  const startedFormatted = new Date(session.startedAt).toLocaleTimeString();
  const lastSeenFormatted = new Date(session.lastSeenAt).toLocaleTimeString();

  return (
    <div
      className={`rounded-xl border transition-all duration-200 p-5 ${
        isWaiting
          ? 'bg-amber-950/20 border-amber-500/50 shadow-lg shadow-amber-950/40 ring-1 ring-amber-500/30'
          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-lg text-slate-100 flex items-center gap-2">
              <Folder className="w-4 h-4 text-indigo-400" />
              {session.project}
            </h3>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
              {session.agentType}
            </span>
          </div>
          <p className="text-xs text-slate-400 font-mono mt-0.5">{session.displayPath}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onTogglePinned(session.sessionId)}
            aria-label={pinned ? 'Unpin session' : 'Pin session'}
            title={pinned ? 'Unpin session' : 'Pin session'}
            className={`p-1.5 rounded-md transition-colors ${pinned ? 'text-amber-300 bg-amber-500/15' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
          >
            <Pin className={`w-4 h-4 ${pinned ? 'fill-current' : ''}`} />
          </button>
          <StateBadge state={session.state} />
        </div>
      </div>

      {session.gitBranch && (
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800/80 text-xs font-mono text-slate-300 mb-3">
          <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
          {session.gitBranch}
        </div>
      )}

      {session.promptSnippet && (
        <div
          className={`mt-2 p-3 rounded-lg text-xs font-mono border ${
            isWaiting
              ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
              : 'bg-slate-950/60 border-slate-800 text-slate-300'
          }`}
        >
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            <Terminal className="w-3 h-3 text-indigo-400" />
            {isWaiting ? 'Approval Required' : 'User Request'}
          </div>
          <p className="break-words line-clamp-3 select-all">{session.promptSnippet}</p>
        </div>
      )}

      {session.outputSnippet && (
        <div className="mt-2 p-3 rounded-lg text-xs font-mono border bg-slate-900/60 border-slate-800/90 text-slate-300">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            Latest Agent Output / Response
          </div>
          <p className="break-words line-clamp-4 select-all text-slate-300">{session.outputSnippet}</p>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" /> Started {startedFormatted}
        </span>
        <span>Seen {lastSeenFormatted}</span>
      </div>
    </div>
  );
};
