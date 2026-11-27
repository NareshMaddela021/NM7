FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv
# uv comes from PyPI, the same place every other package comes from, so a ghcr.io outage can't stop a deploy
# (a ghcr.io timeout failed the 25 Nov deploy). Same pinned version; retried on a slow network.
RUN pip install --no-cache-dir --retries 5 --timeout 60 uv==0.11.32 && uv --version

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . .

RUN useradd --create-home app && chmod +x start.sh
USER app
ENV PATH="/opt/venv/bin:$PATH" PORT=8000
EXPOSE 8000
CMD ["./start.sh"]
