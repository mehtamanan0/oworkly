#!/usr/bin/env bash
# Starts Postgres (if not running), then the API and web dev servers in the
# background. Safe to re-run — does NOT touch data. For a fresh demo dataset,
# use reset-and-seed.sh instead.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Starting Docker Desktop…"
  open -a Docker
  until docker info >/dev/null 2>&1; do sleep 2; done
fi

docker compose up -d
echo "Waiting for Postgres…"
until docker exec oworkly_lms_db pg_isready -U oworkly -d oworkly_lms >/dev/null 2>&1; do sleep 1; done
echo "Postgres ready on localhost:5433"

pkill -f "tsx watch src/index.ts" 2>/dev/null || true
pkill -f "vite --port 5173" 2>/dev/null || true
sleep 1

(cd server && nohup npx tsx watch src/index.ts > /tmp/lms-server.log 2>&1 &)
(cd web && nohup npx vite --port 5173 > /tmp/lms-web.log 2>&1 &)

sleep 2
echo ""
echo "API:  http://localhost:4000/health/ready"
echo "Web:  http://localhost:5173"
echo "Logs: /tmp/lms-server.log , /tmp/lms-web.log"
