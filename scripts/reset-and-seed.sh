#!/usr/bin/env bash
# DESTRUCTIVE: wipes all data, reapplies the schema, and re-ingests the real
# WTG Skill Matrix workbook plus the two demo assessment scenarios (one PASS,
# one FAIL) so the app is in a clean, populated, demo-ready state.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose up -d >/dev/null
until docker exec oworkly_lms_db pg_isready -U oworkly -d oworkly_lms >/dev/null 2>&1; do sleep 1; done

echo "Dropping and recreating schema…"
docker exec oworkly_lms_db psql -U oworkly -d oworkly_lms -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null
cat db/schema.sql | docker exec -i oworkly_lms_db psql -U oworkly -d oworkly_lms -v ON_ERROR_STOP=1 >/dev/null

echo "Re-ingesting the real WTG Skill Matrix workbook…"
(cd ingestion && node seed.mjs)

echo ""
echo "Restart the API (scripts/start.sh) if it's already running, then replay the two demo scenarios:"
echo "  python3 scripts/replay_demo_scenarios.py"
