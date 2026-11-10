"""FastAPI app: REST config endpoints + /ws frame stream."""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from .cameras import probe_cameras
from .config import ALLOWED_IMGSZ, RuntimeConfig, Settings, parse_source
from .pipeline import Pipeline

log = logging.getLogger("headcount.server")


class Broadcaster:
    """Fan-out of pre-serialized messages to WebSocket clients.

    Each client has a 1-slot queue for frames: a slow client just skips frames instead of
    accumulating latency. Status messages use a separate unbounded queue so they're never dropped.
    """

    def __init__(self) -> None:
        self._clients: set[tuple[asyncio.Queue, asyncio.Queue]] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def register(self) -> tuple[asyncio.Queue, asyncio.Queue]:
        pair = (asyncio.Queue(maxsize=1), asyncio.Queue())
        self._clients.add(pair)
        return pair

    def unregister(self, pair) -> None:
        self._clients.discard(pair)

    def publish_threadsafe(self, message: str) -> None:
        if self._loop is not None and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._publish, message)

    def _publish(self, message: str) -> None:
        is_status = message.startswith('{"type": "status"')
        for frames, statuses in list(self._clients):
            if is_status:
                statuses.put_nowait(message)
                continue
            if frames.full():
                try:
                    frames.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            frames.put_nowait(message)


class ConfigUpdate(BaseModel):
    confidence: float | None = Field(default=None, ge=0.05, le=0.95)
    imgsz: int | None = None
    source: str | int | None = None

    @field_validator("imgsz")
    @classmethod
    def _check_imgsz(cls, v):
        if v is not None and v not in ALLOWED_IMGSZ:
            raise ValueError(f"imgsz must be one of {ALLOWED_IMGSZ}")
        return v


class ControlAction(BaseModel):
    action: Literal["pause", "resume", "reset_stats"]


def create_app(settings: Settings) -> FastAPI:
    config = RuntimeConfig(settings)
    broadcaster = Broadcaster()
    pipeline = Pipeline(config, broadcaster.publish_threadsafe)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        broadcaster.bind(asyncio.get_running_loop())
        pipeline.start()
        yield
        await run_in_threadpool(pipeline.stop)

    app = FastAPI(title="Headcount", lifespan=lifespan)
    app.state.pipeline = pipeline
    app.state.config = config
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def config_payload() -> dict:
        s = config.snapshot()
        return {
            "source": s.source,
            "confidence": s.confidence,
            "imgsz": s.imgsz,
            "imgsz_options": list(ALLOWED_IMGSZ),
            "model": pipeline.detector.model_name if pipeline.detector else s.model,
            "device": pipeline.detector.device if pipeline.detector else None,
        }

    @app.get("/health")
    def health():
        status = pipeline.status()
        return {"ok": True, "state": status["state"], "model": status["model"], "device": status["device"], "error": status["error"]}

    @app.get("/config")
    def get_config():
        return config_payload()

    @app.post("/config")
    def post_config(update: ConfigUpdate):
        changes = update.model_dump(exclude_none=True)
        new_source = None
        if "source" in changes:
            new_source = parse_source(changes["source"])
            changes["source"] = new_source
        old_source = config.snapshot().source
        config.update(**changes)
        if new_source is not None and new_source != old_source:
            pipeline.notify_source_changed()
        return config_payload()

    @app.post("/control")
    def control(body: ControlAction):
        if body.action == "pause":
            pipeline.set_paused(True)
        elif body.action == "resume":
            pipeline.set_paused(False)
        elif body.action == "reset_stats":
            pipeline.reset_stats()
        return pipeline.status()

    @app.get("/cameras")
    async def cameras():
        source = config.snapshot().source
        active = source if isinstance(source, int) and pipeline.status()["state"] in ("running", "paused") else None
        try:
            found = await run_in_threadpool(probe_cameras, active)
        except Exception as exc:
            raise HTTPException(500, f"Camera probe failed: {exc}") from exc
        return {"cameras": found, "current_source": source}

    @app.websocket("/ws")
    async def ws(websocket: WebSocket):
        await websocket.accept()
        pair = broadcaster.register()
        frames, statuses = pair
        try:
            await websocket.send_text(json.dumps(pipeline.status()))
            if pipeline.last_frame_message:
                await websocket.send_text(pipeline.last_frame_message)

            async def drain_incoming():
                # We don't expect client messages, but reading lets us notice disconnects promptly.
                while True:
                    await websocket.receive_text()

            reader = asyncio.create_task(drain_incoming())
            try:
                while not reader.done():
                    get_status = asyncio.create_task(statuses.get())
                    get_frame = asyncio.create_task(frames.get())
                    done, pending = await asyncio.wait(
                        {get_status, get_frame, reader}, return_when=asyncio.FIRST_COMPLETED
                    )
                    for task in (get_status, get_frame):
                        if task in done:
                            await websocket.send_text(task.result())
                        else:
                            task.cancel()
            finally:
                reader.cancel()
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            broadcaster.unregister(pair)

    return app
