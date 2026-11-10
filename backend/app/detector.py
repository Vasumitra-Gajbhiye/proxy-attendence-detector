"""YOLO person detector (COCO class 0) on Apple MPS with CPU fallback."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import numpy as np

from .config import FALLBACK_MODEL, WEIGHTS_DIR

log = logging.getLogger("headcount.detector")

PERSON_CLASS_ID = 0


@dataclass
class Detection:
    # Normalized 0-1 coordinates relative to the frame
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float

    def as_dict(self) -> dict:
        return {
            "bbox": [round(self.x1, 4), round(self.y1, 4), round(self.x2, 4), round(self.y2, 4)],
            "confidence": round(self.confidence, 3),
        }


def pick_device(requested: str | None) -> str:
    import torch

    if requested and requested != "mps":
        return requested
    if torch.backends.mps.is_available():
        return "mps"
    if requested == "mps":
        log.warning("MPS was requested but is not available; falling back to CPU (inference will be slow).")
    else:
        log.warning("Apple MPS backend is not available; falling back to CPU (inference will be slow).")
    return "cpu"


class PersonDetector:
    def __init__(self, model_name: str, device: str | None = None) -> None:
        from ultralytics import YOLO

        WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
        self.device = pick_device(device)
        self.model_name = model_name
        try:
            # A bare asset name inside WEIGHTS_DIR is auto-downloaded there by Ultralytics.
            self.model = YOLO(str(WEIGHTS_DIR / model_name) if "/" not in model_name else model_name)
        except Exception as exc:  # unknown/unreleased asset name, offline, etc.
            if model_name == FALLBACK_MODEL:
                raise
            log.warning("Could not load %s (%s); falling back to %s", model_name, exc, FALLBACK_MODEL)
            self.model_name = FALLBACK_MODEL
            self.model = YOLO(str(WEIGHTS_DIR / FALLBACK_MODEL))
        self.model.to(self.device)
        log.info("Loaded %s on %s", self.model_name, self.device)

    def warmup(self, imgsz: int) -> None:
        dummy = np.zeros((imgsz, imgsz, 3), dtype=np.uint8)
        self.detect(dummy, confidence=0.5, imgsz=imgsz)

    def detect(self, frame_bgr: np.ndarray, confidence: float, imgsz: int) -> tuple[list[Detection], float]:
        h, w = frame_bgr.shape[:2]
        t0 = time.perf_counter()
        results = self.model.predict(
            frame_bgr,
            imgsz=imgsz,
            conf=confidence,
            classes=[PERSON_CLASS_ID],
            device=self.device,
            verbose=False,
        )
        # .cpu() forces MPS sync, so the measured time is real GPU time.
        boxes = results[0].boxes
        xyxy = boxes.xyxy.cpu().numpy() if boxes is not None else np.empty((0, 4))
        confs = boxes.conf.cpu().numpy() if boxes is not None else np.empty((0,))
        inference_ms = (time.perf_counter() - t0) * 1000.0

        detections = [
            Detection(
                x1=float(np.clip(x1 / w, 0, 1)),
                y1=float(np.clip(y1 / h, 0, 1)),
                x2=float(np.clip(x2 / w, 0, 1)),
                y2=float(np.clip(y2 / h, 0, 1)),
                confidence=float(c),
            )
            for (x1, y1, x2, y2), c in zip(xyxy, confs)
        ]
        return detections, inference_ms
