/* Prints one line with what's due today, or nothing if there's nothing.
 *
 *   node due.js           plain line, for a shell prompt or a menu-bar tool
 *   node due.js --hook    JSON for a Claude Code SessionStart hook
 *
 * Made for a Claude Code SessionStart hook (SETUP.md offers to install it),
 * so you get a nudge where you already work. A hook's plain output only goes
 * to Claude; with --hook the line goes in `systemMessage`, which is shown to
 * the person. Hidden courses don't count; new questions count up to the daily
 * limit in Settings.
 */

"use strict";

const { readSettings } = require("./lib/config");
const store = require("./lib/store");

function dayStr(d){
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}

const hook = process.argv.includes("--hook");
function say(line){ console.log(hook ? JSON.stringify({ systemMessage: line }) : line); }

const settings = readSettings();
const today = dayStr(new Date());
let cards;
try { cards = store.readProgress().cards; }
catch(e){
  say("Preguntón: progress.json can't be read, open the app to see why.");
  process.exit(0);
}
const hidden = new Set(settings.hiddenCourses);

let due = 0, fresh = 0;
for (const c of store.readCourses(settings)){
  if (hidden.has(c.id)) continue;
  for (const q of c.questions){
    if (q.type === "open" && !settings.modules.open) continue;
    const card = cards[c.id + "/" + q.id];
    if (!card) fresh++;
    else if (card.due <= today) due++;
  }
}

/* Same rule as the app: new questions already introduced today use up the limit. */
const introduced = Object.values(cards).filter(c => c.firstSeen === today).length;
const limit = settings.study.newPerDay;
const newToday = limit ? Math.max(0, Math.min(fresh, limit - introduced)) : fresh;

if (due || newToday){
  const parts = [];
  if (due) parts.push(`${due} to review`);
  if (newToday) parts.push(`${newToday} new`);
  say(`Preguntón: ${parts.join(", ")} today → http://localhost:${settings.port}`);
}
