#!/usr/bin/env node
import path from "node:path";

const args = process.argv.slice(2);
const requiredPrefix = [
  "--background",
  "--factory-startup",
  "--disable-autoexec",
  "--offline-mode",
  "--python-exit-code",
  "41",
  "--python",
];
if (requiredPrefix.some((value, index) => args[index] !== value)) process.exit(70);
if (
  !args.includes("--render-scene") ||
  !args.includes("--source-glb") ||
  !args.includes("--output-directory")
) {
  process.exit(71);
}
if (
  Object.keys(process.env).some((key) =>
    /(DATABASE|POSTGRES|AWS|S3|SECRET|TOKEN|CREDENTIAL|PROVIDER|OPENAI)/iu.test(key),
  )
) {
  process.exit(72);
}
const script = path.basename(args[7] ?? "");
if (script === "hang.py") setInterval(() => undefined, 10_000);
else if (script === "flood.py") process.stdout.write("x".repeat(65_536));
else process.exit(0);
