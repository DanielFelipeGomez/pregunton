/* Open-question grading with a local model through Ollama. Optional: only used
 * when Settings → Open questions → Grader is "Ollama". Without it you grade
 * yourself against the rubric, which works fine.
 *
 * The model doesn't give a mark. It decides, point by point, whether the answer
 * covers each idea of the rubric, and the mark is computed in the UI, where you
 * can also overrule it. Two reasons: an 8B model is far more reliable answering
 * "is this idea in this text?" than "how much is this worth?", and when it gets
 * a point wrong you flip it with a click instead of arguing with a number.
 *
 * The main defence against a generous grader is the quote: to mark a point as
 * covered it has to copy the fragment of your answer that says it. If the quote
 * isn't in what you wrote, the point doesn't count.
 */

"use strict";

/* The first call loads the model into memory and takes much longer. */
const TIMEOUT_MS = 120000;

const STATES = ["covered", "partial", "missing"];

const SYSTEM = `You grade study answers against a rubric. For each rubric point decide whether the student's answer expresses that idea:
- "covered": the idea is there, even in other words.
- "partial": it's half there, vague, or slightly inaccurate.
- "missing": it isn't there, or only the keyword appears without the idea.

Rules:
- Judge only what is written, never what the student probably knows. Naming the term isn't enough: the idea has to be there.
- For "covered" and "partial", copy into "quote" the LITERAL fragment of the student's answer that shows it, as is, without rewording, at most 25 words. For "missing", "quote" is empty.
- "note": one short sentence about what's missing or wrong, in the language of the question. Empty if the point is covered.
- In "errors" list the claims in the answer that are false (compared with the model answer and standard knowledge). Empty list if there are none.
- Length doesn't matter: a short answer that states the idea covers it.`;

function schema(ids){
  return {
    type: "object",
    properties: {
      points: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id:    { type: "string", enum: ids },
            state: { type: "string", enum: STATES },
            quote: { type: "string" },
            note:  { type: "string" }
          },
          required: ["id", "state", "quote", "note"]
        }
      },
      errors: { type: "array", items: { type: "string" } }
    },
    required: ["points", "errors"]
  };
}

function prompt(q, answer){
  return [
    "QUESTION:\n" + q.q,
    q.code ? "CODE IN THE QUESTION:\n" + q.code : "",
    q.answer ? "MODEL ANSWER (reference; the student hasn't seen it):\n" + q.answer : "",
    "RUBRIC:\n" + q.rubric.map(r => `- [${r.id}] (${r.w === "nice" ? "nice to have" : "must"}) ${r.p}`).join("\n"),
    "STUDENT ANSWER:\n<<<\n" + answer + "\n>>>"
  ].filter(Boolean).join("\n\n");
}

/* Normalise to compare quotes: no accents, no punctuation, single spaces. */
function norm(s){
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/* Is the quote in the answer? Literally, or almost: a small model sometimes
 * changes a word when copying, so most of the words being there is enough. */
function validQuote(quote, answer){
  const c = norm(quote), a = norm(answer);
  if (!c) return false;
  if (a.includes(c)) return true;
  const words = c.split(" ").filter(w => w.length >= 4);
  if (words.length < 2) return false;
  const have = new Set(a.split(" "));
  return words.filter(w => have.has(w)).length / words.length >= 0.75;
}

async function call(host, path, body, timeout){
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(host.replace(/\/+$/, "") + path, body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal }
      : { signal: ctl.signal });
    if (!r.ok) throw new Error(`Ollama answered ${r.status}`);
    return await r.json();
  } catch(e){
    if (e.name === "AbortError") throw new Error("Ollama didn't answer in time");
    if (e.cause && e.cause.code === "ECONNREFUSED") throw new Error("Ollama isn't running");
    throw e;
  } finally { clearTimeout(t); }
}

/* `opts` is settings.open: { grader, model, host }. */
async function status(opts){
  if (opts.grader !== "ollama") return { ready: false, mode: "self" };
  try {
    const tags = await call(opts.host, "/api/tags", null, 3000);
    const has = (tags.models || []).some(m => m.name === opts.model || m.model === opts.model);
    return has ? { ready: true, mode: "ollama", model: opts.model }
               : { ready: false, mode: "ollama", model: opts.model, reason: `model missing: ollama pull ${opts.model}` };
  } catch(e){
    return { ready: false, mode: "ollama", model: opts.model, reason: e.message };
  }
}

async function grade(q, answer, opts){
  const ids = q.rubric.map(r => r.id);
  if (!answer.trim()){
    return { model: null, points: ids.map(id => ({ id, state: "missing", quote: "", note: "" })), errors: [] };
  }

  const out = await call(opts.host, "/api/chat", {
    model: opts.model,
    stream: false,
    think: false,
    format: schema(ids),
    options: { temperature: 0 },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt(q, answer) }
    ]
  }, TIMEOUT_MS);

  let parsed;
  try { parsed = JSON.parse(out.message && out.message.content); }
  catch(e){ throw new Error("the model returned something that isn't JSON"); }

  /* One point per rubric id, in order, whatever the output: if the model
   * skips one, it counts as missing. */
  const byId = {};
  (parsed.points || []).forEach(p => { if (ids.includes(p.id) && !byId[p.id]) byId[p.id] = p; });

  const points = ids.map(id => {
    const p = byId[id] || { state: "missing", quote: "", note: "" };
    let state = STATES.includes(p.state) ? p.state : "missing";
    let note = String(p.note || "");
    const quote = String(p.quote || "");
    if (state !== "missing" && !validQuote(quote, answer)){
      state = "missing";
      note = "The grader accepted it but couldn't point to where you say it. If you did, mark it yourself.";
    }
    return { id, state, quote: state === "missing" ? "" : quote, note: state === "covered" ? "" : note };
  });

  const errors = (parsed.errors || []).map(String).filter(s => s.trim()).slice(0, 5);
  return { model: opts.model, points, errors };
}

module.exports = { grade, status, validQuote };
