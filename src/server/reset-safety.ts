import { basename, isAbsolute, relative, resolve } from "node:path";
export function disposableResetTarget(root: string, requested: string) {
  const base = resolve(root, "data"),
    target = resolve(root, requested),
    inside = relative(base, target);
  if (
    !inside ||
    inside.startsWith("..") ||
    isAbsolute(inside) ||
    !/^disposable-demo(?:-[a-z0-9-]+)?\.(sqlite|db)$/.test(basename(target))
  )
    throw new Error(
      "Reset refused: only explicitly named disposable-demo*.sqlite/db files inside project data are eligible. Historical and default databases are protected.",
    );
  return target;
}
