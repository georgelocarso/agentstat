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
    <header className="border-b border-white/5 bg-black/60 backdrop-blur-2xl sticky top-0 z-30 px-6 py-3.5 transition-all">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-b from-zinc-800 to-zinc-900 border border-white/10 flex items-center justify-center shadow-md shadow-black/40">
            <Activity className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight text-white">Agent Status</h1>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-white/5 text-zinc-400 border border-white/10">
                Live
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 font-normal">AI Coding Agent Monitor</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Waiting Badge Counter */}
          {waitingCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-medium animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
              {waitingCount} Pending
            </div>
          )}

          {/* Active Session Counter */}
          <div className="px-3 py-1 rounded-full bg-zinc-900/80 border border-white/5 text-zinc-300 text-xs font-mono">
            {activeCount} Sessions
          </div>

          {/* Audio Chime Toggle */}
          <button
            onClick={onToggleAudio}
            className={`p-2 rounded-xl border transition-all ${
              audioEnabled
                ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25'
                : 'bg-zinc-900/80 border-white/5 text-zinc-400 hover:bg-zinc-800'
            }`}
            title={audioEnabled ? 'Mute approval chime' : 'Enable approval chime'}
          >
            {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Push Notification Permission */}
          <button
            onClick={onRequestNotifications}
            className="p-2 rounded-xl bg-zinc-900/80 border border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
            title="Request Desktop Notifications"
          >
            <Bell className="w-4 h-4" />
          </button>

          {/* Connection status indicator */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
              connected
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400 animate-pulse'
            }`}
          >
            {connected ? (
              <>
                <Wifi className="w-3 h-3" /> Connected
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3" /> Offline
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
