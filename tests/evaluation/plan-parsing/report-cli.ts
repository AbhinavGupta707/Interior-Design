import { createReferenceBaselineReport } from "./report.js";

void createReferenceBaselineReport()
  .then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
