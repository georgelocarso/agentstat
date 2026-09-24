import React from 'react';
import { Activity, Volume2, VolumeX, Bell, Wifi, WifiOff } from 'lucide-react';

interface HeaderProps {
  connected: boolean;
  activeCount: number;
  waitingCount: number;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  onRequestNotifications: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  connected,
  activeCount,
  waitingCount,
  audioEnabled,
  onToggleAudio,
  onRequestNotifications,
}) => {
  return (
    <header className="border-b border-slate-800/80 bg-slate-900/40 backdrop-blur-md sticky top-0 z-30 px-6 py-4">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white">Agent Status</h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                PoC
              </span>
            </div>
            <p className="text-xs text-slate-400">Background AI Coding Agent Monitor</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Waiting Badge Counter */}
          {waitingCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold animate-pulse">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              {waitingCount} Needing Approval
            </div>
          )}

          {/* Active Session Counter */}
          <div className="px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-slate-300 text-xs font-mono">
            {activeCount} Sessions
          </div>

          {/* Audio Chime Toggle */}
          <button
            onClick={onToggleAudio}
            className={`p-2 rounded-lg border transition-colors ${
              audioEnabled
                ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20'
                : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:bg-slate-800'
            }`}
            title={audioEnabled ? 'Mute alert chimes' : 'Enable alert chimes'}
          >
            {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Desktop Push Notification Request */}
          <button
            onClick={onRequestNotifications}
            className="p-2 rounded-lg bg-slate-800/80 border border-slate-700/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Enable desktop notifications"
          >
            <Bell className="w-4 h-4" />
          </button>

          {/* SSE Connection Indicator */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${
              connected
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
            title={connected ? 'Connected to Collector SSE' : 'Disconnected from Collector'}
          >
            {connected ? (
              <>
                <Wifi className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Live</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reconnecting</span>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
