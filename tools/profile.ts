#!/usr/bin/env bun
/**
 * ob-plugin-my-profile-profile — CLI of the my-profile plugin.
 *
 * Inter-plugin contract: any plugin, cron job or agent can read (and, with the
 * user's consent, update) the user's personal profile, one field at a time,
 * plus manage the user's payment cards (debit/credit, active/inactive status).
 * Output is always single-line JSON: {"ok":true|false,...}
 *
 * Storage (two layers, same data):
 *  - canonical durable copy: the key vault (slugs profile_*), written through
 *    `ob-plugin vault my-profile <slug>=<json>` — write-only by design;
 *  - local read mirror: ~/.open-bot/pages-data/my-profile/profile.json,
 *    chmod 600, kept in lockstep on every write. The desktop currently does
 *    not resync vault values into the plugin config file outside its periodic
 *    sweep (defect filed), so reads come from the mirror; if the mirror is
 *    missing but the config file already carries vault values (fresh desktop
 *    after a sweep), it is seeded from there.
 *
 * Card rule: the tool stores ONLY metadata (brand, last4, expiry, status).
 * It never accepts a full card number or a CVV — the last4 field must be
 * exactly 4 digits.
 *
 * Exit codes: 0 ok · 2 usage/validation · 4 not found / field not filled
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PLUGIN_ID = "my-profile";
const CONFIG_FILE = join(homedir(), ".config", "open-bot", `plugin-${PLUGIN_ID}.json`);
const DATA_DIR = join(homedir(), ".open-bot", "pages-data", PLUGIN_ID);
const CACHE_FILE = join(DATA_DIR, "profile.json");
const MAX_FIELD = 200;

type FieldSpec = { group: string; slug: string; sensitive: boolean; max: number; validate?: "date" | "email" | "sin" };
type Groups = Record<string, { slug: string; sensitive: boolean; fields: Record<string, FieldSpec> }>;

const CARDS_SLUG = "profile_cards";
const CARD_STATUSES = ["active", "inactive"] as const;
const CARD_TYPES = ["debit", "credit"] as const;

const GROUPS: Groups = {
  identity: { slug: "profile_identity", sensitive: false, fields: {} },
  contact: { slug: "profile_contact", sensitive: false, fields: {} },
  government: { slug: "profile_government", sensitive: true, fields: {} },
  business: { slug: "profile_business", sensitive: false, fields: {} },
};
const GROUP_FIELDS: Record<string, [string, number, ("date" | "email" | "sin")?][]> = {
  identity: [
    ["full_name", MAX_FIELD],
    ["date_of_birth", 10, "date"],
  ],
  contact: [
    ["address_line1", MAX_FIELD],
    ["address_line2", MAX_FIELD],
    ["city", 100],
    ["province", 100],
    ["postal_code", 20],
    ["country", 100],
    ["phone", 40],
    ["email", MAX_FIELD, "email"],
    ["work_email", MAX_FIELD, "email"],
  ],
  government: [
    ["sin", 9, "sin"],
    ["ramq", 20],
    ["driver_license", 30],
  ],
  business: [
    ["business_name", MAX_FIELD],
    ["neq", 20],
    ["gst_number", 30],
    ["qst_number", 30],
  ],
};
for (const [g, spec] of Object.entries(GROUP_FIELDS)) {
  for (const [name, max, validate] of spec) {
    GROUPS[g].fields[name] = { group: g, slug: GROUPS[g].slug, sensitive: GROUPS[g].sensitive, max, validate };
  }
}

const ALIASES: Record<string, string> = {
  name: "full_name",
  dob: "date_of_birth",
  birthday: "date_of_birth",
  nas: "sin",
  social_insurance_number: "sin",
  postal: "postal_code",
  zip: "postal_code",
  tps: "gst_number",
  tvq: "qst_number",
};

class ExitSignal extends Error {}
function out(obj: any, code = 0): never {
  console.log(JSON.stringify(obj));
  process.exitCode = code;
  throw new ExitSignal();
}
function fail(erreur: string, code = 2): never {
  out({ ok: false, erreur }, code);
}

// ---------- storage ----------
type Mirror = Record<string, any>; // slug -> object (groups) or array (cards)

function loadConfig(): any {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}
function parseSlugBlob(raw: unknown): any {
  if (!raw) return null;
  try {
    const d = JSON.parse(String(raw));
    return d && typeof d === "object" ? d : null;
  } catch {
    return null;
  }
}
function loadMirror(): Mirror {
  try {
    const d = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    if (d && typeof d === "object" && !Array.isArray(d)) return d as Mirror;
  } catch {}
  // seed from the plugin config file when a control-plane sweep already
  // delivered the vault values there (fresh desktop case)
  const vault = loadConfig()?.vault;
  if (vault && typeof vault === "object") {
    const seeded: Mirror = {};
    let any = false;
    const slugs = [...Object.values(GROUPS).map((g) => g.slug), CARDS_SLUG];
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
function cardsList(): Card[] {
  const v = loadMirror()[CARDS_SLUG];
  return Array.isArray(v) ? (v as Card[]) : [];
}
function saveCards(cards: Card[]): { vault_ok: boolean; vault_erreur?: string } {
  const m = loadMirror();
  if (cards.length) m[CARDS_SLUG] = cards;
  else delete m[CARDS_SLUG];
  saveMirror(m);
  return vaultWrite(CARDS_SLUG, cards);
}
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
/** true by default; only an explicit false in the plugin settings opts out. */
function requireConfirmation(): boolean {
  const v = loadConfig()?.settings?.sensitive_require_confirmation;
  if (v === undefined || v === null || v === "") return true;
  return !(v === false || v === "false" || v === "0" || v === 0);
}
function slugSaved(slug: string): boolean {
  const v = loadMirror()[slug];
  if (Array.isArray(v) ? v.length : v && Object.keys(v).length) return true;
  return Boolean(loadConfig()?.vault?.[slug]?.apiKey);
}

