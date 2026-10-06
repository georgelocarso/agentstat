import React from 'react';
import type { SessionSnapshot } from '@agentstat/shared';
import { StateBadge } from './StateBadge';
import {
  X,
  Folder,
  Terminal,
  CheckCircle2,
  GitBranch,
  Clock,
  Pin,
  Archive,
  ArchiveRestore,
  Copy,
  Check,
} from 'lucide-react';

interface SessionDetailModalProps {
  session: SessionSnapshot | null;
  onClose: () => void;
  pinned: boolean;
  onTogglePinned: (sessionId: string) => void;
  isArchived: boolean;
  onArchive: (sessionId: string) => void;
  onUnarchive: (sessionId: string) => void;
}

export const SessionDetailModal: React.FC<SessionDetailModalProps> = ({
  session,
  onClose,
  pinned,
  onTogglePinned,
  isArchived,
  onArchive,
  onUnarchive,
}) => {
  const [copiedPrompt, setCopiedPrompt] = React.useState(false);
  const [copiedPath, setCopiedPath] = React.useState(false);
  const [copiedOutput, setCopiedOutput] = React.useState(false);
  const [customAnswer, setCustomAnswer] = React.useState('');
  const [respondStatus, setRespondStatus] = React.useState<string | null>(null);

  if (!session) return null;

  const handleSendAnswer = async (answer: string) => {
    try {
      const token = localStorage.getItem('agentstat_token') || '';
      const res = await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ answer }),
      });
      if (res.ok) {
        setRespondStatus(`Response "${answer}" sent to session`);
        setTimeout(() => setRespondStatus(null), 4000);
      } else {
        setRespondStatus(`Failed to send response (${res.status})`);
      }
    } catch {
      setRespondStatus('Error sending response');
    }
  };

  const handleCopyPrompt = () => {
    if (session.promptSnippet) {
      navigator.clipboard.writeText(session.promptSnippet);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    }
  };

  const handleCopyPath = () => {
    const path = session.displayPath;
    if (path) {
      navigator.clipboard.writeText(path);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    }
  };

  const handleCopyOutput = () => {
    if (session.outputSnippet) {
      navigator.clipboard.writeText(session.outputSnippet);
      setCopiedOutput(true);
      setTimeout(() => setCopiedOutput(false), 2000);
    }
  };

  const isWaiting = session.state === 'waiting_approval';
  const startedFormatted = new Date(session.startedAt).toLocaleString();
  const lastSeenFormatted = new Date(session.lastSeenAt).toLocaleString();

  // Handle escape key
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-3xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between p-6 border-b border-slate-800/80 bg-slate-950/40">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 mt-1">
              <Folder className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 id="modal-title" className="text-xl font-bold text-white tracking-tight">
                  {session.project}
                </h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono border border-slate-700">
                  {session.agentType}
                </span>
                <StateBadge state={session.state} />
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-slate-400 font-mono">
                <span>{session.displayPath}</span>
                <button
                  type="button"
                  onClick={handleCopyPath}
                  title="Copy working path"
                  className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {copiedPath ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Pin action */}
            <button
              type="button"
              onClick={() => onTogglePinned(session.sessionId)}
              title={pinned ? 'Unpin session' : 'Pin session'}
              className={`p-2 rounded-lg border transition-colors ${
                pinned
                  ? 'text-amber-300 bg-amber-500/15 border-amber-500/40'
                  : 'text-slate-400 border-slate-700/60 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Pin className={`w-4 h-4 ${pinned ? 'fill-current' : ''}`} />
            </button>

            {/* Archive / Unarchive */}
            {isArchived ? (
              <button
                type="button"
                onClick={() => onUnarchive(session.sessionId)}
                title="Unarchive session"
                className="p-2 rounded-lg border border-slate-700/60 text-slate-400 hover:text-emerald-300 hover:bg-emerald-950/30 transition-colors"
              >
                <ArchiveRestore className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onArchive(session.sessionId)}
                title="Archive session"
                className="p-2 rounded-lg border border-slate-700/60 text-slate-400 hover:text-amber-300 hover:bg-amber-950/30 transition-colors"
              >
                <Archive className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              title="Close modal"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Metadata badges */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {session.gitBranch && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 font-mono text-slate-300">
                <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
                <span>Branch: {session.gitBranch}</span>
              </div>
            )}
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-slate-400 font-mono">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span>Started: {startedFormatted}</span>
            </div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-slate-400 font-mono">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              <span>Last Active: {lastSeenFormatted}</span>
            </div>
          </div>

          {/* User Request / Pending Question */}
          {session.promptSnippet ? (
            <div
              className={`p-4 rounded-xl border ${
                isWaiting
                  ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                  : 'bg-slate-950/60 border-slate-800 text-slate-300'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{isWaiting ? 'Pending Approval / Prompt Request' : 'User Prompt'}</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyPrompt}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {copiedPrompt ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" /> Copy
                    </>
                  )}
                </button>
              </div>
              <p className="font-mono text-xs whitespace-pre-wrap leading-relaxed select-all">
                {session.promptSnippet}
              </p>

              {/* Interactive Approval / Response form */}
              {isWaiting && (
                <div className="mt-4 pt-3 border-t border-amber-500/30">
                  <div className="text-xs font-semibold text-amber-300 mb-2">
                    Submit Response or Approval:
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSendAnswer('yes')}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950/50 transition-colors"
                    >
                      Approve (yes)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSendAnswer('no')}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600/80 hover:bg-red-600 text-white transition-colors"
                    >
                      Reject (no)
                    </button>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (customAnswer.trim()) {
                          handleSendAnswer(customAnswer.trim());
                          setCustomAnswer('');
                        }
                      }}
                      className="flex-1 min-w-[200px] flex items-center gap-2"
                    >
                      <input
                        type="text"
                        placeholder="Type custom reply / answer..."
                        value={customAnswer}
                        onChange={(e) => setCustomAnswer(e.target.value)}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors"
                      >
                        Send
                      </button>
                    </form>
                  </div>
                  {respondStatus && (
                    <p className="text-[11px] text-emerald-400 mt-2 font-mono">
                      ✓ {respondStatus}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-dashed border-slate-800 text-xs text-slate-500 text-center font-mono">
              No prompt snippet recorded
            </div>
          )}

          {/* Agent Output / Response */}
          {session.outputSnippet ? (
            <div className="p-4 rounded-xl border bg-slate-950/60 border-slate-800 text-slate-300">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Agent Output & Response Logs</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyOutput}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {copiedOutput ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" /> Copy
                    </>
                  )}
                </button>
              </div>
              <pre className="font-mono text-xs whitespace-pre-wrap leading-relaxed select-all bg-slate-900/60 p-3.5 rounded-lg border border-slate-800/80 overflow-x-auto text-slate-200">
                {session.outputSnippet}
              </pre>
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-dashed border-slate-800 text-xs text-slate-500 text-center font-mono">
              No recent output snippet available
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 px-6 border-t border-slate-800/80 bg-slate-950/40 flex items-center justify-between text-xs text-slate-500">
          <span className="font-mono text-[11px]">ID: {session.sessionId}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
