from app.config import parse_source
from app.stats import SessionStats


class FakeClock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


def test_median_smoothing_ignores_single_frame_spikes():
    s = SessionStats(smoothing_window=5, clock=FakeClock())
    for c in [3, 3, 3, 9, 3]:
        snap = s.update(c, 10)
    assert snap.raw_count == 3
    assert snap.smoothed_count == 3
    assert snap.peak_count == 3  # peak tracks the smoothed count, so the spike doesn't count


def test_rolling_average_drops_old_samples():
    clock = FakeClock()
    s = SessionStats(smoothing_window=1, average_window_s=60, clock=clock)
    s.update(10, 10)
    clock.t = 61
    snap = s.update(2, 10)
    assert snap.avg_60s == 2


def test_fps_and_reset():
    clock = FakeClock()
    s = SessionStats(clock=clock)
    for i in range(11):
        clock.t = i * 0.1
        snap = s.update(1, 20)
    assert abs(snap.fps - 10) < 0.01
    assert snap.inference_ms == 20
    s.reset()
    assert s.last is None


def test_parse_source():
    assert parse_source("0") == 0
    assert parse_source(1) == 1
    assert parse_source("clips/a.mp4") == "clips/a.mp4"
