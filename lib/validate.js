/* Course and cheat-sheet linting.
 *
 * The server prints these as warnings at startup and `node check.js` lists
 * them all. Most of what's checked here breaks silently otherwise: a repeated
 * id makes two questions share progress, a `{{` without its bar renders as
 * literal braces, a correct answer that is always the longest option turns the
 * quiz into a test of spotting long text.
 */

"use strict";

/* ------------------------------------------------------------ length tells
 *
 * The most common way a question gives itself away is length: the truth tends
 * to come with its nuance ("regional, but it never leaves the region") and the
 * lie is written in one go. When that happens in nine out of ten questions the
 * quiz measures your nose for long text, not what you know. The nuance goes in
 * `why`; in `t` all options should weigh the same.
 */

/* 15% longer than the longest distractor already shows when four are stacked. */
const TELL_RATIO = 1.15;
/* Below this, options are names ("ClusterIP", "gp3") and length says nothing. */
const TELL_MIN = 30;
/* In a healthy course the correct one is the longest about one time in n.
 * Above this it's a learnable pattern, either way: always making it the
 * shortest is a tell too. */
const TELL_SHARE = 0.40;

const POSITIONAL = /\b(all of the above|none of the above|both of the above|a and b|the ones above)\b/i;

function len(o){ return String(o.t || "").length; }

/* Returns a warning if length gives the answer away, or null. With several
 * correct options it compares means: what gets learnt is "long ones are right". */
function lengthTell(options){
  const ok = options.filter(o => o.ok), no = options.filter(o => !o.ok);
  if (!ok.length || !no.length) return null;
  const all = options.map(len);
  if (Math.max(...all) < TELL_MIN) return null;

  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const okLen = ok.length > 1 ? mean(ok.map(len)) : len(ok[0]);
  const noRef = ok.length > 1 ? mean(no.map(len)) : Math.max(...no.map(len));
  if (okLen <= noRef * TELL_RATIO) return null;

  return `length gives the answer away (${Math.round(okLen)} chars vs ${Math.round(noRef)} `
       + `for the ${ok.length > 1 ? "average" : "longest"} distractor) — move the nuance to \`why\` or flesh out the distractors`;
}

/* How often the correct option is the longest / the shortest, over
 * single-answer questions. Used by the lint and printed by check.js. */
function lengthStats(questions){
  let n = 0, longest = 0, shortest = 0;
  for (const q of questions){
    if (q.multi || !Array.isArray(q.options) || q.options.length < 2) continue;
    const ok = q.options.find(o => o.ok);
    const no = q.options.filter(o => !o.ok);
    if (!ok || !no.length) continue;
    const l = len(ok), ls = no.map(len);
    /* Short options (commands, names) carry no length signal: don't count them. */
    if (Math.max(l, ...ls) < TELL_MIN) continue;
    n++;
    if (l > Math.max(...ls)) longest++;
    if (l < Math.min(...ls)) shortest++;
  }
  return { n, longest: n ? longest / n : 0, shortest: n ? shortest / n : 0 };
}

/* ----------------------------------------------------------------- courses */

const WEIGHTS = new Set(["must", "nice"]);

function validateCourse(course, file){
  const P = [];
  const add = (path, msg) => P.push({ file, path, msg });

  if (!course.id)    add("", "missing `id`");
  if (!course.title) add("", "missing `title`");
  if (!Array.isArray(course.questions)) { add("", "`questions` is not a list"); return P; }

  const topics = new Set((course.topics || []).map(t => t.id));
  const seen = new Set();

  course.questions.forEach((q, i) => {
    const at = q.id || `questions[${i}]`;

    if (!q.id) add(at, "missing `id`");
    else if (seen.has(q.id)) add(at, "repeated `id`: both questions would share progress");
    else seen.add(q.id);

    if (!q.q) add(at, "missing the question text `q`");
    if (!topics.has(q.topic)) add(at, `topic \`${q.topic}\` is not in \`topics\``);

    /* Without a language there's no voice to read it with, and no button. */
    if (q.say && !(q.speak || course.speak)) add(at, "has `say` but neither the question nor the course sets `speak` (e.g. \"de-DE\")");
    if (q.sayFirst && !q.say) add(at, "`sayFirst` without `say`: nothing to listen to");

    if (q.type === "open") return checkOpen(q, at, add);

    if (!Array.isArray(q.options) || q.options.length < 2)
      return add(at, "`options`: needs at least two");

    const ok = q.options.filter(o => o.ok).length;
    if (ok === 0) add(at, "no option is marked correct");
    if (ok > 1 && !q.multi) add(at, "more than one correct option without `multi: true`: the UI would only let you pick one");

    q.options.forEach((o, j) => {
      if (!o.t)   add(at, `options[${j}]: missing the text \`t\``);
      if (!o.why) add(at, `options[${j}] (${(o.t||"").slice(0,40)}…): missing \`why\``);
      if (POSITIONAL.test(o.t || ""))
        add(at, `options[${j}]: refers to other options by position, but the UI shuffles them`);
    });

    const tell = lengthTell(q.options);
    if (tell) add(at, tell);
  });

  const s = lengthStats(course.questions);
  if (s.n >= 8){
    const pct = x => Math.round(x * 100) + "%";
    if (s.longest > TELL_SHARE)
      add("", `the correct option is the longest in ${pct(s.longest)} of questions (around 25% is expected)`);
    if (s.shortest > TELL_SHARE)
      add("", `the correct option is the shortest in ${pct(s.shortest)} of questions: over-correcting is a tell too`);
  }

  return P;
}

