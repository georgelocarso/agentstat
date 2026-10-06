import React, { useState, useCallback } from 'react';
import type { SessionSnapshot } from '@agentstat/shared';
import { SessionCard } from './SessionCard';
import { Bot, Archive, X } from 'lucide-react';

interface SessionGridProps {
  sessions: SessionSnapshot[];
  emptyMessage?: string;
  pinnedSessionIds: Set<string>;
  onTogglePinned: (sessionId: string) => void;
  archivedSessionIds: Set<string>;
  onArchiveSessions: (sessionIds: string[]) => void;
  onUnarchiveSession: (sessionId: string) => void;
  isArchivedView: boolean;
  onInspectSession?: (session: SessionSnapshot) => void;
}

export const SessionGrid: React.FC<SessionGridProps> = ({
  sessions,
  emptyMessage,
  pinnedSessionIds,
  onTogglePinned,
  archivedSessionIds,
  onArchiveSessions,
  onUnarchiveSession,
  isArchivedView,
  onInspectSession,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Sort with priority: pinned > waiting_approval > working > most recent
  const sorted = [...sessions].sort((a, b) => {
    if (pinnedSessionIds.has(a.sessionId) !== pinnedSessionIds.has(b.sessionId)) {
      return pinnedSessionIds.has(a.sessionId) ? -1 : 1;
    }
    if (a.state === 'waiting_approval' && b.state !== 'waiting_approval') return -1;
    if (b.state === 'waiting_approval' && a.state !== 'waiting_approval') return 1;
    if (a.state === 'working' && b.state !== 'working') return -1;
    if (b.state === 'working' && a.state !== 'working') return 1;
    return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
  });

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = sorted.length > 0 && selectedIds.size === sorted.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sorted.map((s) => s.sessionId)));
    }
  };

  const handleArchiveSelected = () => {
    onArchiveSessions([...selectedIds]);
    setSelectedIds(new Set());
  };

  const handleUnarchiveSelected = () => {
    for (const id of selectedIds) {
      onUnarchiveSession(id);
    }
    setSelectedIds(new Set());
  };

  const handleClearSelection = () => setSelectedIds(new Set());

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center border border-white/5 rounded-3xl bg-zinc-950/40 backdrop-blur-xl">
        <div className="w-12 h-12 rounded-2xl bg-zinc-900/80 border border-white/5 flex items-center justify-center text-zinc-400 mb-3 shadow-inner">
          <Bot className="w-6 h-6 text-indigo-400" />
        </div>
        <h3 className="text-base font-semibold text-zinc-200 tracking-tight">
          {emptyMessage || 'No Active Agent Sessions'}
        </h3>
        <p className="text-xs text-zinc-400 max-w-sm mt-1 leading-relaxed">
          {emptyMessage
            ? 'Try selecting another status tab or launching a new session.'
            : 'Wrap your agent commands or start an agy session to monitor it live.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Bulk action toolbar ───────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-1 min-h-[32px]">
        {/* Select all checkbox */}
        <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={handleSelectAll}
            aria-label="Select all sessions"
            className="w-4 h-4 rounded-md border-zinc-600 bg-zinc-800/80 accent-indigo-500 cursor-pointer transition-transform active:scale-90"
          />
          <span className="text-zinc-400 font-medium text-xs">Select all</span>
        </label>

        {selectedIds.size > 0 && (
          <>
            <span className="text-xs text-zinc-400 font-mono font-medium">
              {selectedIds.size} selected
            </span>

            {isArchivedView ? (
              <button
                type="button"
                onClick={handleUnarchiveSelected}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all"
              >
                <Archive className="w-3.5 h-3.5" />
                Unarchive Selected
              </button>
            ) : (
              <button
                type="button"
                onClick={handleArchiveSelected}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-zinc-800/80 text-zinc-300 border border-zinc-700/60 hover:bg-zinc-700 transition-all"
              >
                <Archive className="w-3.5 h-3.5" />
                Archive Selected
              </button>
            )}

            <button
              type="button"
              onClick={handleClearSelection}
              aria-label="Clear selection"
              className="p-1 rounded-full text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {/* ── Session cards grid ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map((session) => (
          <SessionCard
            key={session.sessionId}
            session={session}
            pinned={pinnedSessionIds.has(session.sessionId)}
            onTogglePinned={onTogglePinned}
            selected={selectedIds.has(session.sessionId)}
            onToggleSelect={toggleSelect}
            isArchived={archivedSessionIds.has(session.sessionId)}
            onArchive={(id) => {
              onArchiveSessions([id]);
              setSelectedIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
            }}
            onUnarchive={onUnarchiveSession}
            onInspect={onInspectSession}
          />
        ))}
      </div>
    </div>
  );
};