// ---------- profile validation ----------
function validCalendarDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= daysInMonth;
}
function validateValue(fieldName: string, field: FieldSpec, value: string): string {
  let v = String(value == null ? "" : value).trim();
  if (!v) return "";
  if (field.validate === "sin") v = v.replace(/[\s-]/g, ""); // normalize before the length cap
  if (v.length > field.max) fail(`value too long for ${fieldName} (${field.max} max)`);
  if (field.validate === "sin") {
    if (!/^\d{9}$/.test(v)) fail(`invalid ${fieldName}: expected 9 digits`);
  } else if (field.validate === "date") {
    if (!validCalendarDate(v)) fail(`invalid ${fieldName}: expected a real date YYYY-MM-DD`);
  } else if (field.validate === "email") {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) fail(`invalid ${fieldName}`);
  }
  return v;
}
function resolveField(name: string): [string, FieldSpec] {
  const key = ALIASES[name] ?? name;
  for (const g of Object.keys(GROUPS)) {
    const f = GROUPS[g].fields[key];
    if (f) return [key, f];
  }
  fail(`unknown field: ${name} (run "list" for available fields)`, 2);
}

// ---------- cards ----------
type Card = {
  id: string;
  type: (typeof CARD_TYPES)[number];
  brand: string;
  last4: string;
  label: string;
  expiry: string;
  status: (typeof CARD_STATUSES)[number];
  updatedAt: string;
};

function cleanCard(raw: any, partial = false): Partial<Card> {
  const c: Partial<Card> = {};
  if (raw.type !== undefined || !partial) {
    const t = String(raw.type ?? "").trim().toLowerCase();
    if (!(CARD_TYPES as readonly string[]).includes(t)) fail(`invalid card type: ${raw.type} (expected debit|credit)`);
    c.type = t as Card["type"];
  }
  if (raw.brand !== undefined) {
    c.brand = String(raw.brand ?? "").trim().slice(0, 40);
  }
  if (raw.last4 !== undefined || !partial) {
    const l = String(raw.last4 ?? "").trim().replace(/[\s-]/g, "");
    if (/^\d{5,19}$/.test(l)) fail("never store a full card number — only the last 4 digits");
    if (!/^\d{4}$/.test(l)) fail(`invalid last4: expected exactly 4 digits (got "${raw.last4}")`);
    c.last4 = l;
  }
  if (raw.label !== undefined) c.label = String(raw.label ?? "").trim().slice(0, 60);
  if (raw.expiry !== undefined && String(raw.expiry ?? "").trim()) {
    const e = String(raw.expiry).trim();
    const m = /^(\d{4})-(\d{2})$/.exec(e);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) fail(`invalid expiry: expected YYYY-MM (got "${raw.expiry}")`);
    c.expiry = e;
  } else if (raw.expiry !== undefined) {
    c.expiry = "";
  }
  return c;
}
function resolveCard(cards: Card[], ref: string): Card {
  const r = String(ref ?? "").trim().replace(/[\s-]/g, "");
  const byId = cards.find((c) => c.id === ref);
  if (byId) return byId;
  if (/^\d{4}$/.test(r)) {
    const byLast4 = cards.filter((c) => c.last4 === r);
    if (byLast4.length === 1) return byLast4[0];
    if (byLast4.length > 1) fail(`several cards end with ${r} — use the card id`);
  }
  fail(`card not found: ${ref}`, 4);
}

