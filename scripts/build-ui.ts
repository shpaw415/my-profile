// Build a standalone dashboard UI: server/ui.html with app.ts bundled and
// styles.css inlined. The page server serves this file by default so the
// dashboard proxy never sees Bun dev-serve chunks (/_bun/client/*.js,
// /_bun/asset/*.css) it cannot route — an empty tab otherwise.
// Run: bun scripts/build-ui.ts   (also run by scripts/uitest.ts setup)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "server");
const htmlPath = join(root, "index.html");
const outPath = join(root, "ui.html");

const html = readFileSync(htmlPath, "utf8");

const result = await Bun.build({
  entrypoints: [join(root, "app.ts")],
  target: "browser",
  format: "iife",
  // Keep function names (uitest greps "buildCards"); whitespace/syntax only.
  minify: { whitespace: true, identifiers: false, syntax: true },
});
if (!result.success) {
  console.error("bun build failed:", result.logs);
  process.exit(1);
}
const js = await result.outputs[0].text();
const css = readFileSync(join(root, "styles.css"), "utf8");

// Guard: the built UI must not reference proxy-unroutable dev-serve chunks.
if (js.includes("/_bun/") || css.includes("/_bun/")) {
  console.error("built UI still references /_bun/ chunks");
  process.exit(1);
}

let out = html.replace(
  '<link rel="stylesheet" href="./styles.css">',
  () => `<style>\n${css}\n</style>`,
);
out = out.replace('<script src="./app.ts"></script>', () => `<script>\n${js}\n</script>`);
if (out.includes('href="./styles.css"') || out.includes('src="./app.ts"')) {
  console.error("inline substitution missed a reference — check index.html");
  process.exit(1);
}

writeFileSync(outPath, out);
console.log(`built ${outPath} (${out.length} bytes, standalone: ${existsSync(outPath)})`);
