import { defineConfig } from "vitest/config";

// These are real Postgres integration tests (per the project's standing
// rule: no mocked-DB "proof" of behavior that only matters against a real
// schema/constraints) — they talk to the same local Postgres the dev server
// uses, so they run sequentially, not in parallel workers, to avoid racing
// each other over shared demo fixtures (Rajesh Kumar's worker row, the CWE
// approval policy, etc).
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