function cmdCards(sub: string, a: Args, pos: string[]) {
  if (sub === "list" || sub === "active") {
    let cards = cardsList();
    const want = sub === "active" ? "active" : String(a.status ?? "").trim().toLowerCase();
    if (want) {
      if (!(CARD_STATUSES as readonly string[]).includes(want)) fail(`invalid status filter: ${want} (expected active|inactive)`);
      cards = cards.filter((c) => c.status === want);
    }
    out({ ok: true, count: cards.length, cards });
    return;
  }
  if (sub === "add") {
    const clean = cleanCard(a, false) as Card;
    const cards = cardsList();
    if (cards.some((c) => c.last4 === clean.last4 && (c.brand || "").toLowerCase() === (clean.brand || "").toLowerCase())) {
      fail(`card already exists: ${clean.brand || "card"} •••• ${clean.last4}`);
    }
    if (cards.length >= 20) fail("too many cards (20 max)");
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
    out({ ok: true, card, vault_ok: v.vault_ok, ...(v.vault_erreur ? { vault_erreur: v.vault_erreur } : {}) });
    return;
  }
  if (sub === "status" || sub === "update") {
    const ref = pos[0];
    if (!ref) fail("card id or last4 required");
    const cards = cardsList();
    const card = resolveCard(cards, ref);
    if (sub === "status") {
      const st = String(a.status ?? pos[1] ?? "").trim().toLowerCase();
      if (!(CARD_STATUSES as readonly string[]).includes(st)) fail(`invalid status: expected active|inactive`);
      card.status = st as Card["status"];
    } else {
      const clean = cleanCard(a, true);
      const allowed: (keyof Card)[] = ["type", "brand", "last4", "label", "expiry"];
      let touched = false;
      for (const k of allowed) if (clean[k] !== undefined) { (card as any)[k] = clean[k]; touched = true; }
      if (a.status !== undefined) {
        const st = String(a.status).trim().toLowerCase();
        if (!(CARD_STATUSES as readonly string[]).includes(st)) fail(`invalid status: expected active|inactive`);
        card.status = st as Card["status"];
        touched = true;
      }
      if (!touched) fail("nothing to update (use --type, --brand, --last4, --label, --expiry, --status)");
    }
    card.updatedAt = new Date().toISOString();
    const v = saveCards(cards);
    out({ ok: true, card, vault_ok: v.vault_ok, ...(v.vault_erreur ? { vault_erreur: v.vault_erreur } : {}) });
    return;
  }
  if (sub === "remove" || sub === "rm" || sub === "delete") {
    const ref = pos[0];
    if (!ref) fail("card id or last4 required");
    const cards = cardsList();
    const card = resolveCard(cards, ref);
    const rest = cards.filter((c) => c.id !== card.id);
    const v = saveCards(rest);
    out({ ok: true, removed: card, vault_ok: v.vault_ok, ...(v.vault_erreur ? { vault_erreur: v.vault_erreur } : {}) });
    return;
  }
  out({ ok: false, erreur: "unknown cards subcommand", help: HELP }, 2);
}

// ---------- commands ----------
function cmdList() {
  const fields: Record<string, { field: string; filled: boolean; sensitive: boolean }[]> = {};
  let filled = 0;
  let total = 0;
  for (const g of Object.keys(GROUPS)) {
    const values = groupValues(GROUPS[g].slug);
    fields[g] = [];
    for (const name of Object.keys(GROUPS[g].fields)) {
      const spec = GROUPS[g].fields[name];
      const has = Boolean(String(values[name] ?? "").trim());
      total++;
      if (has) filled++;
      fields[g].push({ field: name, filled: has, sensitive: spec.sensitive });
    }
  }
  const cards = cardsList();
  out({
    ok: true,
    filled,
    total,
    require_confirmation_sensitive: requireConfirmation(),
    cards: { count: cards.length, active: cards.filter((c) => c.status === "active").length },
    groups: fields,
  });
}

