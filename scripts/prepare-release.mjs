import { mkdir, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");

function resolveFromProjectRoot(value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(projectRoot, value);
}

const allowedRootEntries = new Set([
  "DatasetsDeputy.exe",
  "model",
  "config",
  "datasets",
  "runtime",
  "app",
  "log",
  "temp"
]);

const releaseRoot = process.argv[2]
  ? resolveFromProjectRoot(process.argv[2])
  : path.resolve(projectRoot, "release", "DatasetsDeputy");

const appDir = path.join(releaseRoot, "app");

for (const dir of ["model", "config", "datasets", "runtime", "app", "log", "temp"]) {
  await mkdir(path.join(releaseRoot, dir), { recursive: true });
}

const entries = await readdir(releaseRoot).catch(() => []);

for (const entry of entries) {
  if (allowedRootEntries.has(entry)) {
    continue;
  }

  const source = path.join(releaseRoot, entry);
  const target = path.join(appDir, entry);
  const info = await stat(source);

  if (info.isDirectory() || info.isFile()) {
    await rename(source, target);
  }
}

console.log(`发布目录结构已整理：${releaseRoot}`);
