import { app } from "./app.js";
import { pool } from "./db.js";
import { config } from "./config/index.js";

const port = config.PORT;
const server = app.listen(port, () => {
  console.log(`Oworkly LMS API listening on http://localhost:${port} (${config.NODE_ENV})`);
});

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`${sig} received, shutting down`);
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
