/* Reading courses, cheat sheets and progress from disk.
 *
 * Shared by the server, check.js and due.js. Nothing is cached: files are read
 * on every request, so a course Claude just wrote shows up on reload without
 * restarting anything.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { PATHS, readOwnJSON, writeJSON } = require("./config");

const TOUR = path.join(PATHS.examples, "tour");

/* Folders a course can come from: the user's data folder and, unless hidden in
 * Settings, the tour that ships with the repo. */
function sources(settings){
  const out = [{ kind: "data", dir: PATHS.data }];
  if (settings.showTour) out.push({ kind: "example", dir: TOUR });
  return out;
}

/* Reads every .json in `sub` of each source and keeps the ones that have an
 * `id` and the expected array. A broken file is skipped with a warning instead
 * of taking the whole app down. The first course with a given id wins, so a
 * user course called "tour" replaces the example. */
function readPack(settings, sub, key, warn){
  const out = [], ids = new Set();
  for (const src of sources(settings)){
    const dir = path.join(src.dir, sub);
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort(); } catch(e){ continue; }
    for (const f of files){
      try {
        const c = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        if (!c.id || !Array.isArray(c[key])) throw new Error(`needs an \`id\` and a \`${key}\` list`);
        if (ids.has(c.id)) continue;
        ids.add(c.id);
        c._source = src.kind;
        c._file = path.join(dir, f);
        out.push(c);
      } catch(e){
        if (warn) warn(`${path.join(sub, f)} skipped: ${e.message}`);
      }
    }
  }
  return out;
}

function readCourses(settings, warn){ return readPack(settings, "courses", "questions", warn); }
function readSheets(settings, warn){  return readPack(settings, "sheets",  "sheets",    warn); }

/* --------------------------------------------------------------- progress */

/* Throws if progress.json exists but is broken, so it never gets replaced. */
function readProgress(){
  const p = readOwnJSON(PATHS.progress, { schema: 1, savedAt: null, cards: {} },
    "fix it or copy the latest file from backups/ over it");
  if (!p || typeof p.cards !== "object" || !p.cards)
    throw new Error("progress.json has no `cards`. Nothing was written over it.");
  return p;
}

/* Once a day, before the first save, a copy of progress.json goes to
 * backups/progress-YYYY-MM-DD.json. The last 14 are kept. */
const KEEP_BACKUPS = 14;

function backupProgress(reason){
  if (!fs.existsSync(PATHS.progress)) return;
  const d = new Date();
  const day = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  /* A reset always gets its own copy, taken right before it. */
  const file = path.join(PATHS.backups, reason
    ? `progress-${day}-before-${reason}-${Date.now()}.json`
    : `progress-${day}.json`);
  if (fs.existsSync(file)) return;
  fs.mkdirSync(PATHS.backups, { recursive: true });
  fs.copyFileSync(PATHS.progress, file);
  const old = fs.readdirSync(PATHS.backups).filter(f => /^progress-\d{4}-\d\d-\d\d\.json$/.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) fs.unlinkSync(path.join(PATHS.backups, f));
}

/* Merges what arrives with what's there: for each card the most recent review
 * wins, so two devices at once don't overwrite each other. */
function mergeProgress(incoming){
  const cur = readProgress();
  backupProgress();
  let changed = 0;
  for (const [id, card] of Object.entries(incoming || {})){
    if (!card || typeof card !== "object") continue;
    const mine = cur.cards[id];
    if (!mine || String(card.lastReviewed || "") >= String(mine.lastReviewed || "")){
      cur.cards[id] = card;
      changed++;
    }
  }
  cur.savedAt = new Date().toISOString();
  writeJSON(PATHS.progress, cur);
  return { changed, savedAt: cur.savedAt };
}

/* Forgets every card of one course: its questions and its cheat-sheet holes. */
function resetCourse(courseId){
  const cur = readProgress();
  backupProgress("reset-" + courseId.replace(/[^a-z0-9-]/gi, ""));
  let removed = 0;
  for (const id of Object.keys(cur.cards)){
    if (id.startsWith(courseId + "/") || id.startsWith("sheet:" + courseId + "/")){
      delete cur.cards[id];
      removed++;
    }
  }
  cur.savedAt = new Date().toISOString();
  writeJSON(PATHS.progress, cur);
  return removed;
}

/* ------------------------------------------------------------------ media */

/* Images and audio referenced by courses ("tour/curve.svg") are looked up in
 * the data folder first, then in the tour. Returns null if the path tries to
 * escape those folders or the file doesn't exist. */
function mediaFile(rel, settings){
  for (const src of sources(settings)){
    const base = path.join(src.dir, "media");
    const file = path.join(base, rel);
    if (!file.startsWith(base + path.sep)) return null;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

module.exports = { readCourses, readSheets, readProgress, mergeProgress, resetCourse, mediaFile };
