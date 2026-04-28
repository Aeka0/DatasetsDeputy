import { mkdir, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";

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
  ? path.resolve(process.argv[2])
  : path.resolve("release", "DatasetsDeputy");

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

console.log(`Release layout prepared at ${releaseRoot}`);
