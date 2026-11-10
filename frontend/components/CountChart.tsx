"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { HistoryPoint } from "@/lib/types";

const WINDOW_MS = 2 * 60 * 1000;
const HEIGHT = 132;
const PAD = { top: 10, right: 12, bottom: 22, left: 28 };

/** Hand-rolled SVG area/line chart of the smoothed count over the last 2 minutes. */
export function CountChart({ history }: { history: HistoryPoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hoverX, setHoverX] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const now = history.length ? history[history.length - 1].t : 0;
  const start = now - WINDOW_MS;
  const maxV = Math.max(4, ...history.map((p) => p.v));
  const yMax = Math.ceil(maxV * 1.15);
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const xOf = (t: number) => PAD.left + ((t - start) / WINDOW_MS) * innerW;
  const yOf = (v: number) => PAD.top + innerH - (v / yMax) * innerH;

  const { line, area } = useMemo(() => {
    if (history.length < 2) return { line: "", area: "" };
    // Step-after path: counts are discrete, so hold each value until the next sample.
    let d = `M${xOf(history[0].t).toFixed(1)},${yOf(history[0].v).toFixed(1)}`;
    for (let i = 1; i < history.length; i++) {
      const x = xOf(history[i].t).toFixed(1);
      d += `H${x}V${yOf(history[i].v).toFixed(1)}`;
    }
    const base = (PAD.top + innerH).toFixed(1);
    const a = `${d}V${base}H${xOf(history[0].t).toFixed(1)}Z`;
    return { line: d, area: a };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, width, yMax]);

  const yTicks = useMemo(() => {
    const step = Math.max(1, Math.ceil(yMax / 3));
    const ticks: number[] = [];
    for (let v = 0; v <= yMax; v += step) ticks.push(v);
    return ticks;
  }, [yMax]);

  // Hover: nearest sample to cursor
  const hovered = useMemo(() => {
    if (hoverX == null || history.length === 0) return null;
    const t = start + ((hoverX - PAD.left) / innerW) * WINDOW_MS;
    let best = history[0];
    for (const p of history) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    return best;
  }, [hoverX, history, start, innerW]);

  return (
    <div ref={wrapRef} className="relative select-none">
      <svg
        width={width}
        height={HEIGHT}
        className="block"
        onMouseMove={(e) => setHoverX(e.clientX - e.currentTarget.getBoundingClientRect().left)}
        onMouseLeave={() => setHoverX(null)}
        role="img"
        aria-label="Smoothed people count over the last two minutes"
      >
        <defs>
          <linearGradient id="countFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={yOf(v)} y2={yOf(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={yOf(v)} textAnchor="end" dominantBaseline="middle" className="fill-faint text-[10px] tabular-nums">
              {v}
            </text>
          </g>
        ))}
        {[
          [0, "−2m"],
          [0.5, "−1m"],
          [1, "now"],
        ].map(([f, label]) => (
          <text
            key={label as string}
            x={PAD.left + (f as number) * innerW}
            y={HEIGHT - 6}
            textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}
            className="fill-faint text-[10px]"
          >
            {label}
          </text>
        ))}

        {area && <path d={area} fill="url(#countFill)" />}
        {line && (
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        )}

        {hovered && (
          <g pointerEvents="none">
            <line
              x1={xOf(hovered.t)}
              x2={xOf(hovered.t)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="var(--muted)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={xOf(hovered.t)} cy={yOf(hovered.v)} r={4.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-0 rounded-md border border-line bg-raised px-2 py-1 text-[11px] shadow-lg"
          style={{
            left: Math.min(Math.max(xOf(hovered.t) - 50, 0), width - 100),
          }}
        >
          <span className="font-medium text-fg tabular-nums">{hovered.v}</span>
          <span className="text-muted"> people · {Math.max(0, Math.round((now - hovered.t) / 1000))}s ago</span>
        </div>
      )}

      {history.length < 2 && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-faint">Waiting for data…</div>
      )}
    </div>
  );
}
