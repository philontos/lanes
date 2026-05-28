// Web entry — the docker image's web mode runs this with `npx tsx`. The
// orchestrator's cycle entry lives at sdk/src/run.ts; they are deliberately
// separate so each has one job (no --mode flag dispatching).

import { startServer } from "./server.js";
startServer();
