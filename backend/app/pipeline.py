"""Capture + inference pipeline.

Two background threads per running source:

* FrameSource thread: owns the cv2.VideoCapture and keeps only the *latest* frame,
  so a slow detector never builds up camera latency. Video files are paced to their
  native FPS and looped.
* Pipeline worker thread: loads the model, then repeatedly takes the newest frame,
  runs detection, updates stats, encodes a JPEG and hands a ready-to-send JSON string
  to the `publish` callback. Nothing here ever runs on the asyncio event loop.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import threading
import time
from typing import Callable

import cv2
import numpy as np

from .config import STREAM_JPEG_QUALITY, STREAM_MAX_WIDTH, RuntimeConfig
from .detector import PersonDetector
from .stats import SessionStats

log = logging.getLogger("headcount.pipeline")

PublishFn = Callable[[str], None]


class SourceError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


class StillImageCapture:
    """Minimal cv2.VideoCapture look-alike that serves one image forever at 10 FPS."""

    def __init__(self, path: str) -> None:
        self._frame = cv2.imread(path)

    def isOpened(self) -> bool:
        return self._frame is not None

    def read(self):
        return (self._frame is not None), (None if self._frame is None else self._frame.copy())

    def get(self, prop: int) -> float:
        return 10.0 if prop == cv2.CAP_PROP_FPS else 0.0

    def release(self) -> None:
        pass


def open_capture(source: int | str) -> cv2.VideoCapture:
    if isinstance(source, int):
        backend = cv2.CAP_AVFOUNDATION if hasattr(cv2, "CAP_AVFOUNDATION") else cv2.CAP_ANY
        cap = cv2.VideoCapture(source, backend)
        if not cap.isOpened():
            cap.release()
            raise SourceError(
                "camera_unavailable",
                f"Could not open camera {source}. On macOS this usually means the app running the backend "
                "(Terminal, iTerm, VS Code…) has not been granted camera access in System Settings → "
                "Privacy & Security → Camera, or another app is using the camera.",
            )
        return cap

    is_url = "://" in source
    if not is_url and not os.path.exists(source):
        raise SourceError("source_not_found", f"Video file not found: {source}")
    cap = StillImageCapture(source) if source.lower().endswith(IMAGE_EXTS) else cv2.VideoCapture(source)
    if not cap.isOpened():
        cap.release()
        raise SourceError("source_unreadable", f"OpenCV could not open video source: {source}")
    return cap


class FrameSource:
    """Reads frames on its own thread and exposes the most recent one."""

    def __init__(self, source: int | str, loop_video: bool = True) -> None:
        self.source = source
        self.is_file = not isinstance(source, int)
        self.loop_video = loop_video
        self._cap = open_capture(source)
        # Validate that frames actually arrive (a denied camera can "open" yet deliver nothing).
        ok, frame = self._read_first_frame()
        if not ok:
            self._cap.release()
            if self.is_file:
                raise SourceError("source_unreadable", f"No frames could be read from {source}")
            raise SourceError(
                "camera_unavailable",
                f"Camera {source} opened but returned no frames. Check camera permission for your terminal app "
                "in System Settings → Privacy & Security → Camera.",
            )
        fps = self._cap.get(cv2.CAP_PROP_FPS) if self.is_file else 0
        self._frame_interval = 1.0 / fps if self.is_file and fps and 1 <= fps <= 240 else (1 / 30 if self.is_file else 0)
        self._cond = threading.Condition()
        self._frame: np.ndarray | None = frame
        self._seq = 1
        self._failed: SourceError | None = None
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="frame-source", daemon=True)
        self._thread.start()

    def _read_first_frame(self) -> tuple[bool, np.ndarray | None]:
        deadline = time.monotonic() + (2.0 if self.is_file else 4.0)
        while time.monotonic() < deadline:
            ok, frame = self._cap.read()
            if ok and frame is not None and frame.size:
                return True, frame
            time.sleep(0.05)
        return False, None

    def _run(self) -> None:
        consecutive_failures = 0
        next_due = time.monotonic()
        while not self._stop.is_set():
            ok, frame = self._cap.read()
            if not ok or frame is None:
                if self.is_file and self.loop_video:
                    self._cap.release()
                    try:
                        self._cap = open_capture(self.source)
                    except SourceError as exc:
                        self._fail(exc)
                        return
                    continue
                if self.is_file:
                    self._fail(SourceError("source_ended", "Reached the end of the video file."))
                    return
                consecutive_failures += 1
                if consecutive_failures > 50:
                    self._fail(SourceError("camera_unavailable", "The camera stopped delivering frames."))
                    return
                time.sleep(0.02)
                continue
            consecutive_failures = 0
            with self._cond:
                self._frame = frame
                self._seq += 1
                self._cond.notify_all()
            if self._frame_interval:
                next_due += self._frame_interval
                delay = next_due - time.monotonic()
                if delay > 0:
                    time.sleep(delay)
                else:
                    next_due = time.monotonic()
        self._cap.release()

    def _fail(self, exc: SourceError) -> None:
        with self._cond:
            self._failed = exc
            self._cond.notify_all()
        self._cap.release()

    def latest(self, after_seq: int, timeout: float = 1.0) -> tuple[int, np.ndarray | None]:
        """Block until a frame newer than `after_seq` is available (or timeout)."""
        with self._cond:
            self._cond.wait_for(lambda: self._seq > after_seq or self._failed is not None or self._stop.is_set(), timeout)
            if self._failed is not None:
                raise self._failed
            if self._seq > after_seq:
                return self._seq, self._frame
            return after_seq, None

    def close(self) -> None:
        self._stop.set()
        with self._cond:
            self._cond.notify_all()
        self._thread.join(timeout=2)


def encode_jpeg_b64(frame: np.ndarray) -> tuple[str, int, int]:
    h, w = frame.shape[:2]
    if w > STREAM_MAX_WIDTH:
        scale = STREAM_MAX_WIDTH / w
        frame = cv2.resize(frame, (STREAM_MAX_WIDTH, round(h * scale)), interpolation=cv2.INTER_AREA)
        h, w = frame.shape[:2]
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, STREAM_JPEG_QUALITY])
    if not ok:
        raise RuntimeError("JPEG encoding failed")
    return base64.b64encode(buf.tobytes()).decode("ascii"), w, h


class Pipeline:
    def __init__(self, config: RuntimeConfig, publish: PublishFn) -> None:
        self.config = config
        self._publish = publish
        self.stats = SessionStats()
        self.detector: PersonDetector | None = None

        self._lock = threading.Lock()
        self._state = "loading_model"
        self._error: dict | None = None
        self._paused = False
        self._source_changed = threading.Event()
        self._reset_requested = threading.Event()
        self._stop = threading.Event()
        self._last_frame_message: str | None = None
        self._thread = threading.Thread(target=self._run, name="pipeline", daemon=True)

    # ---------- public API (called from FastAPI handlers) ----------

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=5)

    def set_paused(self, paused: bool) -> None:
        with self._lock:
            self._paused = paused
            if self._state in ("running", "paused"):
                self._state = "paused" if paused else "running"
        self._emit_status()

    def reset_stats(self) -> None:
        self._reset_requested.set()

    def notify_source_changed(self) -> None:
        self._source_changed.set()

    @property
    def last_frame_message(self) -> str | None:
        return self._last_frame_message

    def status(self) -> dict:
        settings = self.config.snapshot()
        with self._lock:
            return {
                "type": "status",
                "state": self._state,
                "paused": self._paused,
                "error": self._error,
                "model": self.detector.model_name if self.detector else settings.model,
                "device": self.detector.device if self.detector else None,
                "source": settings.source,
                "source_kind": "camera" if isinstance(settings.source, int) else "file",
                "config": {"confidence": settings.confidence, "imgsz": settings.imgsz},
            }

    # ---------- internals ----------

    def _set_state(self, state: str, error: dict | None = None) -> None:
        with self._lock:
            if state == "running" and self._paused:
                state = "paused"
            changed = state != self._state or error != self._error
            self._state = state
            self._error = error
        if changed:
            log.info("state -> %s%s", state, f" ({error['code']})" if error else "")
            self._emit_status()

    def _emit_status(self) -> None:
        self._publish(json.dumps(self.status()))

    def _run(self) -> None:
        settings = self.config.snapshot()
        self._set_state("loading_model")
        try:
            self.detector = PersonDetector(settings.model, settings.device)
            self.detector.warmup(settings.imgsz)
        except Exception as exc:
            log.exception("Model failed to load")
            self._set_state("error", {"code": "model_error", "message": f"Failed to load model: {exc}"})
            return

        source: FrameSource | None = None
        while not self._stop.is_set():
            if source is None or self._source_changed.is_set():
                self._source_changed.clear()
                if source is not None:
                    source.close()
                    source = None
                settings = self.config.snapshot()
                self._last_frame_message = None  # don't replay a frame from the previous source
                self._set_state("connecting")
                try:
                    source = FrameSource(settings.source, settings.loop_video)
                except SourceError as exc:
                    self._set_state("error", {"code": exc.code, "message": exc.message})
                    # Retry periodically (permission may be granted, camera may be freed).
                    self._source_changed.wait(timeout=3.0)
                    continue
                self.stats.reset()
                self._last_frame_message = None
                self._set_state("running")
                seq = 0

            if self._paused:
                time.sleep(0.05)
                continue

            try:
                seq, frame = source.latest(seq, timeout=1.0)
            except SourceError as exc:
                self._set_state("error", {"code": exc.code, "message": exc.message})
                source.close()
                source = None
                self._source_changed.wait(timeout=3.0)
                continue
            if frame is None:
                continue

            try:
                self._process(frame)
            except Exception as exc:  # never let one bad frame kill the worker
                log.exception("Frame processing failed")
                self._set_state("error", {"code": "inference_error", "message": str(exc)})
                time.sleep(0.5)

        if source is not None:
            source.close()

    def _process(self, frame: np.ndarray) -> None:
        assert self.detector is not None
        settings = self.config.snapshot()
        if self._reset_requested.is_set():
            self._reset_requested.clear()
            self.stats.reset()

        detections, inference_ms = self.detector.detect(frame, settings.confidence, settings.imgsz)
        snap = self.stats.update(len(detections), inference_ms)
        image_b64, w, h = encode_jpeg_b64(frame)

        message = json.dumps(
            {
                "type": "frame",
                "ts": time.time(),
                "frame": {"jpeg": image_b64, "width": w, "height": h},
                "detections": [d.as_dict() for d in detections],
                "stats": snap.as_dict(),
            }
        )
        self._last_frame_message = message
        if self._state != "running":
            self._set_state("running")
        self._publish(message)
