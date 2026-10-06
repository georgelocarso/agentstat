import React from 'react';
import type { SessionSnapshot } from '@agentstat/shared';
import { StateBadge } from './StateBadge';
import { GitBranch, Folder, Pin, Archive, ArchiveRestore, ChevronRight, Terminal } from 'lucide-react';

interface SessionCardProps {
  session: SessionSnapshot;
  pinned: boolean;
  onTogglePinned: (sessionId: string) => void;
  selected: boolean;
  onToggleSelect: (sessionId: string) => void;
  isArchived: boolean;
  onArchive: (sessionId: string) => void;
  onUnarchive: (sessionId: string) => void;
  onInspect?: (session: SessionSnapshot) => void;
}

export const SessionCard: React.FC<SessionCardProps> = ({
  session,
  pinned,
  onTogglePinned,
  selected,
  onToggleSelect,
  isArchived,
  onArchive,
  onUnarchive,
  onInspect,
}) => {
  const isWaiting = session.state === 'waiting_approval';
  const lastSeenFormatted = new Date(session.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Distinct Apple translucent tinted shades per state (rich & clearly visible gradients)
  const getStateCardClasses = () => {
    if (selected) {
      return 'bg-gradient-to-br from-indigo-900/60 via-indigo-950/40 to-black/70 border-indigo-400/60 shadow-xl shadow-indigo-950/60 ring-1 ring-indigo-400/40';
    }
    if (isArchived) {
      return 'bg-gradient-to-br from-zinc-900/50 to-zinc-950/40 border-zinc-800/60 opacity-60 hover:opacity-85';
    }
    switch (session.state) {
      case 'waiting_approval':
        return 'bg-gradient-to-br from-amber-900/50 via-amber-950/30 to-black/70 border-amber-500/50 shadow-xl shadow-amber-950/40 ring-1 ring-amber-500/30 hover:border-amber-400/70';
      case 'working':
        return 'bg-gradient-to-br from-blue-900/50 via-indigo-950/30 to-black/70 border-blue-500/45 shadow-xl shadow-blue-950/40 ring-1 ring-blue-500/20 hover:border-blue-400/70';
      case 'idle':
        return 'bg-gradient-to-br from-emerald-900/45 via-emerald-950/25 to-black/70 border-emerald-500/40 shadow-xl shadow-emerald-950/30 ring-1 ring-emerald-500/20 hover:border-emerald-400/60';
      case 'completed':
        return 'bg-gradient-to-br from-zinc-800/45 via-zinc-900/30 to-black/70 border-zinc-700/50 shadow-md hover:border-zinc-500/60';
      case 'crashed':
        return 'bg-gradient-to-br from-red-900/55 via-red-950/35 to-black/70 border-red-500/50 shadow-xl shadow-red-950/40 ring-1 ring-red-500/30 hover:border-red-400/70';
      case 'stale':
      default:
        return 'bg-gradient-to-br from-zinc-900/40 to-black/60 border-white/5 opacity-70 hover:opacity-90';
    }
  };

  return (
    <div
      onClick={() => onInspect?.(session)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onInspect?.(session);
        }
      }}
      className={`group relative rounded-2xl p-4 border backdrop-blur-2xl transition-all duration-200 cursor-pointer text-left select-none outline-none ${getStateCardClasses()}`}
    >
      {/* ── Top Bar: Selection, Project & Status ──────────────────────── */}
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <input
            type="checkbox"
            checked={selected}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSelect(session.sessionId)}
            aria-label={`Select session ${session.project}`}
            className="w-4 h-4 rounded-md border-zinc-600 bg-zinc-800/80 accent-indigo-500 cursor-pointer shrink-0 transition-transform active:scale-90"
          />
          <div className="min-w-0 flex items-center gap-1.5">
            <Folder className="w-4 h-4 text-zinc-400 shrink-0" />
            <h3 className="font-semibold text-sm text-zinc-100 truncate tracking-tight">
              {session.project}
            </h3>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-zinc-800/80 text-zinc-400 border border-zinc-700/50 shrink-0">
              {session.agentType}
            </span>
          </div>
        </div>

        {/* State Badge & Actions */}
        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <StateBadge state={session.state} />

          <button
            type="button"
            onClick={() => onTogglePinned(session.sessionId)}
            aria-label={pinned ? 'Unpin' : 'Pin'}
            title={pinned ? 'Unpin' : 'Pin'}
            className={`p-1.5 rounded-lg transition-colors ${
              pinned
                ? 'text-amber-400 bg-amber-400/10'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
            }`}
          >
            <Pin className={`w-3.5 h-3.5 ${pinned ? 'fill-current' : ''}`} />
          </button>

          {isArchived ? (
            <button
              type="button"
              onClick={() => onUnarchive(session.sessionId)}
              aria-label="Unarchive"
              title="Unarchive"
              className="p-1.5 rounded-lg text-zinc-500 hover:text-emerald-300 hover:bg-emerald-950/20 transition-colors"
            >
              <ArchiveRestore className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onArchive(session.sessionId)}
              aria-label="Archive"
              title="Archive"
              className="p-1.5 rounded-lg text-zinc-500 hover:text-amber-300 hover:bg-amber-950/20 transition-colors"
            >
              <Archive className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Metadata Row (Path & Branch) ─────────────────────────────── */}
      <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono mb-3">
        <span className="truncate text-[11px] text-zinc-400">{session.displayPath}</span>
        {session.gitBranch && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/60 border border-zinc-700/40 text-zinc-300 shrink-0">
            <GitBranch className="w-3 h-3 text-emerald-400" />
            {session.gitBranch}
          </span>
        )}
      </div>

      {/* ── Clean Content Snippet (Restrained, Not Messy) ────────────── */}
      <div className="space-y-2 mb-3">
        {session.promptSnippet && (
          <div
            className={`p-2.5 rounded-xl text-xs font-mono leading-relaxed transition-colors ${
              isWaiting
                ? 'bg-amber-950/30 border border-amber-500/30 text-amber-200'
                : 'bg-black/40 border border-white/5 text-zinc-300'
            }`}
          >
            <div className="flex items-center gap-1 text-[10px] uppercase font-semibold tracking-wider text-zinc-500 mb-0.5">
              <Terminal className="w-3 h-3 text-indigo-400" />
              <span>{isWaiting ? 'Pending Action' : 'Request'}</span>
            </div>
            <p className="line-clamp-2 select-text">{session.promptSnippet}</p>
          </div>
        )}

        {session.outputSnippet && (
          <div className="p-2.5 rounded-xl text-xs font-mono bg-zinc-900/40 border border-white/5 text-zinc-300 leading-relaxed">
            <p className="line-clamp-2 select-text text-zinc-400">{session.outputSnippet}</p>
          </div>
        )}
      </div>

      {/* ── Card Footer: Last Active & Subtle Inspect Action ─────────── */}
      <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
        <span>Active {lastSeenFormatted}</span>
        <div className="flex items-center gap-1 text-zinc-400 group-hover:text-indigo-400 transition-colors font-sans text-xs font-medium">
          <span>Details</span>
          <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </div>
  );
};
