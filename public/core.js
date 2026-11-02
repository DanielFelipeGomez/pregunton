/* Shared by every tab: helpers, settings, the SM-2 scheduler, saving progress,
 * images, diagrams and voices.
 *
 * Everything hangs off `window.P`. The tabs (study.js, sheets.js,
 * settings.js) read P.settings and P.cards and call P.schedule() to record an
 * answer. Progress lives on the server, so there's no localStorage here and
 * every device on the network sees the same state.
 */

"use strict";

window.P = (function(){

  var P = {
    settings: null,      // from the server; settings.js changes it
    cards:    {},        // card id -> SM-2 state
    courses:  []         // as they come from the server
  };

  /* --------------------------------------------------------------- helpers */

  P.$ = function(id){ return document.getElementById(id); };

  P.dayStr = function(d){
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0")
         + "-" + String(d.getDate()).padStart(2,"0");
  };
  P.today = function(){ return P.dayStr(new Date()); };
  P.addDays = function(n){ var d = new Date(); d.setDate(d.getDate()+n); return P.dayStr(d); };

  P.esc = function(s){
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  };
  /* `code` and **bold**, applied after escaping. */
  /* `code`, **bold** and *italic*. Code spans are cut out first so an
   * asterisk inside them (`a * b`) stays literal. */
  P.inline = function(s){
    return s.split(/(`[^`]+`)/).map(function(part, i){
      if (i % 2) return "<code>" + part.slice(1, -1) + "</code>";
      return part.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
        .replace(/(^|[^\w*])\*([^*\s](?:[^*]*[^*\s])?)\*(?![\w*])/g, "$1<i>$2</i>");
    }).join("");
  };
  P.md = function(s){ return P.inline(P.esc(s)); };

  P.toast = function(msg){
    var t = P.$("toast");
    t.textContent = msg; t.classList.add("on");
    clearTimeout(P.toast._t);
    P.toast._t = setTimeout(function(){ t.classList.remove("on"); }, 2600);
  };
  P.status = function(txt){ P.$("save-state").textContent = txt; };

  P.on = function(module){ return !!(P.settings && P.settings.modules[module]); };

  P.copy = function(text){
    if (navigator.clipboard && window.isSecureContext){
      return navigator.clipboard.writeText(text).then(function(){ P.toast("Copied"); });
    }
    var ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); P.toast("Copied"); } catch(e){ P.toast("Select it and copy with Cmd+C"); }
    ta.remove();
  };

  P.post = function(url, body){
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  };

  /* ------------------------------------------------------------ appearance */

  /* Colour maths for the accent: the UI needs a light tint (backgrounds of
   * what's selected), a darker bar (progress, underlines) and a readable ink
   * colour on top of the accent itself. */
  function hex(c){
    var m = /^#?([0-9a-f]{6})$/i.exec(c || "");
    if (!m) return [255, 214, 10];
    var n = parseInt(m[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  function rgb(a){ return "rgb(" + a.map(Math.round).join(",") + ")"; }
  function mix(a, b, t){ return a.map(function(v, i){ return v + (b[i] - v) * t; }); }
  function lum(a){
    var c = a.map(function(v){ v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
  }

  var FONTS = {
    system: '-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,Helvetica,Arial,sans-serif',
    serif:  '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif',
    mono:   'ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace'
  };

  var darkQuery = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;

  P.applyAppearance = function(a){
    var root = document.documentElement;
    var dark = a.theme === "dark" || (a.theme === "system" && darkQuery && darkQuery.matches);
    root.dataset.theme = dark ? "dark" : "light";

    var acc = hex(a.accent);
    var base = dark ? [31, 31, 29] : [255, 255, 255];
    root.style.setProperty("--acc", rgb(acc));
    root.style.setProperty("--acc-bg", rgb(mix(acc, base, dark ? 0.78 : 0.75)));
    root.style.setProperty("--acc-bar", rgb(mix(acc, [0, 0, 0], 0.12)));
    root.style.setProperty("--acc-ink", lum(acc) > 0.4 ? "#141414" : "#ffffff");
    root.style.setProperty("--radius", a.corners === "rounded" ? "8px" : "0px");
    root.style.setProperty("--sans", FONTS[a.font] || FONTS.system);
    root.style.setProperty("--zoom", String((Number(a.size) || 16) / 16));
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? "#161615" : "#f6f4ef";
  };
  if (darkQuery) darkQuery.addEventListener("change", function(){
    if (P.settings) P.applyAppearance(P.settings.appearance);
  });

  /* ----------------------------------------------------------------- SM-2 */

  /* Fixed first two intervals (by grade), then interval × ease. Grades:
   * 0 Again · 3 Hard · 4 Good · 5 Easy. */
  var FIRST  = { 3:1, 4:2, 5:4 };
  var SECOND = { 3:3, 4:6, 5:10 };

  P.blank = function(){ return { ease:2.5, interval:0, reps:0, lapses:0, history:[] }; };

  P.nextInterval = function(c, grade){
    if (grade < 3) return 1;
    var reps = (c.reps || 0) + 1;
    if (reps === 1) return FIRST[grade];
    if (reps === 2) return SECOND[grade];
    return Math.max(reps, Math.round((c.interval || 1) * (c.ease || 2.5)));
  };

  /* Records an answer. `extra` goes into the history entry (whether you
   * claimed to recall it, how much of a rubric you covered…). */
  P.schedule = function(id, grade, correct, extra){
    var c = P.cards[id] || Object.assign(P.blank(), { firstSeen: P.today() });
    c.interval = P.nextInterval(c, grade);

    if (grade < 3){
      c.reps = 0;
      c.lapses += 1;
      c.ease = Math.max(1.3, c.ease - 0.2);
    } else {
      c.reps += 1;
      c.ease = Math.max(1.3, c.ease + (0.1 - (5-grade)*(0.08 + (5-grade)*0.02)));
    }

    c.ease = Math.round(c.ease*100)/100;
    c.due = grade < 3 ? P.today() : P.addDays(c.interval);
    c.lastReviewed = P.today();
    c.history = (c.history||[]).concat([Object.assign({ d:P.today(), g:grade, ok:!!correct }, extra)]).slice(-10);

    P.cards[id] = c;
    pending[id] = c;
    queueSave();
  };

  P.isDue = function(c){ return c && c.due <= P.today(); };
  P.isMastered = function(c){ return c && c.interval >= 21; };

  /* New questions already introduced today, to respect the daily limit. */
  P.newToday = function(){
    var t = P.today();
    return Object.keys(P.cards).filter(function(k){ return P.cards[k].firstSeen === t; }).length;
  };

  /* ------------------------------------------------------------- saving */

  var pending = {}, saveTimer = null;

  function queueSave(){
    clearTimeout(saveTimer);
    P.status("saving…");
    saveTimer = setTimeout(flush, 600);
  }

  function flush(){
    if (!Object.keys(pending).length) return;
    var payload = { cards: pending };
    pending = {};
    P.post("/api/progress", payload)
      .then(function(){ P.status("saved"); })
      .catch(function(e){
        Object.assign(pending, payload.cards);   // retried with the next one
        P.status("not saved");
        P.toast(e instanceof TypeError ? "Can’t reach the server: your answers will be saved when it’s back"
                                       : "Not saved: " + e.message);
      });
  }

  window.addEventListener("beforeunload", function(){
    if (!Object.keys(pending).length) return;
    navigator.sendBeacon("/api/progress",
      new Blob([JSON.stringify({ cards: pending })], { type:"application/json" }));
  });

  /* ------------------------------------------------------- images, diagrams */

  /* A path starting with http is used as is; anything else is served from the
   * media/ folder of your data (or of the tour). Relative URLs on purpose, so
   * the app also works behind a proxy under a sub-path. */
  P.mediaURL = function(src){
    return /^https?:\/\//.test(src) ? src : "media/" + String(src).replace(/^\/+/, "");
  };

  P.figure = function(src, caption){
    if (!src) return "";
    var url = P.mediaURL(src);
    return '<figure class="qfig">'
      /* Capped in height inside the card so options stay on screen; a click
       * opens it full size. */
      + '<a href="'+P.esc(url)+'" target="_blank" rel="noreferrer">'
      +   '<img class="qimg" loading="lazy" src="'+P.esc(url)+'" alt="'+P.esc(caption || "")+'">'
      + '</a>'
      + (caption ? '<figcaption>'+P.md(caption)+'</figcaption>' : "")
      + '</figure>';
  };

  /* Mermaid is the only thing loaded from outside, and only the first time a
   * diagram is on screen. With the Diagrams module off, diagrams aren't shown. */
  var MERMAID = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js";
  var mermaidReady = null, diagramSeq = 0;

  P.diagram = function(src){
    if (!src || !P.on("diagrams")) return "";
    return '<div class="mmd" data-src="'+P.esc(src)+'"><span class="tiny muted">drawing diagram…</span></div>';
  };

  function loadMermaid(){
    if (!mermaidReady) mermaidReady = new Promise(function(ok, ko){
      var s = document.createElement("script");
      s.src = MERMAID;
      s.onload = function(){ ok(window.mermaid); };
      s.onerror = function(){ mermaidReady = null; ko(new Error("offline")); };
      document.head.appendChild(s);
    });
    return mermaidReady;
  }

  /* Call after putting HTML with P.diagram() on the page. */
  P.renderDiagrams = function(root){
    var nodes = (root || document).querySelectorAll(".mmd[data-src]");
    if (!nodes.length) return;
    loadMermaid().then(function(m){
      var dark = document.documentElement.dataset.theme === "dark";
      m.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", securityLevel: "strict",
                     fontFamily: getComputedStyle(document.body).fontFamily });
      nodes.forEach(function(n){
        var src = n.getAttribute("data-src");
        n.removeAttribute("data-src");
        m.render("mmd-" + (++diagramSeq), src)
          .then(function(r){ n.innerHTML = r.svg; })
          .catch(function(e){ n.innerHTML = '<pre class="tiny">Diagram error: '+P.esc(e.message || e)+'</pre>'; });
      });
    }, function(){
      nodes.forEach(function(n){
        n.innerHTML = '<span class="tiny muted">The diagram needs internet the first time (Mermaid loads from a CDN).</span>';
      });
    });
  };

  /* ---------------------------------------------------------------- voices */

  /* Browser voices: nothing to install, works offline on most systems. Better
   * ("enhanced"/"premium") voices can be downloaded in the OS settings; if one
   * is installed for the language, it wins. */
  function voiceFor(lang){
    var vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    var base = lang.split("-")[0];
    var same = vs.filter(function(v){ return v.lang.replace("_","-") === lang; });
    if (!same.length) same = vs.filter(function(v){ return v.lang.indexOf(base) === 0; });
    return same.filter(function(v){ return /premium|enhanced|natural/i.test(v.name); })[0] || same[0] || null;
  }
  if (window.speechSynthesis) speechSynthesis.getVoices();   // loads them in the background

  P.say = function(text, lang, slow){
    if (!window.speechSynthesis) return P.toast("This browser can't read aloud");
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    var rate = (P.settings && Number(P.settings.audio.rate)) || 1;
    u.lang = lang;
    u.rate = slow ? rate * 0.6 : rate;
    var v = voiceFor(lang);
    if (v) u.voice = v;
    else P.toast("No voice installed for " + lang + ": using the default one");
    speechSynthesis.speak(u);
  };

  return P;
})();
