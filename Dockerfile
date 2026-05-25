FROM python:3.11-slim

WORKDIR /app

COPY apps/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/api/app ./app

ENV PORT=8012
EXPOSE ${PORT}
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8012}
