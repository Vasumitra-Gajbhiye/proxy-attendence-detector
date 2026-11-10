import type { Stats } from "@/lib/types";
import { RollingNumber } from "./RollingNumber";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-surface ${className}`}>{children}</section>;
}

export function CardLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{children}</h2>
      {right}
    </div>
  );
}

export function CountHero({ stats }: { stats: Stats | null }) {
  return (
    <Card className="relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/10 blur-3xl" />
      <CardLabel right={<span className="text-[11px] text-faint">median · 15 frames</span>}>People in view</CardLabel>
      <div className="mt-3 flex items-end gap-3">
        <RollingNumber value={stats?.smoothed_count ?? 0} className={`text-[88px] font-semibold tracking-tighter ${stats ? "text-fg" : "text-faint"}`} />
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span className="rounded bg-raised px-1.5 py-0.5 font-mono tabular-nums text-fg">{stats?.raw_count ?? "–"}</span>
        <span>raw this frame</span>
      </div>
    </Card>
  );
}

function StatCard({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint: string }) {
  return (
    <Card className="p-4">
      <CardLabel>{label}</CardLabel>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-fg">{value}</span>
        {unit && <span className="text-xs text-muted">{unit}</span>}
      </div>
      <p className="mt-1 text-[11px] text-faint">{hint}</p>
    </Card>
  );
}

export function StatGrid({ stats }: { stats: Stats | null }) {
  const dash = "–";
  return (
    <div className="grid grid-cols-2 gap-3">
      <StatCard label="Peak" value={stats ? String(stats.peak_count) : dash} hint="max smoothed this session" />
      <StatCard label="Average" value={stats ? stats.avg_60s.toFixed(1) : dash} hint="last 60 seconds" />
      <StatCard label="Throughput" value={stats ? stats.fps.toFixed(1) : dash} unit="fps" hint="frames processed" />
      <StatCard label="Inference" value={stats ? stats.inference_ms.toFixed(0) : dash} unit="ms" hint="per frame, model only" />
    </div>
  );
}
