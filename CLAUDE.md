# Preguntón

A spaced-repetition quiz app that each person sets up and customises with Claude. This is their copy: change anything they ask for. The goal is that it stays small, readable and easy to change, so the next request is as easy as this one.

- Setting someone up from a fresh clone: follow `SETUP.md`.
- Writing or extending courses and cheat sheets: follow `.claude/skills/new-course/SKILL.md`.

## How it fits together

```
server.js          HTTP server: API + static files. Only writer of progress.json and settings.json.
lib/config.js      Paths (repo vs data folder) and settings with their DEFAULTS.
lib/store.js       Reads courses/sheets (data folder + examples/tour), merges progress, finds media.
lib/validate.js    Lint for courses and sheets (used by server at startup and check.js).
lib/grade.js       Optional Ollama grader for open questions.
check.js           node check.js [filter] — lints everything, exit 1 on problems.
due.js             One line with what's due today (for a Claude Code SessionStart hook).
public/index.html  The page: tabs and sections.
public/core.js     window.P: helpers, appearance, SM-2 scheduler, saving, images, Mermaid, voices.
public/study.js    Study and Progress tabs, and tab switching. window.Study.
public/sheets.js   Cheat sheets tab. window.Sheets.
public/settings.js Settings tab. window.Settings.
public/styles.css  All styles. Colours are CSS variables; dark theme overrides them.
examples/tour/     The example course (courses/, sheets/, media/).
```

The **data folder** is separate from the repo and belongs to the user: `courses/`, `sheets/`, `media/`, `progress.json`, `settings.json`. Its path comes from `PREGUNTON_DATA`, else `dataDir` in `local.json` (gitignored), else `./data`. `node check.js` prints it on its first line, and which features are on on the second.

**Requests:** `GET /api/ping` (is this Preguntón? used by start.command) · `GET /api/bootstrap` (settings, courses, progress) · `GET /api/sheets` · `POST /api/progress` (merge cards, newest review wins) · `GET|POST /api/settings` · `POST /api/reset` · `GET /api/export` · `GET /api/grade/status` · `POST /api/grade` · `/media/<path>` (data folder, then tour).

Files are read on every request: a new or edited course shows up on page reload, no restart. Only `port` and `lan` need a restart (if it runs from launchd: `launchctl kickstart -k gui/$(id -u)/com.pregunton.server`).

## Progress

`progress.json` maps card ids to SM-2 state. Question cards are `<course>/<question id>`, cheat-sheet holes are `sheet:<course>/<topic>/<hole id>`.

```jsonc
"tour/good-keeps-ease": {
  "ease": 2.5, "interval": 6, "reps": 2, "lapses": 1,
  "due": "2026-11-08", "lastReviewed": "2026-11-02", "firstSeen": "2026-10-27",
  "history": [{ "d": "2026-11-02", "g": 4, "ok": true, "r": "y" }]   // last 10; r = recall claim, cov = rubric coverage
}
```

Grades: 0 Again · 3 Hard · 4 Good · 5 Easy. Mastered = interval ≥ 21 days. The scheduler is `P.schedule` / `P.nextInterval` in `core.js`; the tour course has questions about its exact numbers (`examples/tour`, topic `how-sm2`), so update them if you change it.

## Conventions

- **No dependencies, no build step.** Plain Node (18+) on the server, plain browser JS in `public/`. If a feature seems to need a library, prefer a small hand-written version; if it really needs one in the browser, load it lazily from a CDN with a pinned version, like Mermaid in `core.js`, and make it optional.
- **Front-end style:** each file is an IIFE with `"use strict"`, `var` and `function`, string-built HTML through `P.esc` / `P.md`, re-rendering a whole section on each change and re-wiring its handlers. Match that rather than introducing a framework.
- **Comments say why**, not what, in full sentences above the code they explain. Keep that density.
- **Everything user-facing is in English**, short and plain.
- **Colour has meaning:** the accent marks what's the user's (selection, due, suggested); green/red are right/wrong and always come with ✓/✕ and a bar, never colour alone; orange is partial. Use the CSS variables, and check new UI in both light and dark themes and at 375px wide.
- Never change question or hole ids in someone's course: it wipes their progress for that card.
- The data folder is the user's: only touch it when they ask (courses, sheets, media), never delete files in it, and never edit `progress.json` by hand (there's `/api/reset` for a course). The server backs progress up once a day to `backups/` (last 14 kept) and before every reset, and refuses to write over a `progress.json` or `settings.json` it can't parse. Keep those guarantees if you touch `lib/store.js` or `lib/config.js`.

## Recipes

**A new setting.** Add it with its default to `DEFAULTS` in `lib/config.js` (only keys present there are saved), add a row in `public/settings.js` using `row()` with `seg`, `sw`, `sel` or `txt`, and read it from `P.settings`. If it changes what's studied, make `after()` in settings.js return `"refilter"`.

**A new question field** (say, a hint). Render it in `renderCard()` in `study.js`, validate it in `validateCourse()` in `lib/validate.js`, document it in the format section of the new-course skill, and add an example to the tour if it's worth showing off.

**A new optional feature.** Add a flag under `modules` in `DEFAULTS`, a switch in the Features section of settings.js, and check it with `P.on("name")` wherever it shows up.

**A new tab.** A `<button class="tab" data-view="x">` and a `<section id="view-x" hidden>` in index.html, a `public/x.js` exposing `window.X = { open }`, and a line in `show()` in study.js.

## Checking a change

1. `node check.js` — must say "All good".
2. `node --check` on any JS file you touched.
3. Run `node server.js` (or reuse the running one), open http://localhost:4700 and try the change, in light and dark, and narrow. Nothing is "done" until you've seen it work in the page.
