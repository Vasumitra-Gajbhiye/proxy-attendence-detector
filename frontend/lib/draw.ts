import type { Detection } from "./types";

export const BOX_COLOR = "#a3e635"; // lime-400: the single person-box color
const LABEL_TEXT = "#0b0f04";

/** Decode a base64 JPEG into something drawable without touching the DOM. */
export async function decodeJpeg(b64: string): Promise<ImageBitmap> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rr);
}

/**
 * Draws detections on a context whose coordinate space is `width` x `height` (CSS px or image px).
 * `scale` sizes strokes and labels so they look the same on screen and in snapshots.
 */
export function drawDetections(
  ctx: CanvasRenderingContext2D,
  detections: Detection[],
  width: number,
  height: number,
  scale = 1,
) {
  const stroke = 2 * scale;
  const fontSize = 11 * scale;
  const padX = 5 * scale;
  const labelH = 17 * scale;
  ctx.save();
  ctx.font = `600 ${fontSize}px "Geist", "Inter", ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "middle";

  for (const d of detections) {
    const [nx1, ny1, nx2, ny2] = d.bbox;
    const x = nx1 * width;
    const y = ny1 * height;
    const w = (nx2 - nx1) * width;
    const h = (ny2 - ny1) * height;

    // Soft fill + crisp stroke
    roundRectPath(ctx, x, y, w, h, 6 * scale);
    ctx.fillStyle = "rgba(163, 230, 53, 0.07)";
    ctx.fill();
    ctx.lineWidth = stroke;
    ctx.strokeStyle = BOX_COLOR;
    ctx.stroke();

    // Confidence label, inside the box if there's no room above it
    const text = `${Math.round(d.confidence * 100)}%`;
    const tw = ctx.measureText(text).width + padX * 2;
    const lx = Math.min(Math.max(x, 0), width - tw);
    const ly = y - labelH - 3 * scale >= 0 ? y - labelH - 3 * scale : y + 3 * scale;
    roundRectPath(ctx, lx, ly, tw, labelH, 4 * scale);
    ctx.fillStyle = BOX_COLOR;
    ctx.fill();
    ctx.fillStyle = LABEL_TEXT;
    ctx.fillText(text, lx + padX, ly + labelH / 2 + 0.5 * scale);
  }
  ctx.restore();
}
