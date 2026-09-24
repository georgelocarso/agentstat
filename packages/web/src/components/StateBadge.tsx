import React from 'react';
import type { SessionState } from '@agentstat/shared';
import { AlertCircle, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';

interface StateBadgeProps {
  state: SessionState;
}

export const StateBadge: React.FC<StateBadgeProps> = ({ state }) => {
  switch (state) {
    case 'waiting_approval':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse">
          <AlertCircle className="w-3.5 h-3.5" />
          Approval Required
        </span>
      );
    case 'working':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Working
        </span>
      );
    case 'idle':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Idle (Ready)
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Completed
        </span>
      );
    case 'crashed':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30">
          <XCircle className="w-3.5 h-3.5" />
          Crashed
        </span>
      );
    case 'stale':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-500/20 text-slate-400 border border-slate-500/30">
          <Clock className="w-3.5 h-3.5" />
          Stale
        </span>
      );
  }
};
