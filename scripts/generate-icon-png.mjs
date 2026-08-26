import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "public", "icon.svg"), "utf8");
const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 1024 },
});
const png = resvg.render().asPng();
const pngPath = join(root, "app-icon-1024.png");
writeFileSync(pngPath, png);
console.log("Wrote app-icon-1024.png");
