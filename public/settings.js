/* Settings tab.
 *
 * Every change is saved straight away to settings.json in your data folder,
 * so it's the same on every device. Appearance applies live; changes to what's
 * studied (courses, modules, limits) rebuild the round.
 *
 * To add a setting: give it a default in lib/config.js (DEFAULTS) and a row
 * in SECTIONS below. That's all — saving and loading are generic.
 */

"use strict";

(function(){

  var P = window.P, $ = P.$, esc = P.esc;
  var info = null;       // /api/settings: paths, courses on disk, what's running
  var saveTimer = null, restartNeeded = false;

  /* ------------------------------------------------------------- helpers */

  function get(path){
    return path.split(".").reduce(function(o, k){ return o == null ? o : o[k]; }, P.settings);
  }
  function set(path, value){
    var keys = path.split("."), o = P.settings;
    keys.slice(0, -1).forEach(function(k){ o = o[k] = o[k] || {}; });
    o[keys[keys.length - 1]] = value;
  }

  /* What a change affects, by the first key of its path. */
  function after(path){
    var top = path.split(".")[0];
    if (top === "appearance") P.applyAppearance(P.settings.appearance);
    if (top === "showTour"){ if (window.Sheets) window.Sheets.reset(); return "reload"; }
    if (top === "hiddenCourses" || top === "modules" || top === "study" || top === "open"){
      if (window.Sheets) window.Sheets.reset();
      return "refilter";
    }
  }

  var followUp = null;
  function change(path, value){
    set(path, value);
    var f = after(path);
    if (f === "reload" || !followUp) followUp = f || followUp;
    save();
  }

  function save(){
    clearTimeout(saveTimer);
    P.status("saving…");
    saveTimer = setTimeout(function(){
      var f = followUp; followUp = null;
      P.post("/api/settings", { settings: P.settings })
        .then(function(r){
          P.status("settings saved");
          restartNeeded = r.restart;
          renderRestart();
          if (f === "reload") return window.Study.reload().then(fetchInfo);
          if (f === "refilter") window.Study.refilter();
        })
        .catch(function(){ P.status("couldn’t save settings"); });
    }, 350);
  }

  function fetchInfo(){
    return fetch("/api/settings").then(function(r){ return r.json(); })
      .then(function(d){ info = d; render(); });
  }

  /* ------------------------------------------------------------ controls */

  function seg(path, choices){
    var v = get(path);
    return '<span class="seg">' + choices.map(function(c){
      return '<button class="toggle'+(String(v) === String(c[0]) ? " on" : "")+'" data-set="'+path+'" data-val="'+esc(c[0])+'">'+esc(c[1])+'</button>';
    }).join("") + '</span>';
  }

  function sw(path){
    var on = !!get(path);
    return '<button class="switch'+(on ? " on" : "")+'" role="switch" aria-checked="'+on+'" data-flip="'+path+'"><i></i></button>';
  }

  function sel(path, choices){
    var v = get(path);
    return '<select data-sel="'+path+'">' + choices.map(function(c){
      return '<option value="'+esc(c[0])+'"'+(String(v) === String(c[0]) ? " selected" : "")+'>'+esc(c[1])+'</option>';
    }).join("") + '</select>';
  }

  function txt(path, attrs){
    return '<input type="text" data-txt="'+path+'" value="'+esc(get(path))+'" '+(attrs || "")+'>';
  }

  var SWATCHES = ["#ffd60a", "#ff8a3d", "#ff5ca8", "#8b5cf6", "#3b82f6", "#14b8a6", "#22c55e"];

  function accent(){
    var v = String(get("appearance.accent")).toLowerCase();
    return '<span class="swatches">'
      + SWATCHES.map(function(c){
          return '<button class="swatch'+(v === c ? " on" : "")+'" style="background:'+c+'" data-set="appearance.accent" data-val="'+c+'" aria-label="Accent '+c+'"></button>';
        }).join("")
      + '<label class="swatch custom'+(SWATCHES.indexOf(v) < 0 ? " on" : "")+'" title="Any colour">'
      +   '<input type="color" data-color="appearance.accent" value="'+esc(v)+'"><span>+</span></label>'
      + '</span>';
  }

  function row(label, hint, control, extraCls){
    return '<div class="set-row'+(extraCls ? " " + extraCls : "")+'">'
      + '<div class="set-l"><b>'+label+'</b>'+(hint ? '<span>'+hint+'</span>' : "")+'</div>'
      + '<div class="set-c">'+control+'</div></div>';
  }

  function section(title, sub, body){
    return '<div class="panel set-sec"><h2 class="set-h">'+title+'</h2>'
      + (sub ? '<p class="tiny muted set-sub">'+sub+'</p>' : "") + body + '</div>';
  }

  /* ------------------------------------------------------------- sections */

  function appearance(){
    return section("Appearance", "Applies as you click.",
        row("Theme", "", seg("appearance.theme", [["light","Light"],["dark","Dark"],["system","Like my system"]]))
      + row("Accent", "Marks what’s yours: your pick, what’s due, the suggested grade.", accent())
      + row("Corners", "", seg("appearance.corners", [["square","Square"],["rounded","Rounded"]]))
      + row("Font", "", seg("appearance.font", [["system","Sans"],["serif","Serif"],["mono","Mono"]]))
      + row("Text size", "", seg("appearance.size", [[14,"Small"],[16,"Medium"],[18,"Large"],[20,"Extra large"]]))
    );
  }

  function study(){
    return section("Study", "",
        row("Questions per round", "", sel("study.sessionSize", [[10,"10"],[15,"15"],[20,"20"],[30,"30"],[50,"50"]]))
      + row("New questions per day", "Reviews are never limited, only questions you’ve never seen. Keeps a big new course from burying you.",
            sel("study.newPerDay", [[5,"5"],[10,"10"],[20,"20"],[30,"30"],[50,"50"],[0,"No limit"]]))
      + row("Recall first", "Show the question alone; say whether you can recall it before seeing options. Harder, and it sticks better.", sw("study.recallFirst"))
      + row("Mix courses", "Alternate courses within a round. Switching context is a desirable difficulty.", sw("study.interleave"))
    );
  }

  function features(){
    var open = get("modules.open"), ollama = get("open.grader") === "ollama";
    return section("Features", "Each one can be switched off. Nothing here needs installing, except a local model if you want open questions graded for you.",
        row("Cheat sheets", "Topic summaries with hidden facts you reveal one by one.", sw("modules.sheets"))
      + row("Listen buttons", "Questions with <code>say</code> get a ▶ button. Uses your browser’s voices.", sw("modules.audio"))
      + (get("modules.audio") ? row("Voice speed", "", seg("audio.rate", [[0.8,"Slower"],[1,"Normal"],[1.2,"Faster"]]), "sub") : "")
      + row("Diagrams", "Questions and sheets can include Mermaid diagrams. Loads Mermaid from a CDN the first time.", sw("modules.diagrams"))
      + row("Open questions", "Write your answer in your own words; it’s checked against a rubric.", sw("modules.open"))
      + (open ? row("Who grades them", ollama
            ? "A local model through <a href=\"https://ollama.com\" target=\"_blank\" rel=\"noreferrer\">Ollama</a>. It marks each rubric point and quotes where you said it; you can overrule it."
            : "You tick the rubric points you covered. No setup.",
          seg("open.grader", [["self","Me"],["ollama","Local model (Ollama)"]]), "sub") : "")
      + (open && ollama ? row("Model", "Pull it first: <code>ollama pull "+esc(get("open.model"))+"</code>", txt("open.model", 'spellcheck="false"'), "sub")
          + row("Ollama address", "", txt("open.host", 'spellcheck="false"'), "sub")
          + row("", "", '<button id="test-ollama">Test it</button> <span class="tiny muted" id="ollama-res"></span>', "sub") : "")
    );
  }

  function coursesSec(){
    if (!info) return section("Courses", "", '<p class="empty">Loading…</p>');
    var hidden = P.settings.hiddenCourses;
    var list = info.courses.map(function(c){
      var shown = hidden.indexOf(c.id) < 0;
      return '<div class="course-row'+(shown ? "" : " off")+'">'
        + '<div class="set-l"><b>'+esc(c.title)+'</b>'
        +   '<span>'+c.questions+' questions'
        +     (c.source === "example" ? ' · example' : '')
        +     (c.problems ? ' · <em class="warn-t">'+c.problems+' problem'+(c.problems === 1 ? "" : "s")+' (run node check.js)</em>' : '')
        +   '</span></div>'
        + '<div class="set-c">'
        +   '<button class="link" data-reset="'+esc(c.id)+'">Reset progress</button>'
        +   '<button class="switch'+(shown ? " on" : "")+'" role="switch" aria-checked="'+shown+'" data-course="'+esc(c.id)+'" title="Show in Study"><i></i></button>'
        + '</div></div>';
    }).join("");
    return section("Courses", "Switch a course off to hide it from Study without deleting anything.",
        (list || '<p class="empty">No courses. Ask Claude to make one.</p>')
      + row("Show the tour course", "The example that comes with Preguntón. A course of yours with id <code>tour</code> replaces it.", sw("showTour"))
    );
  }

  var PROMPTS = [
    ["New course", "Make me a Preguntón course about <topic>: about 20 questions over 4-5 topics, plus a cheat sheet for the hardest topic."],
    ["From your notes", "Turn my notes in <folder> into a Preguntón course. Only use what's in the notes."],
    ["From a codebase", "Read the repo at <path> and make a Preguntón course that teaches a new teammate how it works: architecture, main flows, gotchas."],
    ["Make it harder", "My course <id> feels too easy. Rewrite the distractors so they're plausible misconceptions, and add open questions where it makes sense."],
    ["Add images", "Add an image or a Mermaid diagram to the questions of course <id> where a picture would make the idea click."],
    ["New feature", "Add a feature to Preguntón: <idea>. Read CLAUDE.md first and keep the code style."]
  ];

  function claudeSec(){
    return section("Ask Claude", "Open Claude Code in the Preguntón repo (the folder with server.js) and ask in plain words. Some ideas to copy and adapt:",
      '<div class="prompts">' + PROMPTS.map(function(p, i){
        return '<div class="prompt-row"><div><b>'+esc(p[0])+'</b><span>'+esc(p[1])+'</span></div>'
          + '<button class="ghost tiny" data-prompt="'+i+'">Copy</button></div>';
      }).join("") + '</div>');
  }

  function systemSec(){
    if (!info) return "";
    var lanNow = info.running.lan;
    return section("Data and server", "",
        row("Data folder", "Courses, sheets, images, progress and these settings. Back it up, sync it, or keep it in your notes vault.",
            '<code class="path">'+esc(info.dataDir)+'</code> <button class="ghost tiny" data-copytext="'+esc(info.dataDir)+'">Copy</button>')
      + row("Progress", "A copy of every card’s history, as JSON.", '<a class="btn" href="/api/export">Export</a>')
      + row("Study from your phone", "Also listen on your Wi-Fi network. There’s no password: anyone on the same network can open it."
            + (lanNow && info.running.url ? ' Open <code>'+esc(info.running.url)+'</code> on your phone.' : ""), sw("lan"))
      + row("Port", "", '<input type="number" min="1024" max="65535" data-num="port" value="'+esc(get("port"))+'">')
      + '<div id="restart"></div>'
    );
  }

  function renderRestart(){
    var el = $("restart");
    if (el) el.innerHTML = restartNeeded
      ? '<div class="callout warn">Restart the server to apply the port or network change: stop it (Ctrl+C in its window) and start it again.</div>'
      : "";
  }

  /* ---------------------------------------------------------------- render */

  function render(){
    $("settings").innerHTML = appearance() + study() + features() + coursesSec() + claudeSec() + systemSec()
      + '<p class="tiny muted" style="text-align:center">Everything here is saved in <code>settings.json</code> in your data folder.</p>';
    renderRestart();
    wire();
  }

  function wire(){
    var root = $("settings");
    root.querySelectorAll("[data-set]").forEach(function(b){
      b.onclick = function(){
        var cur = get(b.dataset.set), v = b.dataset.val;
        change(b.dataset.set, typeof cur === "number" ? Number(v) : v);
        render();
      };
    });
    root.querySelectorAll("[data-flip]").forEach(function(b){
      b.onclick = function(){ change(b.dataset.flip, !get(b.dataset.flip)); render(); };
    });
    root.querySelectorAll("[data-sel]").forEach(function(s){
      s.onchange = function(){
        var cur = get(s.dataset.sel);
        change(s.dataset.sel, typeof cur === "number" ? Number(s.value) : s.value);
      };
    });
    root.querySelectorAll("[data-txt]").forEach(function(i){
      i.onchange = function(){ change(i.dataset.txt, i.value.trim()); render(); };
    });
    root.querySelectorAll("[data-num]").forEach(function(i){
      i.onchange = function(){
        var n = Math.round(Number(i.value));
        if (n >= 1024 && n <= 65535) change(i.dataset.num, n);
        else { P.toast("Pick a port between 1024 and 65535"); i.value = get(i.dataset.num); }
      };
    });
    root.querySelectorAll("[data-color]").forEach(function(i){
      i.oninput = function(){ set(i.dataset.color, i.value); P.applyAppearance(P.settings.appearance); };
      i.onchange = function(){ change(i.dataset.color, i.value); render(); };
    });
    root.querySelectorAll("[data-course]").forEach(function(b){
      b.onclick = function(){
        var id = b.dataset.course, list = P.settings.hiddenCourses.slice(), at = list.indexOf(id);
        if (at >= 0) list.splice(at, 1); else list.push(id);
        change("hiddenCourses", list);
        render();
      };
    });
    root.querySelectorAll("[data-reset]").forEach(function(b){
      b.onclick = function(){
        var id = b.dataset.reset;
        if (!confirm("Forget all progress for “" + id + "”? Its questions will be new again. This can’t be undone.")) return;
        P.post("/api/reset", { course: id })
          .then(function(r){ P.toast(r.removed + " cards reset"); return window.Study.reload(); });
      };
    });
    root.querySelectorAll("[data-prompt]").forEach(function(b){
      b.onclick = function(){ P.copy(PROMPTS[+b.dataset.prompt][1]); };
    });
    root.querySelectorAll("[data-copytext]").forEach(function(b){
      b.onclick = function(){ P.copy(b.dataset.copytext); };
    });
    var t = $("test-ollama");
    if (t) t.onclick = function(){
      $("ollama-res").textContent = "checking…";
      /* Save first so the server tests what's on screen. */
      P.post("/api/settings", { settings: P.settings })
        .then(function(){ return fetch("/api/grade/status").then(function(r){ return r.json(); }); })
        .then(function(s){
          $("ollama-res").textContent = s.ready ? "✓ ready: " + s.model : "✕ " + (s.reason || "not available");
          window.Study.refilter();
        });
    };
  }

  window.Settings = {
    open: function(){
      if (!P.settings) return;
      render();
      fetchInfo();
    }
  };

})();
