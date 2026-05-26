import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const releaseDir = path.join(projectRoot, "release");

const removablePaths = [
  path.join(releaseDir, "win-unpacked")
];

async function main() {
  for (const target of removablePaths) {
    if (!existsSync(target)) {
      continue;
    }
    await rm(target, { recursive: true, force: true });
    console.log(`Removed unneeded folder: ${target}`);
  }
}

await main();
