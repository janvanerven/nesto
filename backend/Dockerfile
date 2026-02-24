FROM python:3.12-slim AS base
WORKDIR /app
RUN pip install uv
COPY pyproject.toml .
RUN uv pip install --system .

FROM base AS dev
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

FROM base AS prod
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
