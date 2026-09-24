import React from 'react';
import type { SessionSnapshot } from '@agentstat/shared';
import { SessionCard } from './SessionCard';
import { Bot } from 'lucide-react';

interface SessionGridProps {
  sessions: SessionSnapshot[];
  emptyMessage?: string;
}

export const SessionGrid: React.FC<SessionGridProps> = ({ sessions, emptyMessage }) => {
  // Sort with priority: waiting_approval first, then working, then most recent
  const sorted = [...sessions].sort((a, b) => {
    if (a.state === 'waiting_approval' && b.state !== 'waiting_approval') return -1;
    if (b.state === 'waiting_approval' && a.state !== 'waiting_approval') return 1;
    if (a.state === 'working' && b.state !== 'working') return -1;
    if (b.state === 'working' && a.state !== 'working') return 1;
    return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
  });

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
        <div className="w-14 h-14 rounded-2xl bg-slate-800/80 flex items-center justify-center text-slate-400 mb-4">
          <Bot className="w-7 h-7 text-indigo-400" />
        </div>
        <h3 className="text-lg font-medium text-slate-200">
          {emptyMessage || 'No Active Agent Sessions'}
        </h3>
        <p className="text-sm text-slate-400 max-w-sm mt-1">
          {emptyMessage
            ? 'Try selecting another status tab or launching a new session.'
            : 'Wrap your agent commands or start an agy session to monitor it live.'}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {sorted.map((session) => (
        <SessionCard key={session.sessionId} session={session} />
      ))}
    </div>
  );
};
