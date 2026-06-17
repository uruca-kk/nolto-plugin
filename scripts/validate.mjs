#!/usr/bin/env node
// validate.mjs — Nolto Claude Code plugin validator.
// Node built-ins only. Run: node claude-plugin/scripts/validate.mjs (any cwd)
// Exit 0: all checks pass. Exit 1: one error line per failure (file + reason).

import { readFileSync, readdirSync } from "fs";
import { resolve, join } from "path";
import { fileURLToPath } from "url";

const PLUGIN_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const REPO_ROOT = resolve(PLUGIN_ROOT, "..");
const pp = (...p) => join(PLUGIN_ROOT, ...p);
const rp = (...p) => join(REPO_ROOT, ...p);

// --- error collection -------------------------------------------------------

const errors = [];
const fail = (file, reason) => errors.push({ file, reason });

// --- I/O helpers ------------------------------------------------------------

function readJSON(rel) {
  const abs = pp(rel);
  let raw;
  try { raw = readFileSync(abs, "utf8"); } catch { fail(abs, "File not found or unreadable"); return null; }
  try { return JSON.parse(raw); } catch (e) { fail(abs, `Invalid JSON: ${e.message}`); return null; }
}

function readRepo(rel) {
  const abs = rp(rel);
  try { return readFileSync(abs, "utf8"); }
  catch { fail(abs, "Not found (needed for literal-drift check)"); return null; }
}

// --- templates --------------------------------------------------------------

const PLAN_CONTENT_MAX = 50_000;
const CANON_JP = ["未着手", "進行中", "完了", "破棄"];

function checkTemplates() {
  const tmplDir = pp("templates");
  const planTmpl = join(tmplDir, "plan-template.md");
  const claudeSample = join(tmplDir, "CLAUDE.md.sample");

  let raw;
  try { raw = readFileSync(planTmpl, "utf8"); } catch { fail(planTmpl, "File not found"); return; }
  if (!raw.trim().length) { fail(planTmpl, "empty"); return; }
  const byteLen = Buffer.byteLength(raw, "utf8");
  if (byteLen >= PLAN_CONTENT_MAX) fail(planTmpl, `exceeds PLAN_CONTENT_MAX: ${byteLen} bytes (max ${PLAN_CONTENT_MAX - 1})`);

  // JP status-label hygiene: pipe-table cells of 2–4 JP chars must be canonical.
  // Strip HTML comments first to avoid matching documentation tables inside <!-- -->.
  const rawNoComments = raw.replace(/<!--[\s\S]*?-->/g, "");
  for (const [, cell] of rawNoComments.matchAll(/\|\s*([^\|]{2,4})\s*\|/g)) {
    const t = cell.trim();
    if (/^[　-鿿豈-﫿]{2,4}$/.test(t) && !CANON_JP.includes(t))
      fail(planTmpl, `Non-canonical JP status label "${t}" in table. Valid: ${CANON_JP.join(", ")}`);
  }

  // Marker-family presence (use comment-stripped string — same as JP-label check above)
  if (!/(✅|完了|済)/.test(rawNoComments)) fail(planTmpl, 'Missing done-family marker (✅ / 完了 / 済)');
  if (!/進行中|着手/.test(rawNoComments)) fail(planTmpl, 'Missing in_progress-family marker (進行中 / 着手)');
  if (!/- \[ \]/.test(rawNoComments)) fail(planTmpl, 'Missing not_started example (- [ ])');

  let sampleRaw;
  try { sampleRaw = readFileSync(claudeSample, "utf8"); } catch { fail(claudeSample, "File not found"); return; }
  if (!sampleRaw.trim().length) fail(claudeSample, "empty");
}

// --- canonical literal extraction -------------------------------------------

