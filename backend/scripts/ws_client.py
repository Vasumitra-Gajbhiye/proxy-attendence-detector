"""Tiny WebSocket client to eyeball what the backend emits.

    python scripts/ws_client.py --url ws://localhost:8000/ws --frames 20
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json

import websockets


async def main(url: str, frames: int, save: str | None) -> None:
    async with websockets.connect(url, max_size=8 * 1024 * 1024) as ws:
        seen = 0
        while seen < frames:
            msg = json.loads(await ws.recv())
            if msg["type"] == "status":
                print(f"[status] state={msg['state']} model={msg['model']} device={msg['device']} error={msg['error']}")
                continue
            seen += 1
            s = msg["stats"]
            f = msg["frame"]
            print(
                f"[frame {seen:>3}] {f['width']}x{f['height']} jpeg={len(f['jpeg']) * 3 // 4 // 1024}KB "
                f"raw={s['raw_count']} smoothed={s['smoothed_count']} peak={s['peak_count']} "
                f"avg60={s['avg_60s']} fps={s['fps']} infer={s['inference_ms']}ms"
            )
            if save and seen == frames:
                with open(save, "wb") as fh:
                    fh.write(base64.b64decode(f["jpeg"]))
                print(f"saved last frame to {save}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="ws://localhost:8000/ws")
    p.add_argument("--frames", type=int, default=20)
    p.add_argument("--save", default=None, help="Write the last JPEG to this path")
    a = p.parse_args()
    asyncio.run(main(a.url, a.frames, a.save))
