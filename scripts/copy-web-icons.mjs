import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
copyFileSync(
  join(root, "src-tauri", "icons", "128x128@2x.png"),
  join(root, "public", "apple-touch-icon.png"),
);
console.log("Wrote public/apple-touch-icon.png");
