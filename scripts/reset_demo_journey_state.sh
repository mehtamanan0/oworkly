#!/bin/bash
# Deletes Rajesh Kumar's BRA qualification-case state and every idempotency
# key the replay script used, so replay_figma_demo_journey.mjs can be re-run
# from a genuinely clean start. Dev/demo convenience only — never point this
# at anything but the local demo DB.
set -euo pipefail

docker exec -i oworkly_lms_db psql -U oworkly -d oworkly_lms <<'EOF'
BEGIN;
DELETE FROM certificate WHERE qualification_case_id IN (
  SELECT qualification_case_id FROM qualification_case WHERE worker_id = 'c5c1a50f-ae61-438b-8568-7030ace12c08'
);
DELETE FROM qualification_result WHERE qualification_case_id IN (
  SELECT qualification_case_id FROM qualification_case WHERE worker_id = 'c5c1a50f-ae61-438b-8568-7030ace12c08'
);
DELETE FROM self_assessment_review WHERE assessment_attempt_id IN (
  SELECT assessment_attempt_id FROM assessment_attempt WHERE qualification_case_id IN (
    SELECT qualification_case_id FROM qualification_case WHERE worker_id = 'c5c1a50f-ae61-438b-8568-7030ace12c08'
  )
);
DELETE FROM assessment_attempt WHERE qualification_case_id IN (
  SELECT qualification_case_id FROM qualification_case WHERE worker_id = 'c5c1a50f-ae61-438b-8568-7030ace12c08'
);
DELETE FROM qualification_case WHERE worker_id = 'c5c1a50f-ae61-438b-8568-7030ace12c08';
DELETE FROM idempotency_key WHERE idempotency_key LIKE 'demo-%';
COMMIT;
EOF
echo "Reset complete."
