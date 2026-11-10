import type { Stats } from "@/lib/types";

export type PillState = "live" | "paused" | "connecting" | "error";

const PILL: Record<PillState, { label: string; dot: string; ring: string; text: string }> = {
  live: { label: "Live", dot: "bg-accent", ring: "border-accent/30 bg-accent/10", text: "text-accent" },
  paused: { label: "Paused", dot: "bg-amber-400", ring: "border-amber-400/30 bg-amber-400/10", text: "text-amber-300" },
  connecting: { label: "Connecting", dot: "bg-sky-400", ring: "border-sky-400/30 bg-sky-400/10", text: "text-sky-300" },
  error: { label: "Error", dot: "bg-rose-500", ring: "border-rose-500/30 bg-rose-500/10", text: "text-rose-300" },
};

export function StatusPill({ state }: { state: PillState }) {
  const p = PILL[state];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${p.ring} ${p.text}`}>
      <span className="relative flex h-1.5 w-1.5">
        {(state === "live" || state === "connecting") && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${p.dot}`} />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${p.dot}`} />
      </span>
      {p.label}
    </span>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-faint">{label}</span>
      <span className="font-mono text-muted">{value}</span>
    </div>
  );
}

export function TopBar({
  pill,
  model,
  device,
  stats,
}: {
  pill: PillState;
  model: string | null;
  device: string | null;
  stats: Stats | null;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-sm font-semibold tracking-tight text-fg">Headcount</span>
        </div>
        <StatusPill state={pill} />
        <div className="ml-auto hidden items-center gap-5 sm:flex">
          <Meta label="Model" value={model?.replace(/\.pt$/, "") ?? "—"} />
          <Meta
            label="Device"
            value={
              device ? (
                <span className={device === "mps" ? "text-fg" : "text-amber-300"}>{device.toUpperCase()}</span>
              ) : (
                "—"
              )
            }
          />
          <Meta label="Inference" value={stats ? `${stats.inference_ms.toFixed(1)} ms` : "—"} />
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="6" className="fill-raised stroke-line" />
      <circle cx="12" cy="9.5" r="3" fill="var(--accent)" />
      <path d="M6.5 18.5c.9-2.8 3-4.2 5.5-4.2s4.6 1.4 5.5 4.2" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
