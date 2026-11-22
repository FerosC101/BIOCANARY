import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import worker
from .api import auth, ingest, reports, stations, system
from .config import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    settings.assert_safe()
    task = asyncio.create_task(worker.run_forever()) if settings.run_background_worker else None
    yield
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title="BIOCANARY API",
    version="1.0",
    description="Biological wastewater monitoring: device ingestion, monitoring data, AI analysis and reports.",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
origins = [o.strip() for o in get_settings().cors_origins.split(",") if o.strip()]
if origins:
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["GET", "POST", "PUT"], allow_headers=["Content-Type"])
for r in (auth.router, system.router, ingest.router, stations.router, reports.router):
    app.include_router(r, prefix="/api/v1")
