"""Headcount backend entry point.

    python run.py --source 0
    python run.py --source path/to/video.mp4 --port 8000
"""

from __future__ import annotations

import argparse
import logging

import uvicorn

from app.config import ALLOWED_IMGSZ, DEFAULT_MODEL, Settings, parse_source
from app.server import create_app


def main() -> None:
    parser = argparse.ArgumentParser(description="Headcount: real-time local people counter")
    parser.add_argument("--source", default="0", help="Webcam index (e.g. 0) or a video file path / URL")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Ultralytics weights name or path")
    parser.add_argument("--device", default=None, help="Force a torch device (default: mps, else cpu)")
    parser.add_argument("--conf", type=float, default=0.35, help="Confidence threshold")
    parser.add_argument("--imgsz", type=int, default=960, choices=ALLOWED_IMGSZ)
    parser.add_argument("--no-loop", action="store_true", help="Stop at the end of a video file instead of looping")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    settings = Settings(
        source=parse_source(args.source),
        confidence=args.conf,
        imgsz=args.imgsz,
        model=args.model,
        device=args.device,
        loop_video=not args.no_loop,
    )
    uvicorn.run(create_app(settings), host=args.host, port=args.port, log_level="info", ws_max_size=1 << 20)


if __name__ == "__main__":
    main()
