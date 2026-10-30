# syntax=docker/dockerfile:1
# The web app in one image: the Python engine (the worker spawns it), the Bun
# server, and the built Svelte client. Build from the repository root:
#   docker build -f web/Dockerfile .
# web/deploy/compose.yml does that and adds Postgres.

FROM oven/bun:1 AS web
WORKDIR /src/web
COPY web/package.json web/bun.lock ./
COPY web/client/package.json client/
COPY web/server/package.json server/
RUN bun install --frozen-lockfile
# Code the client and the server share (the indicator script runtime).
COPY web/shared shared
COPY web/client client
RUN bun run --filter client build


FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TRADINGAGENTS_IN_DOCKER=1

COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# The engine first, so a web-only change reuses this layer.
WORKDIR /app
COPY pyproject.toml README.md ./
COPY tradingagents tradingagents
COPY cli cli
RUN pip install --no-cache-dir .

COPY web/worker web/worker
COPY web/shared web/shared
COPY web/server web/server
COPY --from=web /src/web/node_modules web/node_modules
COPY --from=web /src/web/server/node_modules web/server/node_modules
COPY --from=web /src/web/client/dist web/client/dist

# The engine keeps its results, cache and decision memory under ~/.tradingagents;
# compose mounts a volume there.
RUN useradd --create-home appuser \
 && install -d -m 0755 -o appuser -g appuser /home/appuser/.tradingagents
USER appuser

ENV HOST=0.0.0.0 \
    PORT=3080 \
    PYTHON_BIN=/opt/venv/bin/python
EXPOSE 3080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3080/healthz', timeout=4)"

WORKDIR /app/web/server
CMD ["bun", "src/index.ts"]