const arrRe = (name) => new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[([^\\]]+)\\]`, "s");
const objRe = (name) => new RegExp(`const\\s+${name}[^=]*=\\s*(?:Object\\.freeze\\()?\\{([^}]+)\\}`, "s");
const extractArr = (src, name) => { const m = src.match(arrRe(name)); return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null; };
const extractKeys = (src, name) => { const m = src.match(objRe(name)); return m ? [...m[1].matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*):/gm)].map((x) => x[1]) : null; };
// Extract string values (quoted) from an object literal — used for PLAN_STATUS_LABELS JP values.
const extractVals = (src, name) => { const m = src.match(objRe(name)); return m ? [...m[1].matchAll(/:\s*"([^"]+)"/g)].map((x) => x[1]) : null; };

function loadCanonicals() {
  const [sSrc, rSrc, scSrc, scopeSrc] = [
    readRepo("packages/core/src/status.ts"),
    readRepo("packages/core/src/results.ts"),
    readRepo("packages/core/src/schemas.ts"),
    readRepo("apps/web/lib/oauth/scopes.ts"),
  ];
  if (!sSrc || !rSrc || !scSrc || !scopeSrc) return null;

  const planStatuses = extractArr(sSrc, "PLAN_STATUSES");
  const planStatusLabels = extractVals(sSrc, "PLAN_STATUS_LABELS");
  const testVerdicts = extractArr(rSrc, "TEST_VERDICTS");
  const reviewVerdicts = extractArr(rSrc, "REVIEW_VERDICTS");
  const planDocumentKinds = extractArr(scSrc, "PLAN_DOCUMENT_KINDS");
  const toolNames = extractKeys(scopeSrc, "TOOL_SCOPE_MAP");

  const missing = ["PLAN_STATUSES", "PLAN_STATUS_LABELS", "TEST_VERDICTS", "REVIEW_VERDICTS", "PLAN_DOCUMENT_KINDS", "TOOL_SCOPE_MAP"]
    .filter((_, i) => ![planStatuses, planStatusLabels, testVerdicts, reviewVerdicts, planDocumentKinds, toolNames][i]);
  if (missing.length) { fail(rp("packages/core/src/"), `Could not extract: ${missing.join(", ")}`); return null; }

  return { planStatuses, planStatusLabels, testVerdicts, reviewVerdicts, planDocumentKinds, toolNames };
}

// --- plugin.json ------------------------------------------------------------

function checkPlugin() {
  const d = readJSON(".claude-plugin/plugin.json");
  if (!d) return;
  const f = pp(".claude-plugin/plugin.json");
  if (!/^[a-z][a-z0-9-]*$/.test(d.name)) fail(f, `name must be kebab-case, got: ${JSON.stringify(d.name)}`);
  else if (d.name !== "nolto") fail(f, `name must be "nolto", got: "${d.name}"`);
  if (!/^\d+\.\d+\.\d+$/.test(d.version)) fail(f, `version must be semver, got: ${JSON.stringify(d.version)}`);
  if (d.version !== "0.2.5") fail(f, `version must be "0.2.5", got: "${d.version}"`);
  for (const k of ["displayName", "description", "homepage", "repository", "license"])
    if (typeof d[k] !== "string" || !d[k]) fail(f, `${k} must be a non-empty string`);
  if (!d.author || typeof d.author !== "object") fail(f, "author must be an object");
  else {
    if (!d.author.name) fail(f, "author.name must be a non-empty string");
    if (!d.author.email) fail(f, "author.email must be a non-empty string");
  }
  if (!Array.isArray(d.keywords) || !d.keywords.length) fail(f, "keywords must be a non-empty array");
  // CRITICAL: hooks must NOT be defined in plugin.json — hooks/hooks.json is auto-loaded by Claude Code v2.1+.
  // Adding a hooks field here causes a duplicate-hooks error.
  if (d.hooks !== undefined) fail(f, "plugin.json must NOT define a hooks field — hooks/hooks.json is auto-loaded by Claude Code v2.1+");
}

// --- marketplace.json -------------------------------------------------------

function checkMarketplace() {
  const d = readJSON(".claude-plugin/marketplace.json");
  if (!d) return;
  const f = pp(".claude-plugin/marketplace.json");
  if (d.name !== "nolto") fail(f, `name must be "nolto", got: ${JSON.stringify(d.name)}`);
  if (!d.owner?.name) fail(f, "owner.name must be a non-empty string");
  if (!Array.isArray(d.plugins) || !d.plugins.length) { fail(f, "plugins must be a non-empty array"); return; }
  const e = d.plugins[0];
  if (e.name !== "nolto") fail(f, `plugins[0].name must be "nolto"`);
  if (e.source !== "./") fail(f, `plugins[0].source must be "./"`);
  if (e.version !== "0.2.5") fail(f, `plugins[0].version must be "0.2.5"`);
  if (!e.description) fail(f, "plugins[0].description must be non-empty");
}

// --- .mcp.json --------------------------------------------------------------

function checkMcp() {
  const d = readJSON(".mcp.json");
  if (!d) return;
  const f = pp(".mcp.json");
  const s = d?.mcpServers?.nolto;
  if (!s) { fail(f, "mcpServers.nolto must be present"); return; }
  if (s.type !== "http") fail(f, `mcpServers.nolto.type must be "http", got: ${JSON.stringify(s.type)}`);
  if (s.url !== "https://nolto.app/mcp") fail(f, `mcpServers.nolto.url must be "https://nolto.app/mcp"`);
  if ("headers" in s) fail(f, `mcpServers.nolto must NOT have "headers" (zero-secret assertion)`);
}

// --- skills -----------------------------------------------------------------

function parseFm(raw, file) {
  const parts = raw.split(/^---\s*$/m);
  if (parts.length < 3) { fail(file, "Frontmatter fences missing or malformed"); return null; }
  const fm = {};
  for (const line of parts[1].split("\n")) {
    const ci = line.indexOf(":");
    if (ci === -1) continue;
    const k = line.slice(0, ci).trim();
    if (k) fm[k] = line.slice(ci + 1).trim();
  }
  return { fm, body: parts.slice(2).join("---") };
}

function checkSkillBody(body, file, c) {
  const canonSet = new Set([...c.planStatuses, ...c.testVerdicts, ...c.reviewVerdicts, ...c.planDocumentKinds]);
  const toolSet = new Set(c.toolNames);

  // Tool-name check
  for (const [, name] of body.matchAll(/mcp__nolto__([a-z_]+)/g))
    if (!toolSet.has(name)) fail(file, `Tool "mcp__nolto__${name}" is not a known MCP tool`);

  // Enum-literal drift check: backtick literals that are purely lowercase+underscore
  const nonEnum = new Set([
    ...c.toolNames,
    "planId","phaseId","projectId","uuid","queued","processing","completed",
    "status","verdict","message","summary","round","title","content","phases",
    "type","http","url","headers","encoding","utf","base","kind","source",
    "hash","path","file","api","mcp","manual","ok",
  ]);
  const lits = [...body.matchAll(/`([^`\n]+)`/g)]
    .map((m) => m[1])
    .filter((l) => !l.includes("mcp__nolto__"))
    .flatMap((l) => (l.includes("|") ? l.split("|").map((s) => s.trim()) : [l]))
    .filter((l) => /^[a-z][a-z_]*$/.test(l));
  for (const lit of lits) {
    if (nonEnum.has(lit) || toolSet.has(lit)) continue;
    if (!canonSet.has(lit)) fail(file, `\`${lit}\` not in PLAN_STATUSES/TEST_VERDICTS/REVIEW_VERDICTS/PLAN_DOCUMENT_KINDS. Valid: ${[...canonSet].join(", ")}`);
  }
}