function cmdGet(pos: string[]) {
  const [key, spec] = resolveField(pos[0] ?? "");
  const value = String(groupValues(spec.slug)[key] ?? "").trim();
  if (!value) out({ ok: false, erreur: `field not filled: ${key}`, field: key, group: spec.group, filled: false }, 4);
  out({
    ok: true,
    field: key,
    group: spec.group,
    value,
    sensitive: spec.sensitive,
    require_confirmation: spec.sensitive ? requireConfirmation() : false,
  });
}

function cmdSet(pos: string[], a: Args) {
  const [key, spec] = resolveField(pos[0] ?? "");
  const value = pos.length > 1 ? pos.slice(1).join(" ") : String(a.value ?? "");
  const clean = validateValue(key, spec, value);
  const current = groupValues(spec.slug);
  if (clean) current[key] = clean;
  else delete current[key];
  const v = writeGroup(spec.slug, current);
  out({
    ok: true,
    field: key,
    group: spec.group,
    sensitive: spec.sensitive,
    filled: Boolean(clean),
    vault_ok: v.vault_ok,
    ...(v.vault_erreur ? { vault_erreur: v.vault_erreur } : {}),
  });
}

function cmdPolicy() {
  out({ ok: true, sensitive_require_confirmation: requireConfirmation() });
}

function cmdSlugs() {
  const slugs = [
    ...Object.entries(GROUPS).map(([g, spec]) => ({ slug: spec.slug, group: g, sensitive: spec.sensitive, saved: slugSaved(spec.slug) })),
    { slug: CARDS_SLUG, group: "cards", sensitive: false, saved: slugSaved(CARDS_SLUG) },
  ];
  out({ ok: true, mirror: existsSync(CACHE_FILE), slugs });
}

// ---------- CLI parsing ----------
type Args = Record<string, string | boolean>;
function parseArgs(argv: string[]): { cmd: string; pos: string[]; a: Args } {
  const cmd = argv[0] ?? "help";
  const pos: string[] = [];
  const a: Args = {};
  for (let i = 1; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const nxt = argv[i + 1];
      if (nxt === undefined || nxt.startsWith("--")) a[key] = true;
      else {
        a[key] = nxt;
        i++;
      }
    } else pos.push(t);
  }
  return { cmd, pos, a };
}

const HELP = `ob-plugin-my-profile-profile — the user's personal profile, field by field (JSON output)

  list              — which fields exist and which are filled (never prints values)
  get <field>       — one field's value (e.g. get city, get sin, get full_name)
  set <field> <val> — update one field (with the user's consent)
  cards list [--status active|inactive] — payment cards (metadata only)
  cards active      — active cards only
  cards add --type debit|credit --last4 1234 [--brand visa] [--label] [--expiry 2029-05]
  cards status <id|last4> active|inactive
  cards update <id|last4> [--brand] [--label] [--expiry] [--status] [--last4] [--type]
  cards remove <id|last4>
  policy            — is sensitive_require_confirmation on?
  slugs             — vault slugs and whether a key is saved

Fields: full_name, date_of_birth | address_line1, address_line2, city,
province, postal_code, country, phone, email | sin (nas), ramq,
driver_license | business_name, neq, gst_number (tps), qst_number (tvq)

Cards: metadata only (brand, last4, expiry, status). NEVER a full card
number or CVV. Status active|inactive marks a card usable or obsolete.

Sensitive fields (government group): ALWAYS ask the user before using them,
unless the plugin setting sensitive_require_confirmation is false.`;

const { cmd, pos, a } = parseArgs(process.argv.slice(2));
try {
  switch (cmd) {
    case "list": cmdList(); break;
    case "get": cmdGet(pos); break;
    case "set": cmdSet(pos, a); break;
    case "cards": cmdCards(pos[0] ?? "list", a, pos.slice(1)); break;
    case "policy": cmdPolicy(); break;
    case "slugs":
    case "groups": cmdSlugs(); break;
    case "help": out({ ok: true, help: HELP }); break;
    default: out({ ok: false, erreur: "unknown command", help: HELP }, 2);
  }
} catch (e) {
  if (!(e instanceof ExitSignal)) throw e;
}
