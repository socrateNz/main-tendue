// Chargeur pour exécuter le code TypeScript du projet directement avec Node (tests et scripts),
// sans dépendance supplémentaire :
// - alias « @/ » vers la racine du projet ;
// - imports TypeScript sans extension ;
// - « server-only » neutralisé (garde-fou propre au bundler Next.js, sans objet hors de Next).
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.cwd();
const EMPTY_MODULE = "data:text/javascript,export {};";

/** Retourne l'URL du fichier TypeScript correspondant, ou null s'il n'y en a pas. */
function findTsFile(fileUrl) {
  const filePath = fileURLToPath(fileUrl);
  if (path.extname(filePath)) return null;
  for (const candidate of [`${filePath}.ts`, `${filePath}.tsx`, path.join(filePath, "index.ts")]) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: EMPTY_MODULE, format: "module", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const target = pathToFileURL(path.join(root, specifier.slice(2))).href;
      return nextResolve(findTsFile(target) ?? target, context);
    }
    const parent = context.parentURL;
    if (specifier.startsWith(".") && parent?.startsWith("file:") && !parent.includes("/node_modules/")) {
      const target = findTsFile(new URL(specifier, parent).href);
      if (target) return nextResolve(target, context);
    }
    return nextResolve(specifier, context);
  },
});
