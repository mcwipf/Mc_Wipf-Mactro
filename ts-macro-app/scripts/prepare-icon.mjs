import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const requiredIconPath = path.join(projectRoot, "build", "macro.ico");

async function main() {
  if (!existsSync(requiredIconPath)) {
    throw new Error(`Missing required icon: ${requiredIconPath}`);
  }

  console.log(`Using existing icon without generation: ${requiredIconPath}`);
}

await main();
