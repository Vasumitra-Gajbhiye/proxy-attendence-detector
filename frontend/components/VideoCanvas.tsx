"use client";

import { useEffect, useRef, useState } from "react";
import { decodeJpeg, drawDetections } from "@/lib/draw";
import type { FrameMessage } from "@/lib/types";

interface Props {
  subscribeFrame: (fn: (f: FrameMessage) => void) => () => void;
  showBoxes: boolean;
  dimmed: boolean;
  children?: React.ReactNode;
}

export function VideoCanvas({ subscribeFrame, showBoxes, dimmed, children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const frameRef = useRef<FrameMessage | null>(null);
  const showBoxesRef = useRef(showBoxes);
  const [aspect, setAspect] = useState(16 / 9);

  const redraw = () => {
    const canvas = canvasRef.current;
    const bitmap = bitmapRef.current;
    const frame = frameRef.current;
    if (!canvas || !bitmap || !frame) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, rect.width, rect.height);
    if (showBoxesRef.current) drawDetections(ctx, frame.detections, rect.width, rect.height, 1);
  };

  useEffect(() => {
    showBoxesRef.current = showBoxes;
    redraw();
  }, [showBoxes]);

  useEffect(() => {
    let latestToken = 0;
    const unsubscribe = subscribeFrame(async (frame) => {
      const token = ++latestToken;
      let bitmap: ImageBitmap;
      try {
        bitmap = await decodeJpeg(frame.frame.jpeg);
      } catch {
        return;
      }
      if (token !== latestToken) {
        bitmap.close(); // a newer frame already arrived; drop this one
        return;
      }
      bitmapRef.current?.close();
      bitmapRef.current = bitmap;
      frameRef.current = frame;
      const nextAspect = frame.frame.width / frame.frame.height;
      setAspect((prev) => (Math.abs(prev - nextAspect) > 0.001 ? nextAspect : prev));
      redraw();
    });
    const ro = new ResizeObserver(() => redraw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => {
      unsubscribe();
      ro.disconnect();
    };
  }, [subscribeFrame]);

  return (
    <div
      ref={wrapRef}
      className="relative mx-auto overflow-hidden rounded-xl border border-line bg-[#060607] shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_20px_50px_-20px_rgba(0,0,0,0.8)]"
      // Full width for landscape feeds, but never taller than the viewport allows (portrait sources).
      style={{ aspectRatio: aspect, width: `min(100%, calc((100vh - 120px) * ${aspect.toFixed(4)}))` }}
    >
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full transition-[filter,opacity] duration-300 ${dimmed ? "opacity-40 saturate-50" : ""}`}
      />
      {children}
    </div>
  );
}
