/* Where things live, and the user's settings.
 *
 * The app (this repo) and the user's data are kept apart on purpose. The repo
 * is code you can update or rewrite; the data folder is yours — courses,
 * cheat sheets, images, progress and settings — and can live anywhere, for
 * example inside a notes vault.
 *
 * The data folder is resolved in this order:
 *   1. PREGUNTON_DATA environment variable
 *   2. "dataDir" in local.json at the repo root (written by SETUP.md, gitignored)
 *   3. ./data inside the repo
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

const ROOT     = path.resolve(__dirname, "..");
const EXAMPLES = path.join(ROOT, "examples");

function expand(p){
  if (!p) return p;
  if (p === "~" || p.startsWith("~/")) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(ROOT, p);
}

function readJSON(file, fallback){
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch(e){ return fallback; }
}

/* For files we write back (progress, settings). A missing file is fine; a file
 * that exists but can't be parsed throws, so nothing gets written over it:
 * replacing a broken progress.json with a fresh one would silently lose every
 * card. Better to stop and say so. */
function readOwnJSON(file, fallback, fix){
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch(e){
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
  try { return JSON.parse(text); }
  catch(e){
    throw new Error(`${path.basename(file)} in ${path.dirname(file)} isn't valid JSON (${e.message}). `
      + `Nothing was written over it: ${fix || "fix it"}, then reload.`);
  }
}

/* Atomic write: a crash halfway never leaves a half-written file. */
function writeJSON(file, data){
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

const local = readJSON(path.join(ROOT, "local.json"), {});
const DATA  = expand(process.env.PREGUNTON_DATA || local.dataDir || "data");

const PATHS = {
  root:     ROOT,
  public:   path.join(ROOT, "public"),
  examples: EXAMPLES,
  data:     DATA,
  courses:  path.join(DATA, "courses"),
  sheets:   path.join(DATA, "sheets"),
  media:    path.join(DATA, "media"),
  progress: path.join(DATA, "progress.json"),
  settings: path.join(DATA, "settings.json"),
  backups:  path.join(DATA, "backups")
};

function ensureDataDir(){
  for (const d of [PATHS.courses, PATHS.sheets, PATHS.media]) fs.mkdirSync(d, { recursive: true });
}

/* ---------------------------------------------------------------- settings */

/* Every setting the app knows, with its default. settings.json only needs to
 * hold what the user changed; anything missing falls back to this. To add a
 * setting, add it here and to public/settings.js. */
const DEFAULTS = {
  port: 4700,
  lan:  false,               // also listen on the local network, to study from a phone (no password!)
  appearance: {
    theme:   "light",        // light · dark · system
    accent:  "#ffd60a",      // what's yours: selection, what's due, the suggested grade
    corners: "square",       // square · rounded
    font:    "system",       // system · serif · mono
    size:    16              // base font size in px
  },
  study: {
    sessionSize: 15,         // questions per round
    newPerDay:   20,         // brand-new questions introduced per day (0 = no limit)
    recallFirst: false,      // hide options until you say whether you can recall it
    interleave:  true        // mix courses in a round instead of one after another
  },
  modules: {
    sheets:   true,          // Cheat sheets tab
    audio:    true,          // Listen buttons (browser voices, no setup)
    diagrams: true,          // Mermaid diagrams (loaded from a CDN the first time)
    open:     true           // free-text questions graded against a rubric
  },
  audio: { rate: 1 },
  open: {
    grader: "self",          // self · ollama
    model:  "qwen3:8b",
    host:   "http://127.0.0.1:11434"
  },
  showTour:      true,       // the example course in examples/tour
  hiddenCourses: []
};

function isObj(x){ return x && typeof x === "object" && !Array.isArray(x); }

function merge(base, over){
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const [k, v] of Object.entries(over || {})){
    out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

/* A broken settings.json shouldn't stop anyone studying: reading falls back
 * to the defaults, and only saving refuses (see writeSettings). */
function readSettings(){
  return merge(DEFAULTS, readJSON(PATHS.settings, {}));
}

/* Only keys that exist in DEFAULTS are kept, so a typo or an old setting
 * can't pile up in the file. */
function pick(base, input){
  const out = {};
  for (const k of Object.keys(base)){
    if (!(k in (input || {}))) continue;
    out[k] = isObj(base[k]) ? pick(base[k], input[k]) : input[k];
  }
  return out;
}

function writeSettings(input){
  const next = merge(merge(DEFAULTS, readOwnJSON(PATHS.settings, {}, "fix it or delete it to go back to the defaults")), pick(DEFAULTS, input));
  writeJSON(PATHS.settings, next);
  return next;
}

module.exports = { PATHS, DEFAULTS, readJSON, readOwnJSON, writeJSON, ensureDataDir, readSettings, writeSettings };