// JP label table pattern: rows of the form "| `<status_enum>` | <jp_label> |"
// The first cell must be a backtick-quoted lowercase-underscore token (i.e. a status enum key).
const JP_LABEL_RE = /\|\s*`([a-z][a-z_]*)`\s*\|\s*([^|]+?)\s*\|/g;

function checkJpStatusLabels(c) {
  const skillFile = pp("skills/plan-status/SKILL.md");
  let raw;
  try { raw = readFileSync(skillFile, "utf8"); }
  catch { fail(skillFile, "Not found (needed for JP label drift check)"); return; }

  const statusSet = new Set(c.planStatuses);
  const labelSet = new Set(c.planStatusLabels);
  for (const [, statusKey, cell] of raw.matchAll(JP_LABEL_RE)) {
    // Only check rows whose first cell is a known status key.
    if (!statusSet.has(statusKey)) continue;
    const label = cell.trim();
    // Only check cells that contain at least one CJK character (JP labels).
    if (!/[　-鿿豈-﫿]/.test(label)) continue;
    if (!labelSet.has(label)) {
      fail(skillFile, `JP status label "${label}" is not in PLAN_STATUS_LABELS. Valid: ${[...labelSet].join(", ")}`);
    }
  }
}

function checkSkills(c) {
  let dirs;
  const sd = pp("skills");
  try { dirs = readdirSync(sd, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { fail(sd, "skills/ directory not found"); return; }
  if (!dirs.length) { fail(sd, "No skill directories found"); return; }

  for (const dir of dirs) {
    const f = pp("skills", dir, "SKILL.md");
    let raw;
    try { raw = readFileSync(f, "utf8"); } catch { fail(f, "SKILL.md not found"); continue; }
    const parsed = parseFm(raw, f);
    if (!parsed) continue;
    const { fm, body } = parsed;
    if (!fm.name) fail(f, "frontmatter.name is missing");
    else if (fm.name !== dir) fail(f, `frontmatter.name "${fm.name}" does not match dir "${dir}"`);
    if (!fm.description || fm.description.length < 20) fail(f, `frontmatter.description must be ≥20 chars`);
    if (c) checkSkillBody(body, f, c);
  }
}

// --- hooks/hooks.json -------------------------------------------------------

function checkHooks() {
  const abs = pp("hooks/hooks.json");
  let raw;
  try { raw = readFileSync(abs, "utf8"); } catch { fail(abs, "hooks/hooks.json not found — required for v0.2.0+ Stop hook"); return; }
  let d;
  try { d = JSON.parse(raw); } catch (e) { fail(abs, `hooks/hooks.json invalid JSON: ${e.message}`); return; }
  if (!d || typeof d !== "object") { fail(abs, "hooks/hooks.json must be a top-level object"); return; }
  if (!d.hooks || typeof d.hooks !== "object") { fail(abs, "hooks/hooks.json must have a top-level hooks object"); return; }
  const stopArr = d.hooks["Stop"];
  if (!Array.isArray(stopArr) || stopArr.length === 0) {
    fail(abs, "hooks.Stop must be a non-empty array");
    return;
  }
  // Claude Code schema: each Stop entry is a matcher-group with a nested `hooks` array
  // (NOT a flat command entry). The old flat form failed to load ("expected array,
  // received undefined" at hooks.Stop[0].hooks).
  for (let i = 0; i < stopArr.length; i++) {
    const group = stopArr[i];
    if (!group || typeof group !== "object") { fail(abs, `hooks.Stop[${i}] must be an object`); continue; }
    const inner = group.hooks;
    if (!Array.isArray(inner) || inner.length === 0) {
      fail(abs, `hooks.Stop[${i}].hooks must be a non-empty array (nested matcher-group form)`);
      continue;
    }
    // Flat-form fields on the group are a sign of the old (broken) format.
    if ("command" in group || "type" in group)
      fail(abs, `hooks.Stop[${i}] must NOT have flat "type"/"command" — wrap them in a nested "hooks" array`);
    for (let j = 0; j < inner.length; j++) {
      const h = inner[j];
      if (!h || typeof h !== "object") { fail(abs, `hooks.Stop[${i}].hooks[${j}] must be an object`); continue; }
      if (h.type !== "command") fail(abs, `hooks.Stop[${i}].hooks[${j}].type must be "command", got: ${JSON.stringify(h.type)}`);
      if (typeof h.command !== "string" || !h.command) fail(abs, `hooks.Stop[${i}].hooks[${j}].command must be a non-empty string`);
      else if (!h.command.includes("nolto")) fail(abs, `hooks.Stop[${i}].hooks[${j}].command must reference "nolto", got: ${JSON.stringify(h.command)}`);
      if (h.timeout !== undefined && (typeof h.timeout !== "number" || h.timeout <= 0))
        fail(abs, `hooks.Stop[${i}].hooks[${j}].timeout must be a positive number`);
    }
  }
}

// --- main -------------------------------------------------------------------

checkPlugin();
checkMarketplace();
checkMcp();
checkHooks();
checkTemplates();
const canonicals = loadCanonicals();
if (canonicals) checkJpStatusLabels(canonicals);
checkSkills(canonicals);

if (errors.length) {
  for (const { file, reason } of errors) process.stdout.write(`FAIL  ${file}\n      ${reason}\n`);
  process.stdout.write(`\n${errors.length} error(s) found. Validation failed.\n`);
  process.exit(1);
} else {
  const n = (() => { try { return readdirSync(pp("skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).length; } catch { return 0; } })();
  process.stdout.write(`OK    plugin.json / marketplace.json / .mcp.json / templates / ${n} skills — all checks passed.\n`);
  process.exit(0);
}
