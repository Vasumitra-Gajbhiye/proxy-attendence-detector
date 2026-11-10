"use client";

import { useEffect, useRef, useState } from "react";
import type { CameraInfo } from "@/lib/types";
import { Card, CardLabel } from "./Stats";

interface Props {
  disabled: boolean;
  confidence: number;
  imgsz: number;
  imgszOptions: number[];
  source: number | string | null;
  cameras: CameraInfo[] | null;
  camerasLoading: boolean;
  showBoxes: boolean;
  paused: boolean;
  canSnapshot: boolean;
  onConfidence: (v: number) => void;
  onImgsz: (v: number) => void;
  onSource: (v: number | string) => void;
  onRefreshCameras: () => void;
  onShowBoxes: (v: boolean) => void;
  onPauseToggle: () => void;
  onReset: () => void;
  onSnapshot: () => void;
}

export function Controls(p: Props) {
  const [conf, setConf] = useState(p.confidence);
  const dragging = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow server-side value unless the user is mid-drag.
  useEffect(() => {
    if (!dragging.current) setConf(p.confidence);
  }, [p.confidence]);

  const changeConf = (v: number) => {
    setConf(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => p.onConfidence(v), 120);
  };

  const isFile = typeof p.source === "string";

  return (
    <Card className="p-4">
      <CardLabel>Controls</CardLabel>

      <div className="mt-4 space-y-5">
        {/* Confidence */}
        <div>
          <div className="mb-2 flex items-center justify-between text-xs">
            <label htmlFor="conf" className="text-muted">Confidence threshold</label>
            <span className="font-mono tabular-nums text-fg">{conf.toFixed(2)}</span>
          </div>
          <input
            id="conf"
            type="range"
            min={0.05}
            max={0.95}
            step={0.01}
            value={conf}
            disabled={p.disabled}
            onPointerDown={() => (dragging.current = true)}
            onPointerUp={() => (dragging.current = false)}
            onChange={(e) => changeConf(Number(e.target.value))}
            className="slider w-full"
            style={{ ["--fill" as string]: `${((conf - 0.05) / 0.9) * 100}%` }}
          />
        </div>

        {/* Input size */}
        <div>
          <div className="mb-2 text-xs text-muted">Input size</div>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-bg p-1" role="radiogroup" aria-label="Input size">
            {p.imgszOptions.map((size) => (
              <button
                key={size}
                role="radio"
                aria-checked={p.imgsz === size}
                disabled={p.disabled}
                onClick={() => p.onImgsz(size)}
                className={`rounded-md py-1.5 font-mono text-xs transition-colors disabled:opacity-50 ${
                  p.imgsz === size ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--line-strong)]" : "text-muted hover:text-fg"
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        {/* Source */}
        <div>
          <div className="mb-2 flex items-center justify-between text-xs">
            <label htmlFor="camera" className="text-muted">Source</label>
            <button
              onClick={p.onRefreshCameras}
              disabled={p.disabled || p.camerasLoading}
              className="text-faint transition-colors hover:text-fg disabled:opacity-50"
            >
              {p.camerasLoading ? "Scanning…" : "Rescan"}
            </button>
          </div>
          <div className="relative">
            <select
              id="camera"
              value={p.source === null ? "" : String(p.source)}
              disabled={p.disabled}
              onChange={(e) => p.onSource(/^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value)}
              className="w-full appearance-none rounded-lg border border-line bg-bg px-3 py-2 pr-8 text-sm text-fg outline-none transition-colors hover:border-line-strong focus:border-accent/60 disabled:opacity-50"
            >
              {isFile && <option value={String(p.source)}>File · {String(p.source).split("/").pop()}</option>}
              {(p.cameras ?? []).map((c) => (
                <option key={c.index} value={String(c.index)}>
                  {c.label}
                  {c.index === 0 ? " (built-in)" : ""}
                </option>
              ))}
              {!isFile && p.source !== null && !(p.cameras ?? []).some((c) => c.index === p.source) && (
                <option value={String(p.source)}>Camera {String(p.source)}</option>
              )}
            </select>
            <svg className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" viewBox="0 0 16 16" fill="none">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {/* Boxes toggle */}
        <label className="flex cursor-pointer items-center justify-between text-xs">
          <span className="text-muted">Show detection boxes</span>
          <button
            role="switch"
            aria-checked={p.showBoxes}
            onClick={() => p.onShowBoxes(!p.showBoxes)}
            className={`relative h-5 w-9 rounded-full border transition-colors ${
              p.showBoxes ? "border-accent/50 bg-accent/80" : "border-line bg-raised"
            }`}
          >
            <span
              className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white shadow transition-[left] ${
                p.showBoxes ? "left-[18px]" : "left-[2px]"
              }`}
            />
          </button>
        </label>

        {/* Actions */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <ActionButton onClick={p.onPauseToggle} disabled={p.disabled} primary>
            {p.paused ? <PlayIcon /> : <PauseIcon />}
            {p.paused ? "Resume" : "Pause"}
          </ActionButton>
          <ActionButton onClick={p.onReset} disabled={p.disabled}>
            <ResetIcon />
            Reset
          </ActionButton>
          <ActionButton onClick={p.onSnapshot} disabled={!p.canSnapshot}>
            <CameraIcon />
            Snapshot
          </ActionButton>
        </div>
      </div>
    </Card>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        primary
          ? "border-transparent bg-fg text-bg hover:bg-white"
          : "border-line bg-raised text-fg hover:border-line-strong hover:bg-[#1f1f23]"
      }`}
    >
      {children}
    </button>
  );
}

const iconProps = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true } as const;
const PauseIcon = () => (
  <svg {...iconProps}>
    <rect x="4" y="3" width="2.5" height="10" rx="1" fill="currentColor" />
    <rect x="9.5" y="3" width="2.5" height="10" rx="1" fill="currentColor" />
  </svg>
);
const PlayIcon = () => (
  <svg {...iconProps}>
    <path d="M5 3.5v9l7-4.5-7-4.5z" fill="currentColor" />
  </svg>
);
const ResetIcon = () => (
  <svg {...iconProps}>
    <path d="M3 8a5 5 0 1 0 1.5-3.5M3 3v2.5h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CameraIcon = () => (
  <svg {...iconProps}>
    <path d="M2.5 5.5h2l1-1.5h5l1 1.5h2v7h-11v-7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <circle cx="8" cy="8.75" r="2" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);
