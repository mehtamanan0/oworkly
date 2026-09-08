#!/usr/bin/env python3
"""Runs two live assessments through the API against real ingested workers, so
the demo has a working PASS example (certificate issued) and a working FAIL
example (retest cycle + skill gap + rule-matched recommended learning) without
the presenter having to click through them live first. Safe to re-run — each
run creates a new attempt (attempt_no increments)."""
import json
import urllib.request

BASE = "http://localhost:4000/api/v1"


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def run_scenario(worker_query, template_key, pass_it):
    worker = call("GET", f"/workers?q={worker_query}")[0]
    templates = call("GET", "/assessment-templates")
    # Two templates per process/level now (SUPERVISOR certifying + SELF readiness
    # check) — the replay always targets the certifying one.
    template = next(t for t in templates if template_key in t["process_name"] and t["level_code"] == "L2" and t["assessment_category"] == "SUPERVISOR")
    template_detail = call("GET", f"/assessment-templates/{template['assessment_template_id']}")

    attempt = call("POST", "/assessment-attempts", {
        "workerId": worker["worker_id"],
        "assessmentTemplateId": template["assessment_template_id"],
    })
    attempt_id = attempt["assessment_attempt_id"]

    if pass_it:
        correct_keys = ["A", "B", "B", "B", "C"]  # matches the seeded question_bank answer key
        answers = [{"questionId": q["question_id"], "selectedKeys": [correct_keys[i]]} for i, q in enumerate(template_detail["questions"])]
        call("POST", f"/assessment-attempts/{attempt_id}/theory-submit", {"answers": answers})
        items = [{"checklistItemId": c["checklist_item_id"], "score": float(c["max_score"])} for c in template_detail["checklist"]]
        call("POST", f"/assessment-attempts/{attempt_id}/practical-score", {"items": items})
        criteria = [{"behaviourCriterionId": b["behaviour_criterion_id"], "score": float(b["max_score"])} for b in template_detail["behaviours"]]
        call("POST", f"/assessment-attempts/{attempt_id}/behaviour-score", {"criteria": criteria})
    else:
        answers = [{"questionId": q["question_id"], "selectedKeys": [q["options_json"][-1]["key"]]} for q in template_detail["questions"]]
        call("POST", f"/assessment-attempts/{attempt_id}/theory-submit", {"answers": answers})
        items = [
            {"checklistItemId": c["checklist_item_id"], "score": 0.0 if i == 0 else float(c["max_score"])}
            for i, c in enumerate(template_detail["checklist"])
        ]
        call("POST", f"/assessment-attempts/{attempt_id}/practical-score", {"items": items})
        criteria = [{"behaviourCriterionId": b["behaviour_criterion_id"], "score": float(b["max_score"]) - 1} for b in template_detail["behaviours"]]
        call("POST", f"/assessment-attempts/{attempt_id}/behaviour-score", {"criteria": criteria})

    result = call("POST", f"/assessment-attempts/{attempt_id}/submit")
    print(worker_query, template_key, "->", result["outcome"]["result"], result["composite"]["compositeScorePct"])


if __name__ == "__main__":
    run_scenario("37908", "Nacelle", True)   # Bhavinkumar Hemantbhai Patel -> PASS -> certificate issued
    run_scenario("39151", "Slipring", False)  # Mahesh Popat More -> FAIL -> retest + gap analysis
