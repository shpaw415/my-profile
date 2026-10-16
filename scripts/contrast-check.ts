// WCAG contrast audit for both themes of the My Profile page.
// Extracts CSS variables from the :root (light) and html[data-theme="dark"]
// blocks in server/styles.css and checks key foreground/background pairs
// (min 4.5:1). rgba() backgrounds are composited over --card first.
// Run: bun scripts/contrast-check.ts
const src = await Bun.file(new URL("../server/styles.css", import.meta.url)).text();

function vars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/g)) out[m[1]] = m[2];
  return out;
}

const lightMatch = src.match(/:root\s*\{([\s\S]*?)\n\}/);
const darkMatch = src.match(/html\[data-theme=["']dark["']\]\s*\{([\s\S]*?)\n\}/);
if (!lightMatch || !darkMatch) {
  console.error("could not locate :root / dark blocks — check the selectors");
  process.exit(1);
}
const light = vars(lightMatch[1]);
const dark = vars(darkMatch[1]);

const lum = (hex: string): number => {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (fg: string, bg: string): number => {
  const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
};
/** Composite a possibly-rgba color over a base hex color. */
const over = (v: Record<string, string>, fg: string, baseVar: string): string => {
  const f = v[fg];
  if (!f) return "";
  const rgba = f.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  const base = v[baseVar] ?? "#ffffff";
  if (!rgba) return f;
  const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
  const b = base.slice(1);
  const hex = [0, 2, 4]
    .map((i) => Math.round(a * Number(rgba[i / 2 + 1]) + (1 - a) * parseInt(b.slice(i, i + 2), 16)).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
};

// pairs: [label, fg var, bg var] — bg entries whose value is rgba() are
// composited over card automatically
const pairs: [string, string, string][] = [
  ["text on bg", "text", "bg"],
  ["text on card", "text", "card"],
  ["text on input", "text", "input-bg"],
  ["muted on card (labels, badge, minibtn)", "muted", "card"],
  ["muted on bg (footer)", "muted", "bg"],
  ["primary btn text on accent (.save)", "accent-text", "accent"],
  ["status err on card", "danger", "card"],
  ["banner text on banner bg", "danger", "danger-bg"],
  ["status ok on card", "ok", "card"],
  ["sensitive note text on note bg", "sensitive-note-text", "sensitive-note-bg"],
  ["pill active", "pill-ok", "pill-ok-bg"],
  ["pill inactive", "pill-off", "pill-off-bg"],
];

let failures = 0;
for (const [theme, v] of [["light", light], ["dark", dark]] as const) {
  console.log(`\n${theme} theme:`);
  for (const [label, fg, bg] of pairs) {
    const f = v[fg];
    const b = over(v, bg, "card");
    if (!f || !b) {
      console.log(`  ?? ${label}: missing var (${fg}=${f}, ${bg}=${b})`);
      failures++;
      continue;
    }
    const r = ratio(f, b);
    const ok = r >= 4.5;
    if (!ok) failures++;
    console.log(`  ${ok ? "OK " : "FAIL"} ${label}: ${r.toFixed(2)}:1 (${f} on ${b})`);
  }
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall contrast checks passed (min 4.5:1)");
process.exit(failures ? 1 : 0);
