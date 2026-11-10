# Headcount

A local, real-time people counter for macOS. It captures video from your MacBook camera (or a video file), detects people with Ultralytics YOLO on the Apple GPU (MPS), and streams the frames and counts to a dark, minimal dashboard.

Everything runs on your machine: no cloud APIs, no database, no accounts.

```
┌─────────────┐  frames  ┌──────────────┐  JSON over /ws   ┌──────────────────────┐
│ Camera/File │ ───────▶ │  FastAPI +   │ ───────────────▶ │ Next.js dashboard    │
│ (OpenCV)    │          │  YOLO on MPS │ ◀─── REST ────── │ canvas + boxes + UI  │
└─────────────┘          └──────────────┘   /config etc.   └──────────────────────┘
```

## Requirements

- macOS on Apple Silicon (tested on an M5 Pro). Intel Macs and other OSes run on CPU, more slowly.
- Python 3.11+ (the Makefile prefers `python3.12`, then 3.11, then 3.13)
- Node 20+ and npm

## Quick start

```bash
make dev                                   # installs everything on first run, then starts both apps
open http://localhost:3000
```

On first run the model weights (`yolo26m.pt`, ~45 MB) are downloaded into `backend/weights/`. The dashboard shows a "Loading model" state until they are ready.

To use a video file instead of the camera:

```bash
make dev SOURCE=path/to/classroom.mp4
```

### Individual commands

| Command | What it does |
|---|---|
| `make setup` | Creates `backend/.venv`, installs `requirements.txt`, runs `npm install` |
| `make backend` | Backend only, on `:8000` (`SOURCE=` and `PORT=` work here too) |
| `make frontend` | Dashboard only, on `:3000` |
| `make test` | Downloads sample media and runs the backend tests (unit + end-to-end WebSocket) |
| `make build` | Frontend type check and production build |

Running the backend directly:

```bash
cd backend
.venv/bin/python run.py --source 0                # webcam index
.venv/bin/python run.py --source clip.mp4         # video file (loops by default)
.venv/bin/python run.py --source photo.jpg        # still image, served at 10 fps (handy for testing)
.venv/bin/python run.py --source 0 --port 8001 --conf 0.4 --imgsz 1280 --model yolo11m.pt
```

Other flags: `--host`, `--device cpu`, `--no-loop`. If you change the backend port, start the frontend with `NEXT_PUBLIC_BACKEND_URL=http://localhost:<port>` (`make dev PORT=8001` handles this).

## macOS camera permission

macOS grants camera access per app. The backend runs inside your terminal, so **the terminal app needs access**, whether that's Terminal, iTerm2, Warp, or VS Code's integrated terminal.

1. Open **System Settings → Privacy & Security → Camera**.
2. Turn on the toggle for your terminal app. If it isn't listed, run `make backend` once; macOS will prompt you, or add the app to the list.
3. Quit and reopen the terminal app, then run `make backend` again.

If access is denied, or another app is using the camera, the backend doesn't crash. It sends a `camera_unavailable` error to the dashboard, which shows these steps, and it retries every 3 seconds.

## How it works

**Capture.** `FrameSource` in `backend/app/pipeline.py` owns the `cv2.VideoCapture` on its own thread and keeps only the newest frame. A slow model therefore never builds up camera lag; frames it can't keep up with are dropped. Video files are paced to their native frame rate and loop when they end.

**Inference.** A second thread loads the model, warms it up, and then repeatedly takes the newest frame and runs YOLO with `classes=[0]` (COCO `person`) at the configured confidence and input size. If MPS is unavailable it falls back to CPU and logs a warning. Inference time is measured around `predict()` plus the copy back from the GPU, so it is real GPU time.

**Counting.**
- **Raw:** the number of boxes in the current frame.
- **Smoothed:** the rolling median of the last 15 raw counts. One-frame misses and false positives don't change the headline number.
- **Peak:** the highest *smoothed* count this session. It uses the smoothed count so a one-frame glitch can't set it.
- **60s average:** the mean of the smoothed count over the last 60 seconds.
- **FPS:** frames processed per second over the last 30 frames.

**Streaming.** Each processed frame becomes one JSON message on `/ws`:

