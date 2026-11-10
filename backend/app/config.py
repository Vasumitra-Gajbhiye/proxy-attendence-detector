"""Runtime configuration shared between the API and the processing pipeline."""

from __future__ import annotations

import threading
from dataclasses import asdict, dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
WEIGHTS_DIR = BACKEND_DIR / "weights"

ALLOWED_IMGSZ = (640, 960, 1280)
DEFAULT_MODEL = "yolo26m.pt"
FALLBACK_MODEL = "yolo11m.pt"

# Count smoothing / stats windows
SMOOTHING_WINDOW = 15  # frames, rolling median
AVERAGE_WINDOW_S = 60.0  # seconds, rolling mean of smoothed count
STREAM_MAX_WIDTH = 1280
STREAM_JPEG_QUALITY = 70


def parse_source(value: str | int) -> int | str:
    """Webcam indices come in as digit strings from the CLI / API; everything else is a path or URL."""
    if isinstance(value, int):
        return value
    text = str(value).strip()
    if text.lstrip("-").isdigit():
        return int(text)
    return text


@dataclass
class Settings:
    source: int | str = 0
    confidence: float = 0.35
    imgsz: int = 960
    model: str = DEFAULT_MODEL
    device: str | None = None  # None = auto (mps -> cpu)
    loop_video: bool = True


@dataclass
class RuntimeConfig:
    """Thread-safe holder for the values that can change while running."""

    settings: Settings
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def snapshot(self) -> Settings:
        with self._lock:
            return Settings(**asdict(self.settings))

    def update(self, **changes) -> Settings:
        with self._lock:
            for key, value in changes.items():
                if value is not None:
                    setattr(self.settings, key, value)
            return Settings(**asdict(self.settings))
