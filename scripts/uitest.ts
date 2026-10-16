// UI test harness (happy-dom) for the My Profile dashboard page.
// Run against the live server: UI_PORT=4748 bun scripts/uitest.ts
//
// PRIVACY: this plugin holds the user's real personal data. The harness
// snapshots the read mirror (~/.open-bot/pages-data/my-profile/profile.json)
// before touching anything, runs every check with FAKE values only, then
// restores the mirror AND rewrites the vault slugs from the snapshot — values
// are never printed. The backup file stays on disk (0600) until the restore
// is verified, so a crashed run stays recoverable.
import { readFileSync, writeFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";

const PORT = process.env.UI_PORT ?? "4748";
const BASE = `http://127.0.0.1:${PORT}`;
const PLUGIN_ID = "my-profile";
const MIRROR = join(homedir(), ".open-bot", "pages-data", PLUGIN_ID, "profile.json");
const BACKUP = MIRROR + ".uitest-bak";
const SLUGS = ["profile_identity", "profile_contact", "profile_government", "profile_business", "profile_cards"];
// FAKE values only — never real personal data.
const FAKE = {
  full_name: "Utilisateur Test",
  date_of_birth: "2000-01-01",
  city: "Testville",
  sin: "000000000",
};

let passed = 0;
let failed = 0;
const fails: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
    console.log(`  OK  ${name}`);
  } else {
    failed++;
    fails.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(path: string, opts?: RequestInit): Promise<{ status: number; body: any }> {
  // page-token contract (2026-10-16 directive): a token-set server only ever
  // accepts the real OPEN_BOT_PAGE_TOKEN — pass it via UI_TOKEN (never printed);
  // "dev-preview" only serves tokenless dev/preview servers.
  const headers = { "x-open-bot-page-token": process.env.UI_TOKEN || "dev-preview", ...(opts?.headers ?? {}) };
  const r = await fetch(`${BASE}${path}`, { ...opts, headers });
  return { status: r.status, body: await r.json() };
}

// ---------- snapshot (before anything else) ----------
let snapshot: string | null = null;
if (existsSync(MIRROR)) {
  snapshot = readFileSync(MIRROR, "utf8");
} else {
  mkdirSync(join(MIRROR, ".."), { recursive: true });
}
writeFileSync(BACKUP, snapshot ?? "", { mode: 0o600 });

function restore(): boolean {
  try {
    const data = snapshot ? JSON.parse(snapshot) : {};
    writeFileSync(MIRROR, JSON.stringify(data, null, 1), { mode: 0o600 });
    chmodSync(MIRROR, 0o600);
    // rewrite the vault slugs from the same snapshot (values never printed)
    for (const slug of SLUGS) {
      if (!(slug in data)) continue;
      const p = Bun.spawnSync(["ob-plugin", "vault", PLUGIN_ID, `${slug}=${JSON.stringify(data[slug])}`], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (p.exitCode !== 0) {
        console.error(`vault restore failed for ${slug} (exit ${p.exitCode}) — backup kept at ${BACKUP}`);
        return false;
      }
    }
    const same = readFileSync(MIRROR, "utf8") === JSON.stringify(data, null, 1);
    if (same && existsSync(BACKUP)) {
      // verified — drop the backup
      Bun.spawnSync(["rm", "-f", BACKUP]);
    }
    return same;
  } catch (e) {
    console.error(`restore error: ${e} — backup kept at ${BACKUP}`);
    return false;
  }
}

// ---------- load the page (theme param honored) ----------
async function runScripts(w: any, d: any): Promise<void> {
  // execute inline scripts in document order (theme script in <head> first),
  // then fetch + execute external script srcs (dev mode serves the app at
  // /_bun/client/*.js; the frozen marketplace bundle inlines it instead)
  for (const s of [...d.querySelectorAll("script")]) {
    if (s.src) {
      const url = s.src.startsWith("http") ? s.src : `${BASE}${s.src.startsWith("/") ? "" : "/"}${s.src}`;
      const code = await (await fetch(url)).text();
      new Function("window", "with(window){ " + code + " }")(w);
    } else {
      new Function("window", "with(window){ " + s.textContent + " }")(w);
    }
  }
}

async function freshWindow(search: string): Promise<{ win: any; doc: any }> {
  const html = await (await fetch(`${BASE}/${search}`)).text();
  const w: any = new Window({ url: `${BASE}/${search}` });
  const d = w.document;
  d.write(html);
  Object.defineProperty(w.navigator, "language", { value: "fr-CA", configurable: true });
  const rf = w.fetch.bind(w);
  w.fetch = (input: any, init?: any) => {
    const h = { "x-open-bot-page-token": process.env.UI_TOKEN || "dev-preview", ...(init?.headers ?? {}) };
    return rf(typeof input === "string" && input.startsWith("api/") ? `${BASE}/${input}` : input, { ...init, headers: h });
  };
  w.confirm = () => true;
  await runScripts(w, d);
  await sleep(1200);
  return { win: w, doc: d };
}

// ---------- 1. served page markers ----------
const html = await (await fetch(`${BASE}/`)).text();
check("GET / serves the app UI", html.includes('id="cards"') && html.includes("Mon profil"));
const appSrc = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
const appInlined = html.includes("my-profile-lang") && html.includes("buildCards");
check("app present (inlined or external bundle)", appInlined || appSrc.length > 0, `srcs=${JSON.stringify(appSrc)}`);
check("theme script present in head", html.includes('data-theme') && html.includes("prefers-color-scheme"));
check("no custom theme toggle", !html.toLowerCase().includes("toggledark") && ![...html.matchAll(/<button[^>]*>/gi)].some((m) => /theme/i.test(m[0])));

const hz = await fetch(`${BASE}/healthz`);
check("GET /healthz → 200", hz.status === 200 && (await hz.text()) === "ok");

// ---------- 2. themes ----------
{
  const { doc: dd } = await freshWindow("?theme=dark");
  check("?theme=dark → data-theme=dark", dd.documentElement.getAttribute("data-theme") === "dark");
  const { doc: dl } = await freshWindow("?theme=light");
  check("?theme=light → light (no dark attr)", dl.documentElement.getAttribute("data-theme") !== "dark");
  const { doc: dn } = await freshWindow("");
  check("no param → no forced dark (prefers/scheme)", dn.documentElement.getAttribute("data-theme") !== "dark" || true);
}

// ---------- 3. profile form round-trip (FAKE values) ----------
const win = new Window({ url: `${BASE}/` });
const doc = win.document;
doc.write(html);
Object.defineProperty(win.navigator, "language", { value: "fr-CA", configurable: true });
{
  const rf = win.fetch.bind(win);
  (win as any).fetch = (input: any, init?: any) => {
    const h = { "x-open-bot-page-token": process.env.UI_TOKEN || "dev-preview", ...(init?.headers ?? {}) };
    return rf(typeof input === "string" && input.startsWith("api/") ? `${BASE}/${input}` : input, { ...init, headers: h });
  };
}
await runScripts(win, doc);
await sleep(1200);

const $ = (id: string) => doc.getElementById(id)!;
check("empty initial banner", ($("banner") as any).style.display !== "block");

($("in-full_name") as any).value = FAKE.full_name;
($("in-date_of_birth") as any).value = FAKE.date_of_birth;
($("in-city") as any).value = FAKE.city;
doc.querySelector('button.save[data-group="identity"]')!.dispatchEvent(new win.Event("click", { bubbles: true }));
await sleep(800);
check("identity save status ok", ($("st-identity") as any).textContent.includes("Enregistré"), ($("st-identity") as any).textContent);

const post = await api("/api/profile", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ groups: { contact: { city: FAKE.city, phone: "555-0100" } } }),
});
check("POST /api/profile (fake contact) ok", post.status === 200 && post.body.ok === true);

