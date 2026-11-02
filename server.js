/* Preguntón — spaced-repetition quiz server.
 *
 * Plain Node, no dependencies, no npm install. It serves the UI in public/,
 * reads courses and cheat sheets from your data folder, and is the only thing
 * that writes progress.json and settings.json — so progress is the same from
 * any device and the browser needs no file permissions.
 *
 *   node server.js [port]
 */

"use strict";

const http = require("http");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

const { PATHS, DEFAULTS, ensureDataDir, readSettings, writeSettings } = require("./lib/config");
const store  = require("./lib/store");
const grader = require("./lib/grade");
const { validateCourse, validateSheets } = require("./lib/validate");

ensureDataDir();

const settingsAtStart = readSettings();
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || settingsAtStart.port;
const HOST = settingsAtStart.lan ? "0.0.0.0" : "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif":  "image/gif",
  ".mp3":  "audio/mpeg",
  ".m4a":  "audio/mp4",
  ".wav":  "audio/wav"
};

/* -------------------------------------------------------------- helpers */

function json(res, code, body){
  res.writeHead(code, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req, limit){
  return new Promise((ok, ko) => {
    let body = "";
    req.on("data", c => {
      body += c;
      if (body.length > limit){ req.destroy(); ko(new Error("body too large")); }
    });
    req.on("end", () => {
      try { ok(body ? JSON.parse(body) : {}); } catch(e){ ko(new Error("invalid JSON")); }
    });
  });
}

function sendFile(res, file, cache){
  const ext = path.extname(file).toLowerCase();
  fs.readFile(file, (err, buf) => {
    if (err){ res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": cache ? "public, max-age=86400" : "no-store"
    });
    res.end(buf);
  });
}

function serveStatic(res, urlPath){
  const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  const file = path.join(PATHS.public, rel);
  if (!file.startsWith(PATHS.public + path.sep)){ res.writeHead(403); return res.end("forbidden"); }
  sendFile(res, file, false);
}

/* Course files as the browser sees them: without the absolute path on disk,
 * but with where they come from, so Settings can tell yours from the tour. */
function publicCourse(c){
  const out = Object.assign({}, c);
  delete out._file;
  return out;
}

/* --------------------------------------------------------------- routes */

