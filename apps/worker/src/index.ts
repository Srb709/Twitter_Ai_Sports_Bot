import "dotenv/config";
import { runWorkerLoop } from "./worker-loop.js";

const args = process.argv.slice(2);
const once = args.includes("--once");
const debug = args.includes("--debug");

console.log(`[worker] Starting — once=${once} debug=${debug}`);

runWorkerLoop({ once, debug }).catch((err) => {
  console.error("[worker] Fatal error:", err);
  process.exit(1);
});