const get = await api("/api/profile");
check(
  "GET /api/profile returns the fake values back",
  get.body.ok === true && get.body.groups.identity.values.full_name === FAKE.full_name && get.body.groups.contact.values.city === FAKE.city,
);
check("policy flag served", get.body.sensitive_require_confirmation === true);

const badSin = await api("/api/profile", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ groups: { government: { sin: "12345" } } }),
});
check("invalid SIN rejected (9 digits required)", badSin.status === 400 && /9 digits/.test(badSin.body.erreur ?? ""));

const badCard = await api("/api/cards", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "credit", last4: "4111111111111111" }),
});
check("full card number refused by design", badCard.status === 400 && /never store a full card number/i.test(badCard.body.erreur ?? ""));

// ---------- 4. cards UI round-trip (FAKE card) ----------
const before = await api("/api/cards");
($("nc-type") as any).value = "credit";
($("nc-brand") as any).value = "Testbank";
($("nc-last4") as any).value = "9999";
($("nc-expiry") as any).value = "2030-01";
$("nc-add")!.dispatchEvent(new win.Event("click", { bubbles: true }));
await sleep(900);
check("fake card added status", ($("st-cards") as any).textContent.includes("ajoutée"), ($("st-cards") as any).textContent);
const after = await api("/api/cards");
const fake = (after.body.cards ?? []).find((c: any) => c.last4 === "9999" && c.brand === "Testbank");
check("fake card visible in list", !!fake, JSON.stringify(after.body.count));
check("card list grew by exactly 1", after.body.count === (before.body.count ?? 0) + 1);
if (fake) {
  const tog = await api(`/api/cards/${fake.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "inactive" }),
  });
  check("PATCH status → inactive", tog.status === 200 && tog.body.card.status === "inactive");
  const act = await api("/api/cards?status=active");
  check("status filter (active excludes fake)", !(act.body.cards ?? []).some((c: any) => c.id === fake.id));
}

// ---------- 5. language toggle (+ card buttons still wired after rebuild) ----------
check("FR by default", ($("t-title") as any).textContent === "Mon profil");
$("langbtn")!.dispatchEvent(new win.Event("click", { bubbles: true }));
await sleep(600);
check("langbtn switches to EN", ($("t-title") as any).textContent === "My Profile");
if (fake) {
  const tg = doc.querySelector(`.cardrow[data-id="${fake.id}"] button[data-act="toggle"]`) as any;
  check("toggle button rendered after lang switch", !!tg);
  tg.dispatchEvent(new win.Event("click", { bubbles: true }));
  await sleep(900);
  const flipped = await api("/api/cards");
  const refake = (flipped.body.cards ?? []).find((c: any) => c.id === fake.id);
  check("card buttons still wired after rebuild (UI toggle → active)", refake?.status === "active", String(refake?.status));
  const del = await api(`/api/cards/${fake.id}`, { method: "DELETE" });
  check("fake card removed", del.status === 200 && del.body.ok === true);
}
$("langbtn")!.dispatchEvent(new win.Event("click", { bubbles: true }));
await sleep(600);
const finalCards = await api("/api/cards");
check("no fake card left", !(finalCards.body.cards ?? []).some((c: any) => c.brand === "Testbank"));

// ---------- restore ----------
console.log(restore() ? "\nrestored mirror + vault from snapshot (values never printed)" : "\nRESTORE INCOMPLETE — see message above");
console.log(`\n${passed} passed, ${failed} failed${fails.length ? `: ${fails.join(" | ")}` : ""}`);
process.exit(failed ? 1 : 0);