const routes = {
  /* Lets start.command tell this app apart from anything else on the port. */
  "GET /api/ping": (req, res) => json(res, 200, { app: "pregunton", data: PATHS.data }),

  "GET /api/bootstrap": (req, res) => {
    const settings = readSettings();
    const hidden = new Set(settings.hiddenCourses);
    json(res, 200, {
      settings,
      courses:  store.readCourses(settings).map(publicCourse),
      hidden:   [...hidden],
      progress: store.readProgress().cards
    });
  },

  /* Cheat sheets bring their course's topics (same `id`) so they're numbered
   * like the quiz, but not its questions: they don't need them. */
  "GET /api/sheets": (req, res) => {
    const settings = readSettings();
    json(res, 200, {
      packs:    store.readSheets(settings).map(publicCourse),
      courses:  store.readCourses(settings).map(c => ({ id: c.id, title: c.title, topics: c.topics, ordered: c.ordered })),
      progress: store.readProgress().cards
    });
  },

  "POST /api/progress": async (req, res) => {
    const body = await readBody(req, 5e6);
    json(res, 200, Object.assign({ ok: true }, store.mergeProgress(body.cards)));
  },

  "GET /api/settings": (req, res) => {
    const settings = readSettings();
    json(res, 200, {
      settings,
      defaults: DEFAULTS,
      dataDir:  PATHS.data,
      repo:     PATHS.root,
      running:  { port: PORT, lan: HOST === "0.0.0.0", url: lanURL() },
      courses:  store.readCourses(settings).map(c => ({
        id: c.id, title: c.title, source: c._source, file: c._file,
        questions: c.questions.length,
        problems: validateCourse(c, c.id).length
      }))
    });
  },

  "POST /api/settings": async (req, res) => {
    const body = await readBody(req, 1e5);
    const settings = writeSettings(body.settings || {});
    json(res, 200, {
      ok: true, settings,
      /* Compared with the file at startup, not the running port: a port given
       * on the command line isn't a change the user made here. */
      restart: settings.port !== settingsAtStart.port || settings.lan !== settingsAtStart.lan
    });
  },

  "POST /api/reset": async (req, res) => {
    const body = await readBody(req, 1e4);
    if (!body.course) return json(res, 400, { ok: false, error: "which course?" });
    json(res, 200, { ok: true, removed: store.resetCourse(String(body.course)) });
  },

  "GET /api/export": (req, res) => {
    res.writeHead(200, {
      "Content-Type": MIME[".json"],
      "Content-Disposition": `attachment; filename="pregunton-progress-${new Date().toISOString().slice(0,10)}.json"`
    });
    res.end(JSON.stringify(store.readProgress(), null, 2));
  },

  "GET /api/grade/status": async (req, res) => {
    json(res, 200, await grader.status(readSettings().open));
  },

  /* The rubric is looked up here in the course file instead of trusting the
   * browser: what gets graded is always what's written in the file. */
  "POST /api/grade": async (req, res) => {
    const input = await readBody(req, 1e5);
    const settings = readSettings();
    const course = store.readCourses(settings).find(c => c.id === input.course);
    const q = course && course.questions.find(x => x.id === input.id);
    if (!q || q.type !== "open") return json(res, 404, { ok: false, error: "no open question with that id" });
    try {
      json(res, 200, Object.assign({ ok: true }, await grader.grade(q, String(input.answer || ""), settings.open)));
    } catch(e){
      json(res, 502, { ok: false, error: e.message });
    }
  }
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  try {
    const route = routes[req.method + " " + url.pathname];
    if (route) return await route(req, res);
  } catch(e){
    return json(res, 500, { ok: false, error: e.message });
  }

  if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "unknown route" });

  if (url.pathname.startsWith("/media/")){
    const file = store.mediaFile(decodeURIComponent(url.pathname.slice(7)), readSettings());
    if (!file){ res.writeHead(404); return res.end("not found"); }
    return sendFile(res, file, true);
  }

  serveStatic(res, url.pathname);
});

/* ---------------------------------------------------------------- start */

function lanIP(){
  for (const list of Object.values(os.networkInterfaces())){
    for (const ni of list || []){
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return null;
}

function lanURL(){
  const ip = HOST === "0.0.0.0" && lanIP();
  return ip ? `http://${ip}:${PORT}` : null;
}

server.on("error", err => {
  if (err.code === "EADDRINUSE"){
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Preguntón may already be running: open http://localhost:${PORT}`);
    console.error(`  Or start it on another port: node server.js ${PORT + 1}\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  const settings = readSettings();
  const warn = [];
  const courses = store.readCourses(settings, m => warn.push(m));
  const total = courses.reduce((n, c) => n + c.questions.length, 0);

  console.log("\n  Preguntón");
  console.log(`  ${courses.length} course(s), ${total} questions`);
  console.log(`  Data: ${PATHS.data}\n`);

  /* A badly written question is graded wrong silently, so it's flagged at
   * startup instead of waiting for you to find it while studying. */
  const problems = courses.flatMap(c => validateCourse(c, c.id))
    .concat(store.readSheets(settings, m => warn.push(m))
      .flatMap(s => validateSheets(s, "sheets/" + s.id, courses.find(c => c.id === s.id))));
  for (const w of warn) console.log(`  ! ${w}`);
  try { store.readProgress(); }
  catch(e){ console.log(`  ✕ ${e.message}\n`); }
  if (problems.length){
    console.log(`  ⚠ ${problems.length} problem(s) in courses:`);
    for (const p of problems.slice(0, 10)) console.log(`    ${p.file}/${p.path}: ${p.msg}`);
    if (problems.length > 10) console.log(`    …and ${problems.length - 10} more`);
    console.log("    (node check.js lists them all)\n");
  }

  console.log(`  Open:          http://localhost:${PORT}`);
  const lan = lanURL();
  if (lan) console.log(`  Phone/tablet:  ${lan}   (same Wi-Fi, no password)`);
  console.log("\n  Ctrl+C to stop.\n");
});
