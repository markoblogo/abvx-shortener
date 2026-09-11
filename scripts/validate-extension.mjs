import { readFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extension = resolve(root, "extension");
const manifest = JSON.parse(await readFile(resolve(extension, "manifest.json"), "utf8"));

if (manifest.manifest_version !== 3) throw new Error("Extension must use Manifest V3");
if (manifest.version !== "0.3.0") throw new Error("Extension version must match release 0.3.0");
if ((manifest.host_permissions || []).includes("https://*/*")) {
  throw new Error("Broad host access must remain optional");
}

const referenced = [
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  ...Object.values(manifest.icons || {}),
].filter(Boolean);
await Promise.all(referenced.map((path) => access(resolve(extension, path))));

const popup = await readFile(resolve(extension, "popup.js"), "utf8");
if (popup.includes(".innerHTML")) throw new Error("Popup must render untrusted values with DOM text APIs");

console.log(`Extension manifest valid (${referenced.length} referenced files checked)`);
