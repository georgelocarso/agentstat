import React from 'react';
import type { SessionState } from '@agentstat/shared';
import { Layers, PlayCircle, AlertCircle, CheckCircle2, XCircle, Clock } from 'lucide-react';

export type StatusFilterValue = 'all' | SessionState;

export interface StatusFilterItem {
  id: StatusFilterValue;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
  activeColor: string;
  selectedClasses: string;
  hoverClasses: string;
}

interface StatusFilterBarProps {
  selectedStatus: StatusFilterValue;
  onSelectStatus: (status: StatusFilterValue) => void;
  statusCounts: Record<StatusFilterValue, number>;
  selectedAgent: string;
  onSelectAgent: (agent: string) => void;
  agentTypes: string[];
  agentCounts: Record<string, number>;
}

export const StatusFilterBar: React.FC<StatusFilterBarProps> = ({
  selectedStatus,
  onSelectStatus,
  statusCounts,
  selectedAgent,
  onSelectAgent,
  agentTypes,
  agentCounts,
}) => {
  const filters: StatusFilterItem[] = [
    {
      id: 'all',
      label: 'All Sessions',
      icon: Layers,
      count: statusCounts.all,
      activeColor: 'text-indigo-400',
      selectedClasses: 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 border-indigo-500',
      hoverClasses: 'hover:bg-slate-800/80 hover:text-slate-200 border-slate-800 text-slate-400',
    },
    {
      id: 'waiting_approval',
      label: 'Pending Approval',
      icon: AlertCircle,
      count: statusCounts.waiting_approval,
      activeColor: 'text-amber-400',
      selectedClasses: 'bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-md shadow-amber-500/20 ring-1 ring-amber-500/30',
      hoverClasses: 'hover:bg-amber-950/30 hover:text-amber-300 border-slate-800 text-slate-400',
    },
    {
      id: 'working',
      label: 'Working',
      icon: PlayCircle,
      count: statusCounts.working,
      activeColor: 'text-blue-400',
      selectedClasses: 'bg-blue-600/25 text-blue-300 border-blue-500/60 shadow-md shadow-blue-500/20 ring-1 ring-blue-500/30',
      hoverClasses: 'hover:bg-blue-950/30 hover:text-blue-300 border-slate-800 text-slate-400',
    },
    {
      id: 'idle',
      label: 'Idle (Ready)',
      icon: CheckCircle2,
      count: statusCounts.idle,
      activeColor: 'text-emerald-400',
      selectedClasses: 'bg-emerald-600/20 text-emerald-300 border-emerald-500/50 shadow-md ring-1 ring-emerald-500/30',
      hoverClasses: 'hover:bg-emerald-950/30 hover:text-emerald-300 border-slate-800 text-slate-400',
    },
    {
      id: 'completed',
      label: 'Completed',
      icon: CheckCircle2,
      count: statusCounts.completed,
      activeColor: 'text-emerald-400',
      selectedClasses: 'bg-emerald-600/25 text-emerald-300 border-emerald-500/60 shadow-md shadow-emerald-500/20 ring-1 ring-emerald-500/30',
      hoverClasses: 'hover:bg-emerald-950/30 hover:text-emerald-300 border-slate-800 text-slate-400',
    },
    {
      id: 'crashed',
      label: 'Crashed',
      icon: XCircle,
      count: statusCounts.crashed,
      activeColor: 'text-red-400',
      selectedClasses: 'bg-red-600/25 text-red-300 border-red-500/60 shadow-md shadow-red-500/20 ring-1 ring-red-500/30',
      hoverClasses: 'hover:bg-red-950/30 hover:text-red-300 border-slate-800 text-slate-400',
    },
    {
      id: 'stale',
      label: 'Archived',
      icon: Clock,
      count: statusCounts.stale,
      activeColor: 'text-slate-400',
      selectedClasses: 'bg-slate-700/50 text-slate-200 border-slate-600 shadow-md ring-1 ring-slate-600/40',
      hoverClasses: 'hover:bg-slate-800/80 hover:text-slate-300 border-slate-800 text-slate-400',
    },
  ];

  return (
    <div className="w-full flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
      <nav
        aria-label="Filter sessions by status"
        className="flex items-center gap-2 p-1 rounded-xl bg-slate-900/60 border border-slate-800/90 w-max min-w-full sm:min-w-0"
      >
        {filters.map((filter) => {
          const isSelected = selectedStatus === filter.id;
          const Icon = filter.icon;
          const count = filter.count ?? 0;

          return (
            <button
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => onSelectStatus(filter.id)}
              className={`group relative flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                isSelected ? filter.selectedClasses : filter.hoverClasses
              }`}
            >
              <Icon
                className={`w-3.5 h-3.5 transition-transform group-hover:scale-110 ${
                  isSelected ? 'scale-105' : 'text-slate-500 group-hover:text-slate-300'
                }`}
              />
              <span>{filter.label}</span>
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono leading-none transition-colors ${
                  isSelected
                    ? 'bg-black/30 text-white font-bold'
                    : 'bg-slate-800 text-slate-400 group-hover:bg-slate-700 group-hover:text-slate-200'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </nav>
      <label className="flex items-center gap-2 shrink-0 rounded-xl bg-slate-900/60 border border-slate-800/90 px-3 py-1.5 text-xs text-slate-400">
        <span className="whitespace-nowrap">Agent</span>
        <select
          aria-label="Filter sessions by agent"
          value={selectedAgent}
          onChange={(event) => onSelectAgent(event.target.value)}
          className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer"
        >
          <option value="all" className="bg-slate-900">All agents ({statusCounts.all})</option>
          {agentTypes.map((agentType) => (
            <option key={agentType} value={agentType} className="bg-slate-900">
              {agentType} ({agentCounts[agentType]})
            </option>
          ))}
        </select>
      </label>
    </div>
  );
};
