"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WS_URL } from "./api";
import type { ConnectionState, FrameMessage, HistoryPoint, ServerMessage, Stats, StatusMessage } from "./types";

const HISTORY_WINDOW_MS = 2 * 60 * 1000;
const HISTORY_SAMPLE_MS = 500;
const BACKOFF_STEPS_MS = [500, 1000, 2000, 4000, 8000];

type FrameListener = (frame: FrameMessage) => void;

export interface HeadcountState {
  connection: ConnectionState;
  /** Number of consecutive failed connection attempts. */
  failures: number;
  status: StatusMessage | null;
  stats: Stats | null;
  history: HistoryPoint[];
  hasFrame: boolean;
  subscribeFrame: (fn: FrameListener) => () => void;
  latestFrame: () => FrameMessage | null;
  clearHistory: () => void;
  applyStatus: (s: StatusMessage) => void;
}

export function useHeadcount(): HeadcountState {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [failures, setFailures] = useState(0);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [hasFrame, setHasFrame] = useState(false);

  const listeners = useRef(new Set<FrameListener>());
  const latest = useRef<FrameMessage | null>(null);
  const lastSample = useRef(0);

  const subscribeFrame = useCallback((fn: FrameListener) => {
    listeners.current.add(fn);
    if (latest.current) fn(latest.current);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const latestFrame = useCallback(() => latest.current, []);
  const clearHistory = useCallback(() => {
    setHistory([]);
    lastSample.current = 0;
  }, []);
  const applyStatus = useCallback((s: StatusMessage) => setStatus(s), []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    const handleMessage = (event: MessageEvent<string>) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === "status") {
        setStatus(msg);
        if (msg.state === "connecting" || msg.state === "loading_model") {
          // New source / restart: the old frame is no longer meaningful.
          setHasFrame(false);
          setStats(null);
          latest.current = null;
          setHistory([]);
        }
        return;
      }
      if (msg.type === "frame") {
        latest.current = msg;
        setHasFrame(true);
        setStats(msg.stats);
        listeners.current.forEach((fn) => fn(msg));
        const now = Date.now();
        if (now - lastSample.current >= HISTORY_SAMPLE_MS) {
          lastSample.current = now;
          setHistory((prev) => {
            const cutoff = now - HISTORY_WINDOW_MS;
            const next = prev.length && prev[0].t < cutoff ? prev.filter((p) => p.t >= cutoff) : prev.slice();
            next.push({ t: now, v: msg.stats.smoothed_count });
            return next;
          });
        }
      }
    };

    const connect = () => {
      if (disposed) return;
      setConnection(attempt === 0 ? "connecting" : (prev) => (prev === "open" ? "connecting" : prev));
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        attempt = 0;
        setFailures(0);
        setConnection("open");
      };
      ws.onmessage = handleMessage;
      ws.onclose = () => {
        if (disposed) return;
        attempt += 1;
        setFailures(attempt);
        setConnection(attempt >= 2 ? "unreachable" : "connecting");
        const delay = BACKOFF_STEPS_MS[Math.min(attempt - 1, BACKOFF_STEPS_MS.length - 1)];
        retryTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => {
        // onclose follows; reconnection is handled there.
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);

  return {
    connection,
    failures,
    status,
    stats,
    history,
    hasFrame,
    subscribeFrame,
    latestFrame,
    clearHistory,
    applyStatus,
  };
}
