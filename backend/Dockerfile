FROM python:3.12-slim AS base
WORKDIR /app
RUN pip install uv
COPY pyproject.toml .
RUN uv pip install --system .
RUN adduser --disabled-password --gecos '' --uid 1000 appuser && \
    mkdir -p /app/data && chown -R appuser:appuser /app/data

FROM base AS dev
COPY . .
RUN chown -R appuser:appuser /app
USER appuser
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

FROM base AS prod
COPY . .
RUN chown -R appuser:appuser /app
USER appuser
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
