# Build from the repository root: docker build -f backend/Dockerfile -t biocanary-api .
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /bin/uv
WORKDIR /srv/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --extra huawei
COPY backend/alembic.ini ./
COPY backend/migrations migrations
COPY backend/app app
COPY ml/artifacts /srv/ml/artifacts
RUN useradd -r -u 1000 biocanary && mkdir -p var && chown biocanary var
USER biocanary
ENV PATH=/srv/backend/.venv/bin:$PATH PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips '*' --timeout-graceful-shutdown 10"]
