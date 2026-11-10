"use client";

import { useState } from "react";
import { BACKEND_URL } from "@/lib/api";
import type { BackendError } from "@/lib/types";

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(ellipse_at_center,rgba(9,9,11,0.55),rgba(9,9,11,0.92))] p-6">
      <div className="w-full max-w-md text-center">{children}</div>
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold tracking-tight text-fg">{children}</h3>;
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>;
}

function Spinner() {
  return (
    <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" aria-hidden />
  );
}

function IconBadge({ tone, children }: { tone: "error" | "warn"; children: React.ReactNode }) {
  return (
    <div
      className={`mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full border ${
        tone === "error" ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : "border-amber-400/30 bg-amber-400/10 text-amber-300"
      }`}
    >
      {children}
    </div>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-bg py-1.5 pl-3 pr-1.5 text-left">
      <span className="select-none font-mono text-xs text-faint">$</span>
      <code className="flex-1 truncate font-mono text-xs text-fg">{command}</code>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(command).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="rounded-md border border-line bg-raised px-2 py-1 text-[11px] text-muted transition-colors hover:text-fg"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function BackendDownPanel({ failures }: { failures: number }) {
  return (
    <Overlay>
      <IconBadge tone="error">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 4.5v4M8 11h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </IconBadge>
      <Title>Backend isn’t running</Title>
      <Body>
        Couldn’t reach <span className="font-mono text-fg">{BACKEND_URL}</span>. Start it from the repo root, and this page will
        reconnect automatically.
      </Body>
      <CopyCommand command="make backend" />
      <p className="mt-2 text-[11px] text-faint">
        or with a video file: <span className="font-mono">make backend SOURCE=path/to/video.mp4</span>
      </p>
      <p className="mt-4 text-[11px] text-faint">Retrying… attempt {failures}</p>
    </Overlay>
  );
}

export function LoadingPanel({ title, body }: { title: string; body: string }) {
  return (
    <Overlay>
      <Spinner />
      <Title>{title}</Title>
      <Body>{body}</Body>
    </Overlay>
  );
}

export function SourceErrorPanel({ error, isCamera }: { error: BackendError; isCamera: boolean }) {
  if (error.code === "camera_unavailable" && isCamera) {
    return (
      <Overlay>
        <IconBadge tone="warn">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2.5 5.5h2l1-1.5h5l1 1.5h2v7h-11v-7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M2 2l12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </IconBadge>
        <Title>Camera unavailable</Title>
        <Body>
          macOS only lets apps use the camera after you allow it. The backend runs inside your terminal, so the{" "}
          <span className="text-fg">terminal app</span> (Terminal, iTerm, VS Code, …) needs access.
        </Body>
        <ol className="mx-auto mt-4 max-w-sm space-y-1.5 text-left text-xs text-muted">
          <li>
            <span className="mr-2 font-mono text-faint">1</span>Open{" "}
            <span className="text-fg">System Settings → Privacy &amp; Security → Camera</span>
          </li>
          <li>
            <span className="mr-2 font-mono text-faint">2</span>Turn on access for your terminal app
          </li>
          <li>
            <span className="mr-2 font-mono text-faint">3</span>Quit and reopen the terminal, then run <span className="font-mono text-fg">make backend</span>
          </li>
        </ol>
        <p className="mt-4 text-[11px] text-faint">Also check that no other app is using the camera. Retrying every few seconds.</p>
      </Overlay>
    );
  }
  const titles: Record<string, string> = {
    source_not_found: "Video file not found",
    source_unreadable: "Can’t read video source",
    source_ended: "Video ended",
    model_error: "Model failed to load",
    inference_error: "Inference error",
  };
  return (
    <Overlay>
      <IconBadge tone="error">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 4.5v4M8 11h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </IconBadge>
      <Title>{titles[error.code] ?? "Something went wrong"}</Title>
      <Body>{error.message}</Body>
    </Overlay>
  );
}
