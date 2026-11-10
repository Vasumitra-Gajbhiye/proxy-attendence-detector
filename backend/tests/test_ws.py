"""End-to-end: start the real backend on a sample video, check REST + WebSocket output.

Requires the model weights (auto-downloaded on first run) and backend/samples/ media
(scripts/fetch_test_media.sh). Runs on MPS if available.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import cv2
import httpx
import numpy as np
import pytest
import websockets

BACKEND = Path(__file__).resolve().parent.parent
VIDEO = BACKEND / "samples" / "people-detection.mp4"
IMAGE = BACKEND / "samples" / "bus.jpg"

pytestmark = pytest.mark.skipif(not VIDEO.exists() or not IMAGE.exists(), reason="run scripts/fetch_test_media.sh first")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server():
    port = free_port()
    proc = subprocess.Popen(
        [sys.executable, "run.py", "--source", str(VIDEO), "--port", str(port)],
        cwd=BACKEND,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 180
    while time.time() < deadline:
        try:
            if httpx.get(base + "/health", timeout=1).json()["state"] == "running":
                break
        except httpx.HTTPError:
            pass
        if proc.poll() is not None:
            pytest.fail("backend exited:\n" + proc.stdout.read())
        time.sleep(0.5)
    else:
        proc.terminate()
        pytest.fail("backend never reached running state")
    yield base, port
    proc.terminate()
    proc.wait(timeout=10)


async def collect(port: int, n_frames: int, timeout: float = 30):
    statuses, frames = [], []
    async with websockets.connect(f"ws://127.0.0.1:{port}/ws", max_size=8 * 1024 * 1024) as ws:
        async def run():
            while len(frames) < n_frames:
                msg = json.loads(await ws.recv())
                (statuses if msg["type"] == "status" else frames).append(msg)

        await asyncio.wait_for(run(), timeout)
    return statuses, frames


def test_health_and_config(server):
    base, _ = server
    health = httpx.get(base + "/health").json()
    assert health["ok"] and health["device"] == "mps" and health["model"].startswith("yolo")
    cfg = httpx.get(base + "/config").json()
    assert cfg["confidence"] == 0.35 and cfg["imgsz"] == 960 and cfg["source"] == str(VIDEO)
    bad = httpx.post(base + "/config", json={"imgsz": 777})
    assert bad.status_code == 422


def test_websocket_messages_are_well_formed(server):
    _, port = server
    statuses, frames = asyncio.run(collect(port, 20))
    assert statuses and statuses[0]["state"] == "running" and statuses[0]["device"] == "mps"
    assert len(frames) == 20
    total_people = 0
    for f in frames:
        assert set(f) >= {"type", "ts", "frame", "detections", "stats"}
        assert f["frame"]["width"] <= 1280 and f["frame"]["height"] > 0
        jpeg = base64.b64decode(f["frame"]["jpeg"])
        img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        assert img.shape[1] == f["frame"]["width"] and img.shape[0] == f["frame"]["height"]
        for d in f["detections"]:
            x1, y1, x2, y2 = d["bbox"]
            assert 0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1
            assert 0.35 <= d["confidence"] <= 1
        s = f["stats"]
        assert s["raw_count"] == len(f["detections"])
        assert s["peak_count"] >= s["smoothed_count"] >= 0
        assert s["inference_ms"] > 0
        total_people += s["raw_count"]
    assert total_people > 0, "expected people in the sample video"
    assert frames[-1]["stats"]["fps"] > 0


def test_runtime_config_pause_reset_and_source_switch(server):
    base, port = server
    assert httpx.post(base + "/config", json={"confidence": 0.6, "imgsz": 640}).json()["imgsz"] == 640
    _, frames = asyncio.run(collect(port, 6))
    # The first frame on connect is a replay of the last one (processed before the change).
    assert all(d["confidence"] >= 0.6 for f in frames[2:] for d in f["detections"])

    assert httpx.post(base + "/control", json={"action": "pause"}).json()["state"] == "paused"
    assert httpx.post(base + "/control", json={"action": "resume"}).json()["state"] == "running"
    httpx.post(base + "/control", json={"action": "reset_stats"})
    _, frames = asyncio.run(collect(port, 3))
    assert frames[-1]["stats"]["frames_processed"] <= 10

    # Switch to the still image: bus.jpg has 4 people at default settings.
    httpx.post(base + "/config", json={"source": str(IMAGE), "confidence": 0.35, "imgsz": 960})
    _, frames = asyncio.run(collect(port, 25))
    assert frames[-1]["frame"]["width"] == 810
    assert frames[-1]["stats"]["smoothed_count"] == 4


def test_missing_source_reports_error_not_crash(server):
    base, port = server
    httpx.post(base + "/config", json={"source": "/nope/missing.mp4"})
    deadline = time.time() + 10
    while time.time() < deadline:
        h = httpx.get(base + "/health").json()
        if h["state"] == "error":
            break
        time.sleep(0.2)
    assert h["error"]["code"] == "source_not_found"
    # Recovers when given a good source again
    httpx.post(base + "/config", json={"source": str(VIDEO)})
    _, frames = asyncio.run(collect(port, 3))
    assert len(frames) == 3
