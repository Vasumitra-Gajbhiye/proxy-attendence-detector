"""Camera discovery: try indices and keep the ones that open and deliver a frame."""

from __future__ import annotations

import cv2

MAX_PROBE_INDEX = 5


def probe_cameras(active_index: int | None = None, max_index: int = MAX_PROBE_INDEX) -> list[dict]:
    cameras: list[dict] = []
    backend = cv2.CAP_AVFOUNDATION if hasattr(cv2, "CAP_AVFOUNDATION") else cv2.CAP_ANY
    misses = 0
    for index in range(max_index):
        if index == active_index:
            # Already in use by the pipeline; it's known-good, don't fight over it.
            cameras.append({"index": index, "label": f"Camera {index}", "active": True})
            continue
        cap = cv2.VideoCapture(index, backend)
        try:
            ok = cap.isOpened() and cap.read()[0]
        finally:
            cap.release()
        if ok:
            cameras.append({"index": index, "label": f"Camera {index}", "active": False})
            misses = 0
        else:
            misses += 1
            if misses >= 2:  # indices are contiguous on macOS; stop early
                break
    return cameras