```jsonc
{
  "type": "frame",
  "ts": 1731234567.89,
  "frame": { "jpeg": "<base64>", "width": 1280, "height": 720 },   // JPEG q70, max 1280 px wide
  "detections": [{ "bbox": [x1, y1, x2, y2], "confidence": 0.91 }], // bbox normalized to 0–1
  "stats": { "raw_count": 3, "smoothed_count": 3, "peak_count": 5, "avg_60s": 2.8,
             "fps": 24.1, "inference_ms": 34.2, "frames_processed": 1520 }
}
```

The server also sends `{"type": "status", "state": "loading_model" | "connecting" | "running" | "paused" | "error", "error": {code, message}, "model", "device", ...}` when a client connects and whenever the state changes. Each client gets a one-slot frame queue, so a slow browser tab skips frames instead of falling behind. Status messages are never dropped.

**Dashboard.** The browser decodes each JPEG with `createImageBitmap`, draws it to a `<canvas>`, and draws the boxes on top. The backend never draws boxes into the image, so the "show boxes" toggle is instant and snapshots stay sharp. The WebSocket reconnects with backoff (0.5 s → 8 s).

### REST API

| Method | Path | Body / notes |
|---|---|---|
| GET | `/health` | `{ok, state, model, device, error}` |
| GET | `/config` | `{source, confidence, imgsz, imgsz_options, model, device}` |
| POST | `/config` | Any of `{confidence: 0.05–0.95, imgsz: 640/960/1280, source: 0 / "path"}` |
| POST | `/control` | `{action: "pause" / "resume" / "reset_stats"}` |
| GET | `/cameras` | Tries indices 0–4 and returns the ones that open and deliver a frame |

## Choices and assumptions

- **Model:** `yolo26m.pt` is Ultralytics' current medium model. If it can't be loaded, the backend falls back to `yolo11m.pt` automatically. Override with `--model`.
- **Defaults:** confidence 0.35, input size 960. On an M5 Pro the 960 setting runs at about 35 ms per frame (640: ~21 ms, 1280: ~53 ms). For a full classroom seen from the back of the room, 1280 helps with small, distant people.
- **Pause** freezes processing and keeps the last frame on screen. The camera stays open, so resuming is instant.
- **Changing the source** resets the session stats and the trend chart.
- **The trend chart** is a hand-rolled SVG (no chart library). It is drawn as a step line because counts are whole numbers, and it samples the smoothed count twice a second. Its history lives in the browser, so it starts empty after a page reload.
- **Camera names:** OpenCV can't read macOS device names, so cameras are listed as "Camera 0", "Camera 1", and so on. Index 0 is normally the built-in camera.
- **Still images** are accepted as a source, mainly for testing. The image is repeated at 10 fps.
- **CORS** allows any `localhost` / `127.0.0.1` origin. The backend binds to `127.0.0.1` by default.
- **Reduced motion:** the rolling-digit animation is turned off when the OS "Reduce motion" setting is on.

## Project layout

```
backend/
  run.py              CLI entry point (argparse → uvicorn)
  app/config.py       settings, constants, thread-safe runtime config
  app/detector.py     YOLO loading (MPS → CPU fallback), person-only detection
  app/pipeline.py     capture thread, inference thread, JPEG encoding, state machine
  app/stats.py        median smoothing, peak, 60 s average, FPS
  app/cameras.py      camera index probing
  app/server.py       FastAPI app, REST endpoints, WebSocket broadcaster
  scripts/ws_client.py        prints what the WebSocket emits
  scripts/fetch_test_media.sh downloads sample media into backend/samples/
  tests/              unit tests + end-to-end test against a real server
frontend/
  app/                layout, page, theme (globals.css)
  components/         Dashboard, VideoCanvas, CountChart, Controls, StatePanels, …
  lib/                WebSocket hook with backoff, API client, canvas drawing
```

## Testing without a camera

```bash
make test                                          # 8 tests: stats unit tests + end-to-end over HTTP/WS
make dev SOURCE=backend/samples/people-detection.mp4
backend/.venv/bin/python backend/scripts/ws_client.py --frames 20
```

The end-to-end test starts the real server on the sample video, checks that it is running on MPS, and validates 20 WebSocket messages: decodable JPEGs, normalized boxes, and consistent stats. It also exercises config changes, pause/resume/reset, switching to a still image (expects exactly 4 people), and a missing file, which must produce an error and recover rather than crash.
