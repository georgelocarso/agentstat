import React from 'react';
import type { SessionState } from '@agentstat/shared';
import { Layers, PlayCircle, AlertCircle, CheckCircle2, XCircle, Clock, Search, X } from 'lucide-react';

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
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const StatusFilterBar: React.FC<StatusFilterBarProps> = ({
  selectedStatus,
  onSelectStatus,
  statusCounts,
  selectedAgent,
  onSelectAgent,
  agentTypes,
  agentCounts,
  searchQuery,
  onSearchChange,
}) => {
  const filters: StatusFilterItem[] = [
    {
      id: 'all',
      label: 'All Sessions',
      icon: Layers,
      count: statusCounts.all,
      activeColor: 'text-indigo-400',
      selectedClasses: 'bg-white/10 text-white shadow-sm border-white/10',
      hoverClasses: 'hover:bg-white/5 hover:text-zinc-200 border-transparent text-zinc-400',
    },
    {
      id: 'waiting_approval',
      label: 'Approval',
      icon: AlertCircle,
      count: statusCounts.waiting_approval,
      activeColor: 'text-amber-400',
      selectedClasses: 'bg-amber-500/20 text-amber-300 border-amber-500/30 shadow-sm',
      hoverClasses: 'hover:bg-amber-950/20 hover:text-amber-300 border-transparent text-zinc-400',
    },
    {
      id: 'working',
      label: 'Working',
      icon: PlayCircle,
      count: statusCounts.working,
      activeColor: 'text-blue-400',
      selectedClasses: 'bg-blue-500/20 text-blue-300 border-blue-500/30 shadow-sm',
      hoverClasses: 'hover:bg-blue-950/20 hover:text-blue-300 border-transparent text-zinc-400',
    },
    {
      id: 'idle',
      label: 'Idle',
      icon: CheckCircle2,
      count: statusCounts.idle,
      activeColor: 'text-emerald-400',
      selectedClasses: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 shadow-sm',
      hoverClasses: 'hover:bg-emerald-950/20 hover:text-emerald-300 border-transparent text-zinc-400',
    },
    {
      id: 'completed',
      label: 'Completed',
      icon: CheckCircle2,
      count: statusCounts.completed,
      activeColor: 'text-zinc-400',
      selectedClasses: 'bg-white/10 text-zinc-200 border-white/10 shadow-sm',
      hoverClasses: 'hover:bg-white/5 hover:text-zinc-300 border-transparent text-zinc-400',
    },
    {
      id: 'crashed',
      label: 'Crashed',
      icon: XCircle,
      count: statusCounts.crashed,
      activeColor: 'text-red-400',
      selectedClasses: 'bg-red-500/20 text-red-300 border-red-500/30 shadow-sm',
      hoverClasses: 'hover:bg-red-950/20 hover:text-red-300 border-transparent text-zinc-400',
    },
    {
      id: 'stale',
      label: 'Archived',
      icon: Clock,
      count: statusCounts.stale,
      activeColor: 'text-zinc-400',
      selectedClasses: 'bg-zinc-800/80 text-zinc-300 border-zinc-700/60 shadow-sm',
      hoverClasses: 'hover:bg-zinc-800/50 hover:text-zinc-300 border-transparent text-zinc-400',
    },
  ];

  return (
    <div className="w-full flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <nav
          aria-label="Filter sessions by status"
          className="flex items-center gap-1.5 p-1 rounded-2xl bg-zinc-900/60 border border-white/5 backdrop-blur-xl w-max overflow-x-auto"
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
                className={`group relative flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all duration-150 whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                  isSelected ? filter.selectedClasses : filter.hoverClasses
                }`}
              >
                <Icon
                  className={`w-3.5 h-3.5 transition-transform group-hover:scale-105 ${
                    isSelected ? 'scale-105' : 'text-zinc-500 group-hover:text-zinc-300'
                  }`}
                />
                <span>{filter.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono leading-none transition-colors ${
                    isSelected
                      ? 'bg-black/30 text-white font-semibold'
                      : 'bg-zinc-800/80 text-zinc-400 group-hover:bg-zinc-800 group-hover:text-zinc-300'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </nav>

        <label className="flex items-center gap-2 shrink-0 rounded-2xl bg-zinc-900/60 border border-white/5 backdrop-blur-xl px-3 py-1.5 text-xs text-zinc-400">
          <span className="whitespace-nowrap font-medium">Agent</span>
          <select
            aria-label="Filter sessions by agent"
            value={selectedAgent}
            onChange={(event) => onSelectAgent(event.target.value)}
            className="bg-transparent text-zinc-200 font-medium focus:outline-none cursor-pointer"
          >
            <option value="all" className="bg-zinc-900">All agents ({statusCounts.all})</option>
            {agentTypes.map((agentType) => (
              <option key={agentType} value={agentType} className="bg-zinc-900">
                {agentType} ({agentCounts[agentType]})
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Search Input */}
      <div className="relative min-w-[240px] md:w-72">
        <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search projects, branch, prompt... (Press /)"
          className="w-full pl-8 pr-8 py-1.5 rounded-2xl bg-zinc-900/60 border border-white/5 backdrop-blur-xl text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-0.5 rounded-full transition-colors"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
