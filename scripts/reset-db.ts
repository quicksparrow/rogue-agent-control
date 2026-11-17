import { existsSync, unlinkSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { disposableResetTarget } from "../src/server/reset-safety";

loadEnvConfig(process.cwd());
if (!process.argv.includes("--confirm-reset")) {
  console.error(
    "Stop the application first. This permanently deletes local evidence. Run: npm run db:reset -- --confirm-reset",
  );
  process.exit(1);
}
const root = resolve(process.cwd(), "data");
let target: string;
try {
  target = disposableResetTarget(
    process.cwd(),
    process.env.DATABASE_PATH || "data/rogue-control.sqlite",
  );
} catch {
  console.error(
    "Reset refused: only explicitly selected data/disposable-demo*.sqlite/db files can be reset. Historical and default databases are protected.",
  );
  process.exit(1);
}
const inside = relative(root, target);
if (
  !inside ||
  inside.startsWith("..") ||
  isAbsolute(inside) ||
  !/\.(sqlite|db)$/.test(target)
) {
  console.error(
    "Reset refused: DATABASE_PATH must resolve to a .sqlite or .db file inside this project's data directory.",
  );
  process.exit(1);
}
for (const suffix of ["", "-wal", "-shm"]) {
  if (existsSync(target + suffix)) unlinkSync(target + suffix);
}
console.log(
  "Local evidence reset. Restart the application to create an empty database.",
);
