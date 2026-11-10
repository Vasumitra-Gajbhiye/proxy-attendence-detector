"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { decodeJpeg, drawDetections } from "@/lib/draw";
import type { BackendConfig, CameraInfo } from "@/lib/types";
import { useHeadcount } from "@/lib/useHeadcount";
import { CountChart } from "./CountChart";
import { Controls } from "./Controls";
import { BackendDownPanel, LoadingPanel, SourceErrorPanel } from "./StatePanels";
import { Card, CardLabel, CountHero, StatGrid } from "./Stats";
import { TopBar, type PillState } from "./TopBar";
import { VideoCanvas } from "./VideoCanvas";

export function Dashboard() {
  const hc = useHeadcount();
  const { connection, status, stats } = hc;
  const [config, setConfig] = useState<BackendConfig | null>(null);
  const [cameras, setCameras] = useState<CameraInfo[] | null>(null);
  const [camerasLoading, setCamerasLoading] = useState(false);
  const [showBoxes, setShowBoxes] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      setActionError(null);
      return await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshCameras = useCallback(async () => {
    setCamerasLoading(true);
    const res = await run(api.cameras);
    if (res) setCameras(res.cameras);
    setCamerasLoading(false);
  }, [run]);

  // Fetch config + cameras each time the socket (re)opens.
  useEffect(() => {
    if (connection !== "open") return;
    let cancelled = false;
    api
      .getConfig()
      .then((c) => !cancelled && setConfig(c))
      .catch(() => {});
    api
      .cameras()
      .then((r) => !cancelled && setCameras(r.cameras))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [connection]);

  const live = connection === "open" && status !== null;
  const state = status?.state;
  const pill: PillState =
    connection === "unreachable" || state === "error"
      ? "error"
      : connection !== "open" || !state || state === "loading_model" || state === "connecting"
        ? "connecting"
        : state === "paused"
          ? "paused"
          : "live";

  const confidence = status?.config.confidence ?? config?.confidence ?? 0.35;
  const imgsz = status?.config.imgsz ?? config?.imgsz ?? 960;
  const source = status?.source ?? config?.source ?? null;

  const updateConfig = (patch: Partial<Pick<BackendConfig, "confidence" | "imgsz" | "source">>) =>
    run(async () => setConfig(await api.updateConfig(patch)));

  const snapshot = async () => {
    const frame = hc.latestFrame();
    if (!frame) return;
    const bitmap = await decodeJpeg(frame.frame.jpeg);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    drawDetections(ctx, frame.detections, canvas.width, canvas.height, Math.max(1, canvas.width / 900));
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = url;
      a.download = `headcount-${stamp}-${frame.stats.smoothed_count}people.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  };

  // Which overlay (if any) sits on top of the video
  let overlay: React.ReactNode = null;
  if (connection === "unreachable") overlay = <BackendDownPanel failures={hc.failures} />;
  else if (connection === "connecting" || !status)
    overlay = <LoadingPanel title="Connecting to backend" body="Opening a WebSocket to the local detector…" />;
  else if (state === "loading_model")
    overlay = (
      <LoadingPanel
        title={`Loading ${status.model.replace(/\.pt$/, "")}`}
        body="Warming up the detector. On first run the weights are downloaded automatically (~45 MB)."
      />
    );
  else if (state === "error" && status.error)
    overlay = <SourceErrorPanel error={status.error} isCamera={status.source_kind === "camera"} />;
  else if (state === "connecting")
    overlay = (
      <LoadingPanel
        title={status.source_kind === "camera" ? `Opening camera ${status.source}` : "Opening video"}
        body={
          status.source_kind === "camera"
            ? "If macOS asks for camera access, allow it for your terminal app."
            : String(status.source)
        }
      />
    );
  else if (!hc.hasFrame) overlay = <LoadingPanel title="Waiting for first frame" body="The detector is starting up." />;

  const sourceLabel =
    source === null ? "—" : typeof source === "number" ? `Camera ${source}` : String(source).split("/").pop();

  return (
    <div className="min-h-screen bg-bg text-fg">
      <TopBar pill={pill} model={status?.model ?? config?.model ?? null} device={status?.device ?? null} stats={stats} />

      <main className="mx-auto grid max-w-[1600px] gap-4 px-4 py-4 sm:px-6 sm:py-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left: feed + chart */}
        <div className="flex min-w-0 flex-col gap-4">
          <VideoCanvas subscribeFrame={hc.subscribeFrame} showBoxes={showBoxes} dimmed={!!overlay && hc.hasFrame}>
            {overlay}
            {!overlay && state === "paused" && (
              <div className="absolute left-3 top-3 rounded-md border border-amber-400/30 bg-black/60 px-2 py-1 text-[11px] font-medium text-amber-300 backdrop-blur">
                Paused
              </div>
            )}
            {!overlay && stats && (
              <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-md border border-white/10 bg-black/55 px-2 py-1 text-[11px] text-white/80 backdrop-blur">
                <span className="h-2 w-2 rounded-sm bg-accent" />
                {stats.raw_count} {stats.raw_count === 1 ? "person" : "people"} detected
              </div>
            )}
          </VideoCanvas>

          <Card className="px-4 pb-3 pt-4">
            <CardLabel right={<span className="text-[11px] text-faint">smoothed count · last 2 min</span>}>Trend</CardLabel>
            <div className="mt-3">
              <CountChart history={hc.history} />
            </div>
          </Card>
        </div>

        {/* Right: numbers + controls */}
        <aside className="flex min-w-0 flex-col gap-4">
          <CountHero stats={stats} />
          <StatGrid stats={stats} />
          <Controls
            disabled={!live}
            confidence={confidence}
            imgsz={imgsz}
            imgszOptions={config?.imgsz_options ?? [640, 960, 1280]}
            source={source}
            cameras={cameras}
            camerasLoading={camerasLoading}
            showBoxes={showBoxes}
            paused={state === "paused"}
            canSnapshot={hc.hasFrame}
            onConfidence={(v) => updateConfig({ confidence: v })}
            onImgsz={(v) => updateConfig({ imgsz: v })}
            onSource={(v) => updateConfig({ source: v })}
            onRefreshCameras={refreshCameras}
            onShowBoxes={setShowBoxes}
            onPauseToggle={() =>
              run(async () => hc.applyStatus(await api.control(state === "paused" ? "resume" : "pause")))
            }
            onReset={() =>
              run(async () => {
                await api.control("reset_stats");
                hc.clearHistory();
              })
            }
            onSnapshot={snapshot}
          />
          {actionError && (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{actionError}</p>
          )}
          <p className="px-1 text-[11px] leading-relaxed text-faint">
            Source <span className="font-mono text-muted">{sourceLabel}</span>
            {stats && (
              <>
                {" "}
                · <span className="font-mono text-muted">{stats.frames_processed.toLocaleString()}</span> frames processed
              </>
            )}
          </p>
        </aside>
      </main>
    </div>
  );
}
