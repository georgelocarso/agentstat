import { useEffect, useState, useRef, useCallback } from 'react';
import type { SessionSnapshot } from '@agentstat/shared';

interface UseSSEOptions {
  token?: string;
  onApprovalRequired?: (session: SessionSnapshot) => void;
  onAutoUnarchive?: (sessionId: string) => void;
}

export function useSSE({ token, onApprovalRequired, onAutoUnarchive }: UseSSEOptions = {}) {
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(null);
  const previousStateMap = useRef<Map<string, string>>(new Map());

  const handleUpdate = useCallback(
    (snapshot: SessionSnapshot) => {
      setSessions((prev) => {
        const next = [...prev];
        const index = next.findIndex((s) => s.sessionId === snapshot.sessionId);
        if (index >= 0) {
          next[index] = snapshot;
        } else {
          next.push(snapshot);
        }
        return next;
      });

      const prevState = previousStateMap.current.get(snapshot.sessionId);
      if (snapshot.state === 'waiting_approval' && prevState !== 'waiting_approval') {
        onApprovalRequired?.(snapshot);
      }

      // Auto-unarchive only when a session genuinely transitions back to an active state
      // (working or waiting_approval) after having previously been inactive, completed, or unobserved.
      const isNowActive = snapshot.state === 'working' || snapshot.state === 'waiting_approval';
      const wasInactiveOrDifferent = prevState !== undefined && prevState !== 'working' && prevState !== 'waiting_approval';
      if (isNowActive && wasInactiveOrDifferent) {
        onAutoUnarchive?.(snapshot.sessionId);
      }

      previousStateMap.current.set(snapshot.sessionId, snapshot.state);
    },
    [onApprovalRequired, onAutoUnarchive]
  );

  useEffect(() => {
    let url = '/api/events/stream';
    if (token) {
      url += `?token=${encodeURIComponent(token)}`;
    }

    let es: EventSource | null = null;
    let retryTimeout: any = null;

    function connect() {
      es = new EventSource(url);

      es.onopen = () => {
        setConnected(true);
      };

      es.onmessage = (event) => {
        setLastHeartbeat(new Date());
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'initial_snapshot') {
            const list: SessionSnapshot[] = payload.data;
            setSessions(list);
            list.forEach((s) => previousStateMap.current.set(s.sessionId, s.state));
          } else if (payload.type === 'session_update') {
            handleUpdate(payload.data);
          } else if (payload.type === 'session_deleted') {
            const deletedId = payload.data.sessionId;
            setSessions((prev) => prev.filter((s) => s.sessionId !== deletedId));
            previousStateMap.current.delete(deletedId);
          }
        } catch {
          // ignore keepalive comments or non-json
        }
      };

      es.onerror = () => {
        setConnected(false);
        es?.close();
        retryTimeout = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      if (retryTimeout) clearTimeout(retryTimeout);
      es?.close();
    };
  }, [token, handleUpdate]);

  return { sessions, connected, lastHeartbeat };
}