/* An open question is graded against its rubric: the points a good answer has
 * to touch. `must` points can't be missing; `nice` ones add up but their
 * absence doesn't fail the answer. */
function checkOpen(q, at, add){
  if (q.options) add(at, "an `open` question has no `options`");
  if (!Array.isArray(q.rubric) || q.rubric.length < 2)
    return add(at, "`rubric`: needs at least two points");

  const ids = new Set();
  q.rubric.forEach((r, j) => {
    const rp = `rubric[${j}]`;
    if (!r.id) add(at, `${rp}: missing \`id\``);
    else if (ids.has(r.id)) add(at, `${rp}: repeated \`id\``);
    else ids.add(r.id);
    if (!r.p) add(at, `${rp}: missing the point \`p\``);
    if (!WEIGHTS.has(r.w || "must")) add(at, `${rp}: \`w\` is "must" or "nice"`);
  });
  if (!q.rubric.some(r => (r.w || "must") === "must"))
    add(at, "`rubric`: no point is `must`, so any answer passes");
}

/* ------------------------------------------------------------ cheat sheets
 *
 * What breaks silently here is progress: a repeated hole id makes two holes
 * share a card, and a malformed one (no bar) renders as text with braces
 * instead of being hidden. The topic must exist in the course with the same
 * `id`, which is where its number and name come from.
 */
const BLOCKS = ["h", "p", "list", "code", "note", "table", "img", "diagram"];
const NOTE_KINDS = new Set(["tip", "trap", "why", "fun", "new", "howto"]);
const HOLE = /\{\{([a-z0-9-]+)\|([^}]+)\}\}/g;

function validateSheets(pack, file, course){
  const P = [];
  const add = (path, msg) => P.push({ file, path, msg });

  if (!pack.id) add("", "missing `id` (the id of the course these sheets belong to)");
  if (!Array.isArray(pack.sheets)) { add("", "`sheets` is not a list"); return P; }
  if (!course) add("", `there is no course with id \`${pack.id}\``);

  const topics = new Set(((course && course.topics) || []).map(t => t.id));
  const seen = new Set();

  pack.sheets.forEach((sh, i) => {
    const at = sh.topic || `sheets[${i}]`;
    if (!sh.topic) add(at, "missing `topic`");
    else if (seen.has(sh.topic)) add(at, "two sheets for the same topic");
    else seen.add(sh.topic);
    if (course && sh.topic && !topics.has(sh.topic)) add(at, `topic \`${sh.topic}\` is not in the course`);
    if (!Array.isArray(sh.blocks) || !sh.blocks.length) return add(at, "`blocks` is empty");

    const holes = new Set();
    sh.blocks.forEach((b, j) => {
      const type = BLOCKS.find(k => k in b);
      if (!type) return add(at, `blocks[${j}]: unknown block type (${Object.keys(b).join(", ")})`);
      if (type === "note" && !NOTE_KINDS.has(b.kind)) add(at, `blocks[${j}]: unknown note \`kind\`: ${b.kind} (use ${[...NOTE_KINDS].join(", ")})`);
      if (type === "table" && (!b.table || !Array.isArray(b.table.rows))) add(at, `blocks[${j}]: the table has no \`rows\``);

      const txt = JSON.stringify(b);
      let m, n = 0;
      HOLE.lastIndex = 0;
      while ((m = HOLE.exec(txt))){
        n++;
        if (holes.has(m[1])) add(at, `hole \`${m[1]}\` repeated: they would share progress`);
        holes.add(m[1]);
        if (!m[2].trim()) add(at, `hole \`${m[1]}\` is empty`);
      }
      if ((txt.match(/\{\{/g) || []).length !== n)
        add(at, `blocks[${j}]: there's a \`{{\` that isn't a well-formed hole ({{id|answer}})`);
    });
    if (!holes.size) add(at, "has no holes");
  });

  return P;
}

module.exports = { validateCourse, validateSheets, lengthStats };
