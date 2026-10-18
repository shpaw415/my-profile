/**
 * my-profile — dashboard page server (Bun).
 *
 * Serves the My Profile app UI (index.html) and a small JSON API so the user
 * can fill their profile once, in one form:
 *   - app tab (same-origin proxy): /api/pages/my-profile/api/...
 *   - direct loopback:             /api/...
 * Storage, two layers: the key vault (slugs profile_*) is the durable copy,
 * written through `ob-plugin vault my-profile <slug>=<json>`; a local read
 * mirror (~/.open-bot/pages-data/my-profile/profile.json, chmod 600) is kept
 * in lockstep on every write because the control plane only re-syncs vault
 * values into the plugin config file on its periodic sweep (defect filed), so
 * reads come from the mirror. The server binds loopback only and, whenever
 * OPEN_BOT_PAGE_TOKEN is set, requires it (header x-open-bot-page-token) on
 * every API call. No public endpoint is declared: personal data stays behind
 * the dashboard.
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PLUGIN_ID = "my-profile";
const CONFIG_FILE = join(homedir(), ".config", "open-bot", `plugin-${PLUGIN_ID}.json`);
const DATA_DIR = join(homedir(), ".open-bot", "pages-data", PLUGIN_ID);
const CACHE_FILE = join(DATA_DIR, "profile.json");
const MAX_BODY = 65536; // 64 KB

type FieldSpec = { max: number; validate?: "date" | "email" | "sin" };
const CARDS_SLUG = "profile_cards";
const CARD_TYPES = ["debit", "credit"];
const CARD_STATUSES = ["active", "inactive"];
const GROUP_SLUGS: Record<string, string> = {
  identity: "profile_identity",
  contact: "profile_contact",
  government: "profile_government",
  business: "profile_business",
};
const GROUP_FIELDS: Record<string, Record<string, FieldSpec>> = {
  identity: {
    full_name: { max: 200 },
    date_of_birth: { max: 10, validate: "date" },
  },
  contact: {
    address_line1: { max: 200 },
    address_line2: { max: 200 },
    city: { max: 100 },
    province: { max: 100 },
    postal_code: { max: 20 },
    country: { max: 100 },
    phone: { max: 40 },
    email: { max: 200, validate: "email" },
    work_email: { max: 200, validate: "email" },
  },
  government: {
    sin: { max: 9, validate: "sin" },
    ramq: { max: 20 },
    driver_license: { max: 30 },
  },
  business: {
    business_name: { max: 200 },
    neq: { max: 20 },
    gst_number: { max: 30 },
    qst_number: { max: 30 },
  },
};

function json(res: unknown, status = 200): Response {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function loadConfig(): any {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}
function parseSlugBlob(raw: unknown): Record<string, string> {
  if (!raw) return {};
  try {
    const d = JSON.parse(String(raw));
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
}
// Two-layer storage, same data as the CLI: durable copy in the key vault
// (write-only), local 0600 read mirror in pages-data. The desktop does not
// resync vault values into the plugin config file outside its periodic sweep,
// so reads come from the mirror (seeded from the config file when a sweep
// already delivered vault values on a fresh desktop).
type Mirror = Record<string, any>; // slug -> object (groups) or array (cards)
function loadMirror(): Mirror {
  try {
    const d = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    if (d && typeof d === "object" && !Array.isArray(d)) return d as Mirror;
  } catch {}
  const vault = loadConfig()?.vault;
  if (vault && typeof vault === "object") {
    const seeded: Mirror = {};
    let any = false;
    const slugs = [...Object.values(GROUP_SLUGS), CARDS_SLUG];
    for (const slug of slugs) {
      const vals = parseSlugBlob(vault[slug]?.apiKey);
      if (vals && ((Array.isArray(vals) && vals.length) || (!Array.isArray(vals) && Object.keys(vals).length))) {
        seeded[slug] = vals;
        any = true;
      }
    }
    if (any) {
      saveMirror(seeded);
      return seeded;
    }
  }
  return {};
}
function saveMirror(m: Mirror) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = CACHE_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(m, null, 1));
  chmodSync(tmp, 0o600);
  renameSync(tmp, CACHE_FILE);
  try { chmodSync(CACHE_FILE, 0o600); } catch {}
}
function groupValues(slug: string): Record<string, string> {
  const v = loadMirror()[slug];
  return v && !Array.isArray(v) ? v : {};
}
function cardsList(): any[] {
  const v = loadMirror()[CARDS_SLUG];
  return Array.isArray(v) ? v : [];
}
function saveCards(cards: any[]): { vault_ok: boolean; vault_erreur?: string } {
  const m = loadMirror();
  if (cards.length) m[CARDS_SLUG] = cards;
  else delete m[CARDS_SLUG];
  saveMirror(m);
  return vaultWrite(CARDS_SLUG, cards);
}
function policy(): boolean {
  const v = loadConfig()?.settings?.sensitive_require_confirmation;
  if (v === undefined || v === null || v === "") return true;
  return !(v === false || v === "false" || v === "0" || v === 0);
}

function validCalendarDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= daysInMonth;
}
function validateValue(fieldName: string, spec: FieldSpec, value: string): string {
  let v = String(value == null ? "" : value).trim();
  if (!v) return "";
  if (spec.validate === "sin") v = v.replace(/[\s-]/g, ""); // normalize before the length cap
  if (v.length > spec.max) throw new Error(`value too long for ${fieldName} (${spec.max} max)`);
  if (spec.validate === "sin") {
    const digits = v.replace(/[\s-]/g, "");
    if (!/^\d{9}$/.test(digits)) throw new Error(`invalid ${fieldName}: expected 9 digits`);
    v = digits;
  } else if (spec.validate === "date") {
    if (!validCalendarDate(v)) throw new Error(`invalid ${fieldName}: expected a real date YYYY-MM-DD`);
  } else if (spec.validate === "email") {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new Error(`invalid ${fieldName}`);
  }
  return v;
}

/** Write the mirror (read path) and the vault (durable copy). */
function writeGroup(slug: string, data: Record<string, string>): { vault_ok: boolean; vault_erreur?: string } {
  const m = loadMirror();
  if (Object.keys(data).length) m[slug] = data;
  else delete m[slug];
  saveMirror(m);
  return vaultWrite(slug, data);
}
function vaultWrite(slug: string, data: any): { vault_ok: boolean; vault_erreur?: string } {
  const p = Bun.spawnSync(["ob-plugin", "vault", PLUGIN_ID, `${slug}=${JSON.stringify(data)}`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (p.exitCode !== 0) {
    return { vault_ok: false, vault_erreur: p.stderr.toString().trim() || p.stdout.toString().trim() || `exit ${p.exitCode}` };
  }
  return { vault_ok: true };
}

// ---------- cards ----------
type Card = {
  id: string;
  type: string;
  brand: string;
  last4: string;
  label: string;
  expiry: string;
  status: string;
  updatedAt: string;
};
function cleanCard(raw: any, partial = false): Partial<Card> {
  const c: Partial<Card> = {};
  if (raw.type !== undefined || !partial) {
    const t = String(raw.type ?? "").trim().toLowerCase();
    if (!CARD_TYPES.includes(t)) throw new Error(`invalid card type: ${raw.type} (expected debit|credit)`);
    c.type = t;
  }
  if (raw.brand !== undefined) c.brand = String(raw.brand ?? "").trim().slice(0, 40);
  if (raw.last4 !== undefined || !partial) {
    const l = String(raw.last4 ?? "").trim().replace(/[\s-]/g, "");
    if (/^\d{5,19}$/.test(l)) throw new Error("never store a full card number — only the last 4 digits");
    if (!/^\d{4}$/.test(l)) throw new Error(`invalid last4: expected exactly 4 digits`);
    c.last4 = l;
  }
  if (raw.label !== undefined) c.label = String(raw.label ?? "").trim().slice(0, 60);
  if (raw.expiry !== undefined && String(raw.expiry ?? "").trim()) {
    const e = String(raw.expiry).trim();
    const m = /^(\d{4})-(\d{2})$/.exec(e);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(`invalid expiry: expected YYYY-MM`);
    c.expiry = e;
  } else if (raw.expiry !== undefined) c.expiry = "";
  return c;
}
function resolveCard(cards: Card[], ref: string): Card {
  const r = String(ref ?? "").trim().replace(/[\s-]/g, "");
  const byId = cards.find((c) => c.id === ref);
  if (byId) return byId;
  if (/^\d{4}$/.test(r)) {
    const byLast4 = cards.filter((c) => c.last4 === r);
    if (byLast4.length === 1) return byLast4[0];
    if (byLast4.length > 1) throw new Error(`several cards end with ${r} — use the card id`);
  }
  throw new Error(`card not found: ${ref}`);
}

async function readBody(req: Request): Promise<any> {
  const body = await req.text();
  if (body.length > MAX_BODY) throw new Error("body too large (64 KB max)");
  if (!body) return {};
  return JSON.parse(body);
}

async function handleApi(req: Request, path: string): Promise<Response> {
  const url = new URL(req.url);
  const seg = path.split("/").filter(Boolean);
  if (seg[0] !== "api") return json({ ok: false, erreur: "not found" }, 404);
  const rest = seg.slice(1);

  if (req.method === "GET" && rest[0] === "profile") {
    const groups: Record<string, { values: Record<string, string> }> = {};
    for (const [g, slug] of Object.entries(GROUP_SLUGS)) groups[g] = { values: groupValues(slug) };
    return json({ ok: true, groups, sensitive_require_confirmation: policy() });
  }

  if (req.method === "POST" && rest[0] === "profile") {
    const b = await readBody(req);
    const body = b && typeof b === "object" ? b : {};
    const groupsIn = body.groups && typeof body.groups === "object" ? body.groups : {};
    const wanted = Object.keys(groupsIn).filter((g) => GROUP_SLUGS[g]);
    if (!wanted.length) throw new Error("no valid group in payload (identity, contact, government, business)");
    const saved: string[] = [];
    for (const g of wanted) {
      const specs = GROUP_FIELDS[g];
      const incoming = groupsIn[g] && typeof groupsIn[g] === "object" ? groupsIn[g] : {};
      const data: Record<string, string> = {};
      for (const [name, spec] of Object.entries(specs)) {
        if (incoming[name] !== undefined) {
          const v = validateValue(name, spec, incoming[name]);
          if (v) data[name] = v;
        }
      }
      for (const key of Object.keys(incoming)) {
        if (!specs[key]) throw new Error(`unknown field in group ${g}: ${key}`);
      }
      const r = writeGroup(GROUP_SLUGS[g], data);
      if (!r.vault_ok) throw new Error(`vault write failed: ${r.vault_erreur}`);
      saved.push(GROUP_SLUGS[g]);
    }
    return json({ ok: true, saved });
  }

  // ----- cards -----
  if (req.method === "GET" && rest[0] === "cards" && rest.length === 1) {
    const st = url.searchParams.get("status");
    let cards = cardsList();
    if (st) {
      if (!CARD_STATUSES.includes(st)) throw new Error(`invalid status filter: ${st} (expected active|inactive)`);
      cards = cards.filter((c) => c.status === st);
    }
    return json({ ok: true, count: cards.length, cards });
  }
  if (req.method === "POST" && rest[0] === "cards" && rest.length === 1) {
    const b = await readBody(req);
    const clean = cleanCard(b, false) as Card;
    const cards = cardsList();
    if (cards.some((c) => c.last4 === clean.last4 && (c.brand || "").toLowerCase() === (clean.brand || "").toLowerCase())) {
      throw new Error(`card already exists: ${clean.brand || "card"} •••• ${clean.last4}`);
    }
    if (cards.length >= 20) throw new Error("too many cards (20 max)");
    const card: Card = {
      id: `card_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      type: clean.type,
      brand: clean.brand || "",
      last4: clean.last4,
      label: clean.label || "",
      expiry: clean.expiry || "",
      status: "active",
      updatedAt: new Date().toISOString(),
    };
    cards.push(card);
    const v = saveCards(cards);
    if (!v.vault_ok) throw new Error(`vault write failed: ${v.vault_erreur}`);
    return json({ ok: true, card }, 201);
  }
  if (rest[0] === "cards" && rest.length === 2) {
    const cards = cardsList();
    const card = resolveCard(cards, rest[1]);
    if ((req.method === "PATCH" || req.method === "PUT") ) {
      const b = await readBody(req);
      const clean = cleanCard(b, true);
      const allowed: (keyof Card)[] = ["type", "brand", "last4", "label", "expiry"];
      let touched = false;
      for (const k of allowed) if (clean[k] !== undefined) { (card as any)[k] = clean[k]; touched = true; }
      if (b.status !== undefined) {
        const st = String(b.status).trim().toLowerCase();
        if (!CARD_STATUSES.includes(st)) throw new Error("invalid status: expected active|inactive");
        card.status = st;
        touched = true;
      }
      if (!touched) throw new Error("nothing to update (type, brand, last4, label, expiry, status)");
      card.updatedAt = new Date().toISOString();
      const v = saveCards(cards);
      if (!v.vault_ok) throw new Error(`vault write failed: ${v.vault_erreur}`);
      return json({ ok: true, card });
    }
    if (req.method === "DELETE") {
      const removed = card;
      const v = saveCards(cards.filter((c) => c.id !== card.id));
      if (!v.vault_ok) throw new Error(`vault write failed: ${v.vault_erreur}`);
      return json({ ok: true, removed });
    }
    return json({ ok: false, erreur: "method not allowed" }, 405);
  }

  return json({ ok: false, erreur: "not found" }, 404);
}

// UI routing (dashboard-server model, 2026-10-16): the installed payload ships
// a bundled, standalone HTML (control-plane build of index.html + app.ts +
// styles.css) handed over via OPEN_BOT_PAGE_UI. Local checkouts / previews
// import the HTML live instead — Bun bundles app.ts + styles.css on the fly
// (bun --hot). Static value on purpose: the HTML import must be resolved
// before Bun.serve.
const routes: Record<string, unknown> = process.env.OPEN_BOT_PAGE_UI
  ? {
      "/": () =>
        new Response(Bun.file(process.env.OPEN_BOT_PAGE_UI as string), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
        }),
    }
  : // Default: the standalone build (scripts/build-ui.ts → ui.html), so the
    // dashboard proxy never meets Bun dev-serve /_bun chunks it cannot route.
    // Dev-serve fallback only when ui.html has not been built yet.
    { "/": existsSync(join(import.meta.dir, "ui.html")) ? () => new Response(Bun.file(join(import.meta.dir, "ui.html")), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } }) : await import("./index.html").then((m) => m.default) };

// Platform page token: when the control plane sets OPEN_BOT_PAGE_TOKEN, every
// API call must carry exactly that token (header x-open-bot-page-token) — no
// literal fallback, so a token-set (installed/production) server never accepts
// a well-known value. Unset = local dev / preview without a token: no check.
// /healthz stays open in both modes.
function authorized(req: Request): boolean {
  const expected = process.env.OPEN_BOT_PAGE_TOKEN;
  if (!expected) return true;
  return (req.headers.get("x-open-bot-page-token") ?? "") === expected;
}

Bun.serve({
  port: Number(process.env.OPEN_BOT_PAGE_PORT ?? 4748),
  // No "hostname" pin: the dashboard control plane probes over ::1 / the
  // container network — binding 127.0.0.1 only makes the probe (and the tab)
  // fail with running:false while the server is healthy. Security is the
  // page token (OPEN_BOT_PAGE_TOKEN), not the bind address.
  routes: routes as never,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;
    for (const prefix of [`/api/pages/${PLUGIN_ID}`, `/hooks/${PLUGIN_ID}`]) {
      if (path === prefix) path = "/";
      else if (path.startsWith(prefix + "/")) path = path.slice(prefix.length);
    }
    if (path === "/healthz") return new Response("ok");
    if (!authorized(req)) return json({ ok: false, erreur: "unauthorized" }, 401);
    try {
      return await handleApi(req, path);
    } catch (e: any) {
      const msg = String(e?.message || e);
      return json({ ok: false, erreur: msg.includes("JSON") ? "invalid JSON body" : msg }, 400);
    }
  },
});
