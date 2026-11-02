/* Lints every course and cheat sheet without starting anything.
 *
 *   node check.js            everything
 *   node check.js tour       only courses whose id contains "tour"
 *
 * Exits with code 1 if there's any problem, so it can be chained.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { readSettings, PATHS } = require("./lib/config");
const store = require("./lib/store");
const { validateCourse, validateSheets, lengthStats } = require("./lib/validate");

const filter = process.argv[2] || "";
const settings = readSettings();
let problems = 0;

function report(label, list){
  console.log(`\n  ${label}${list.length ? "" : ", no problems"}`);
  problems += list.length;
  for (const p of list) console.log(`    ✕ ${p.path ? p.path + ": " : ""}${p.msg}`);
}

const skipped = [];
const courses = store.readCourses(settings, m => skipped.push(m));
const sheets  = store.readSheets(settings, m => skipped.push(m));

/* The first lines say where things go and what's on, so Claude can read them
 * instead of digging through the config. */
const where = process.env.PREGUNTON_DATA ? "from PREGUNTON_DATA"
  : fs.existsSync(path.join(PATHS.root, "local.json")) ? "from local.json"
  : "the default; set it in local.json";
const on = Object.keys(settings.modules).filter(k => settings.modules[k]);
console.log(`\n  Data folder: ${PATHS.data} (${where})`);
console.log(`  Features on: ${on.join(", ") || "none"}`);
for (const m of skipped){ console.log(`\n  ✕ ${m}`); problems++; }

for (const c of courses.filter(c => c.id.includes(filter))){
  const qs = c.questions;
  const open = qs.filter(q => q.type === "open").length;
  const s = lengthStats(qs);
  report(`${c.id} — ${qs.length} question(s)` + (open ? ` (${open} open)` : "")
    + (s.n ? ` · correct option is the longest in ${Math.round(s.longest * 100)}%` : "")
    + (c._source === "example" ? " · example" : ""), validateCourse(c, c.id));
}

for (const p of sheets.filter(p => p.id.includes(filter))){
  const holes = p.sheets.reduce((n, s) => n + (JSON.stringify(s.blocks || []).match(/\{\{[a-z0-9-]+\|/g) || []).length, 0);
  report(`sheets/${p.id} — ${p.sheets.length} sheet(s), ${holes} holes`,
    validateSheets(p, "sheets/" + p.id, courses.find(c => c.id === p.id)));
}

console.log(problems ? `\n  ${problems} problem(s).\n` : `\n  All good.\n`);
process.exit(problems ? 1 : 0);
