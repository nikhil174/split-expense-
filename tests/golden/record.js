// Re-records tests/golden/transcript.json from the current Worker.
// Only for intended behaviour changes: review the diff before committing.
//   npm run golden:record
import { writeFileSync } from "node:fs";
import worker from "../../src/index.js";
import { runScenario } from "./harness.js";

const result = await runScenario(worker);
writeFileSync(new URL("./transcript.json", import.meta.url), JSON.stringify(result, null, 1) + "\n");
console.log(`Recorded ${result.transcript.length} steps and ${Object.keys(result.db).length} tables.`);
