"""Count smoothing and session statistics. Pure Python, no I/O, easy to unit test."""

from __future__ import annotations

import statistics
import time
from collections import deque
from dataclasses import dataclass

from .config import AVERAGE_WINDOW_S, SMOOTHING_WINDOW


@dataclass
class StatsSnapshot:
    raw_count: int
    smoothed_count: int
    peak_count: int
    avg_60s: float
    fps: float
    inference_ms: float
    frames_processed: int

    def as_dict(self) -> dict:
        return {
            "raw_count": self.raw_count,
            "smoothed_count": self.smoothed_count,
            "peak_count": self.peak_count,
            "avg_60s": round(self.avg_60s, 2),
            "fps": round(self.fps, 1),
            "inference_ms": round(self.inference_ms, 1),
            "frames_processed": self.frames_processed,
        }


class SessionStats:
    def __init__(
        self,
        smoothing_window: int = SMOOTHING_WINDOW,
        average_window_s: float = AVERAGE_WINDOW_S,
        clock=time.monotonic,
    ) -> None:
        self._clock = clock
        self._smoothing_window = smoothing_window
        self._average_window_s = average_window_s
        self.reset()

    def reset(self) -> None:
        self._recent_counts: deque[int] = deque(maxlen=self._smoothing_window)
        self._timed_counts: deque[tuple[float, int]] = deque()
        self._frame_times: deque[float] = deque(maxlen=30)
        self._inference_ms_ema: float | None = None
        self._peak = 0
        self._frames = 0
        self._last: StatsSnapshot | None = None

    def update(self, raw_count: int, inference_ms: float) -> StatsSnapshot:
        now = self._clock()
        self._frames += 1

        self._recent_counts.append(raw_count)
        # Median of the last N frames; round half up so 2.5 -> 3 consistently.
        smoothed = int(statistics.median(self._recent_counts) + 0.5)
        self._peak = max(self._peak, smoothed)

        self._timed_counts.append((now, smoothed))
        cutoff = now - self._average_window_s
        while self._timed_counts and self._timed_counts[0][0] < cutoff:
            self._timed_counts.popleft()
        avg = sum(c for _, c in self._timed_counts) / len(self._timed_counts)

        self._frame_times.append(now)
        if len(self._frame_times) >= 2:
            span = self._frame_times[-1] - self._frame_times[0]
            fps = (len(self._frame_times) - 1) / span if span > 0 else 0.0
        else:
            fps = 0.0

        alpha = 0.2
        self._inference_ms_ema = (
            inference_ms
            if self._inference_ms_ema is None
            else alpha * inference_ms + (1 - alpha) * self._inference_ms_ema
        )

        self._last = StatsSnapshot(
            raw_count=raw_count,
            smoothed_count=smoothed,
            peak_count=self._peak,
            avg_60s=avg,
            fps=fps,
            inference_ms=self._inference_ms_ema,
            frames_processed=self._frames,
        )
        return self._last

    @property
    def last(self) -> StatsSnapshot | None:
        return self._last
