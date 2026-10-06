import React from 'react';
import type { SessionState } from '@agentstat/shared';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';

interface StateBadgeProps {
  state: SessionState;
}

export const StateBadge: React.FC<StateBadgeProps> = ({ state }) => {
  switch (state) {
    case 'waiting_approval':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 backdrop-blur-md animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
          Approval
        </span>
      );
    case 'working':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/15 text-blue-300 border border-blue-500/25 backdrop-blur-md">
          <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
          Working
        </span>
      );
    case 'idle':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 backdrop-blur-md">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          Idle
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-zinc-500/15 text-zinc-300 border border-zinc-500/20 backdrop-blur-md">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          Completed
        </span>
      );
    case 'crashed':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-red-500/15 text-red-300 border border-red-500/25 backdrop-blur-md">
          <XCircle className="w-3 h-3 text-red-400" />
          Crashed
        </span>
      );
    case 'stale':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-zinc-800/60 text-zinc-400 border border-zinc-700/40 backdrop-blur-md">
          <Clock className="w-3 h-3 text-zinc-500" />
          Archived
        </span>
      );
  }
};
