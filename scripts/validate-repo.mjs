import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(resolve(root, "worker/package.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(root, "extension/manifest.json"), "utf8"));
if (packageJson.version !== manifest.version) throw new Error("Worker and extension versions differ");

const markdown = [
  "README.md",
  "README.ru.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/api.md",
  "docs/architecture.md",
  "docs/configuration.md",
  "docs/integrations.md",
  "docs/migration.md",
  "docs/ops.md",
];
for (const relative of markdown) {
  const file = resolve(root, relative);
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    await access(resolve(dirname(file), target));
  }
}

console.log(`Repository contract valid (v${packageJson.version}, ${markdown.length} Markdown files)`);
