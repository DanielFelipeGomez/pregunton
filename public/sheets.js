/* Cheat sheets.
 *
 * A cheat sheet is a topic summary with the facts that matter hidden. You read
 * it through, try to say what's under each hole, reveal it and say whether you
 * knew it. Each hole is its own card, so the sheet clears up over time: only
 * new holes and the ones due today come covered, and what you've mastered
 * reads as normal text.
 *
 * It goes with the topics of the course with the same `id`: sheet 5 is topic
 * 5 of the quiz, and at the end a button takes you to its questions.
 *
 * Hole ids are prefixed "sheet:" so they never clash with question ids.
 */

"use strict";

(function(){

  var P = window.P, $ = P.$, esc = P.esc;

  var packs = [], courses = {}, loaded = false;
  var current = null;    // { pack, sheet, course, num, label }
  var mode = "practice"; // practice · all · read
  var revealed = {};     // holeId -> "rev" (not answered) · "yes" · "no"
  var asking = null;     // revealed hole waiting for "I knew it / no"

  var HOLE = /\{\{([a-z0-9-]+)\|([^}]+)\}\}/g;

  function holesOf(sheet){
    var out = [];
    JSON.stringify(sheet.blocks).replace(HOLE, function(_, id){ out.push(id); return ""; });
    return out;
  }

  function gidOf(pack, sheet, holeId){ return "sheet:" + pack.id + "/" + sheet.topic + "/" + holeId; }

  /* Only two answers: "I knew it" counts as Good, "no" comes back tomorrow —
   * you've already seen it uncovered today. */
  function answerHole(gid, ok){
    P.schedule(gid, ok ? 4 : 0, ok);
    if (!ok) P.cards[gid].due = P.addDays(1);
  }

  function holeState(gid){
    var c = P.cards[gid];
    if (!c) return "new";
    return c.due <= P.today() ? "due" : "ok";
  }

  /* ---------------------------------------------------------------- list */

  function open(){
    if (loaded) return current ? renderSheet() : renderList();
    $("sheets").innerHTML = '<div class="panel"><p class="empty">Loading cheat sheets…</p></div>';
    fetch("/api/sheets")
      .then(function(r){ if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function(data){
        packs = (data.packs || []).filter(function(p){ return P.settings.hiddenCourses.indexOf(p.id) < 0; });
        (data.courses || []).forEach(function(c){ courses[c.id] = c; });
        loaded = true;
        renderList();
      })
      .catch(function(){
        $("sheets").innerHTML = '<div class="panel"><p class="empty">Couldn’t load the cheat sheets.</p></div>';
      });
  }

  /* Topic number and name come from the course, so a sheet can't drift from
   * the quiz if topics are reordered. */
  function topicInfo(pack, sheet){
    var c = courses[pack.id], topics = (c && c.topics) || [];
    for (var i = 0; i < topics.length; i++){
      if (topics[i].id === sheet.topic)
        return { num: c.ordered ? i + 1 : null, label: topics[i].label, course: c };
    }
    return { num: null, label: sheet.topic, course: c };
  }

  function counts(pack, sheet){
    var n = { "new":0, due:0, ok:0, total:0 };
    holesOf(sheet).forEach(function(h){ n[holeState(gidOf(pack, sheet, h))]++; n.total++; });
    return n;
  }

  function renderList(){
    current = null; asking = null;
    renderAsk();

    if (!packs.length){
      $("sheets").innerHTML = '<div class="panel"><p class="empty">'
        + 'No cheat sheets yet. Ask Claude: <i>“make a cheat sheet for topic … of my course …”</i>.</p></div>';
      return;
    }

    var html = "";
    packs.forEach(function(pack){
      var course = courses[pack.id];
      var sheets = pack.sheets.slice().sort(function(a, b){
        return (topicInfo(pack, a).num || 0) - (topicInfo(pack, b).num || 0);
      });
      html += '<div class="panel">'
        + '<div class="between"><strong>'+esc(course ? course.title : pack.id)+'</strong>'
        + '<span class="tiny muted">'+sheets.length+' sheet'+(sheets.length === 1 ? "" : "s")+'</span></div>'
        + (pack.subtitle ? '<p class="tiny muted" style="margin:6px 0 0">'+P.md(pack.subtitle)+'</p>' : "")
        + '<div class="card-list">';

      sheets.forEach(function(sheet){
        var ti = topicInfo(pack, sheet), n = counts(pack, sheet);
        var todo = n["new"] + n.due;
        var pill = !n.ok && !n.due ? { cls:"", txt:"not started" }
                 : todo ? { cls:"due", txt: todo + " for today" }
                 : { cls:"ok", txt:"up to date" };
        var pm = Math.round(n.ok / n.total * 100);
        html += '<button class="list-card" data-pack="'+esc(pack.id)+'" data-topic="'+esc(sheet.topic)+'">'
          + '<span class="list-top">'
          +   '<span class="list-title">'+(ti.num ? ti.num + ". " : "")+esc(ti.label)+'</span>'
          +   '<span class="pill '+pill.cls+'">'+esc(pill.txt)+'</span>'
          + '</span>'
          + (sheet.summary ? '<span class="list-sub">'+P.md(sheet.summary)+'</span>' : "")
          + '<span class="sh-meter"><i style="width:'+pm+'%"></i></span>'
          + '<span class="list-meta">'+n.total+' holes · '+n.ok+' mastered'
          +   (n.due ? ' · '+n.due+' to review' : "")
          +   (n["new"] && (n.ok || n.due) ? ' · '+n["new"]+' not seen' : "")
          + '</span>'
          + '</button>';
      });

      html += '</div></div>';
    });

    $("sheets").innerHTML = html;
    $("sheets").querySelectorAll(".list-card").forEach(function(b){
      b.onclick = function(){
        var pack = packs.filter(function(p){ return p.id === b.dataset.pack; })[0];
        var sheet = pack.sheets.filter(function(s){ return s.topic === b.dataset.topic; })[0];
        openSheet(pack, sheet);
      };
    });
  }

  /* --------------------------------------------------------------- sheet */

  function openSheet(pack, sheet){
    var ti = topicInfo(pack, sheet);
    current = { pack:pack, sheet:sheet, course:ti.course, num:ti.num, label:ti.label };
    revealed = {}; asking = null;
    /* With nothing left to review, practice would cover nothing: it opens
     * fully covered, which is what you want when you come in on purpose. */
    var n = counts(pack, sheet);
    mode = n["new"] + n.due ? "practice" : "all";
    renderSheet();
    window.scrollTo(0, 0);
  }

  function covered(holeId){
    if (revealed[holeId] || mode === "read") return false;
    if (mode === "all") return true;
    return holeState(gidOf(current.pack, current.sheet, holeId)) !== "ok";
  }

  /* A covered hole is drawn with its text inside but invisible: it takes the
   * same room covered and uncovered, so the paragraph doesn't jump. */
  function text(s){
    var out = "", last = 0, m;
    HOLE.lastIndex = 0;
    while ((m = HOLE.exec(s))){
      out += P.inline(esc(s.slice(last, m.index)));
      var id = m[1], st = revealed[id];
      var cls = covered(id) ? "hole cov"
              : st === "yes" ? "hole yes" : st === "no" ? "hole no"
              : st === "rev" ? "hole rev" : "hole";
      out += '<span class="'+cls+'" data-h="'+esc(id)+'"'+(cls === "hole" ? "" : ' role="button" tabindex="0"')+'>'
           + P.inline(esc(m[2])) + '</span>';
      last = m.index + m[0].length;
    }
    return out + P.inline(esc(s.slice(last)));
  }

  var NOTE = {
    tip:   "Tip",
    trap:  "Common trap",
    why:   "Why it works",
    fun:   "Fun fact",
    "new": "What’s new",
    howto: "How to"
  };

  function block(b){
    if (b.h)    return '<h3 class="sh-h">'+text(b.h)+'</h3>';
    if (b.p)    return '<p class="sh-p">'+text(b.p)+'</p>';
    if (b.list) return '<ul class="sh-list">'+b.list.map(function(li){ return '<li>'+text(li)+'</li>'; }).join("")+'</ul>';
    if (b.code) return '<pre class="sh-code"><code>'+text(b.code)+'</code></pre>';
    if (b.img)  return P.figure(b.img, b.caption);
    if (b.diagram) return P.diagram(b.diagram);
    if (b.note) return '<div class="sh-note '+esc(b.kind || "")+'">'
      + '<span class="sh-note-k">'+esc(NOTE[b.kind] || b.kind || "Note")+'</span>'
      + '<div>'+text(b.note)+'</div></div>';
    if (b.table){
      var t = b.table;
      return '<div class="sh-tw"><table class="sh-table">'
        + (t.head ? '<thead><tr>'+t.head.map(function(c){ return '<th>'+text(c)+'</th>'; }).join("")+'</tr></thead>' : "")
        + '<tbody>'+t.rows.map(function(r){
            return '<tr>'+r.map(function(c, i){
              var th = i === 0 && t.rowHeads !== false;
              return (th ? '<th scope="row">' : '<td>') + text(c) + (th ? '</th>' : '</td>');
            }).join("")+'</tr>';
          }).join("")+'</tbody></table></div>';
    }
    return "";
  }

  function tally(){
    var vals = Object.keys(revealed).map(function(k){ return revealed[k]; });
    return {
      yes: vals.filter(function(v){ return v === "yes"; }).length,
      no:  vals.filter(function(v){ return v === "no"; }).length
    };
  }

  function renderSheet(){
    var cur = current, n = counts(cur.pack, cur.sheet);
    var hiddenNow = holesOf(cur.sheet).filter(covered).length;
    var modes = [["practice", "What’s due"], ["all", "Cover all"], ["read", "Read"]];
    var tl = tally();

    var html = '<div class="panel sheet">'
      + '<button class="link" id="sh-back">← all cheat sheets</button>'
      + '<h2 class="sheet-h" style="margin-top:10px">'+(cur.num ? cur.num + ". " : "")+esc(cur.label)+'</h2>'
      + '<div class="sh-bar">'
      +   '<span class="sh-modes">'+modes.map(function(m){
            return '<button class="toggle'+(mode === m[0] ? " on" : "")+'" data-mode="'+m[0]+'">'+m[1]+'</button>';
          }).join("")+'</span>'
      +   '<span class="tiny muted">'+(mode === "read" ? n.total + " holes"
            : hiddenNow + " covered" + (tl.yes + tl.no ? " · " + tl.yes + " yes, " + tl.no + " no" : ""))+'</span>'
      + '</div>'
      + (mode !== "read" ? '<p class="tiny muted sh-help">Say the answer in your head, tap the hole to reveal it, and say whether you knew it.'
          + (mode === "practice" && n.ok ? ' What you’ve mastered shows as plain text.' : "") + '</p>' : "")
      + '<div class="sh-body">' + cur.sheet.blocks.map(block).join("") + '</div>'
      + '</div>';

    var done = tl.yes + tl.no;
    html += '<div class="panel between">'
      + '<span class="tiny muted">'+(done ? "Today on this sheet: you knew " + tl.yes + " of " + done + "." : "When you’re done, try its questions.")+'</span>'
      + '<button id="sh-quiz">Questions of topic'+(cur.num ? " " + cur.num : "")+' →</button>'
      + '</div>';

    $("sheets").innerHTML = html;
    P.renderDiagrams($("sheets"));
    wire();
    renderAsk();
  }

  /* The "did you know it?" bar is fixed at the bottom: on a phone the hole may
   * be in the middle of a table with no room for two buttons beside it. */
  function renderAsk(){
    var bar = $("sh-ask");
    if (!asking || !current || $("view-sheets").hidden){ bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = '<span>Did you know it?</span>'
      + '<button id="sh-yes">Yes <kbd>1</kbd></button>'
      + '<button id="sh-no">No <kbd>2</kbd></button>';
    $("sh-yes").onclick = function(){ answer(true); };
    $("sh-no").onclick = function(){ answer(false); };
  }

  function rerender(){
    var y = window.scrollY;
    renderSheet();
    window.scrollTo(0, y);
  }

  function answer(ok){
    if (!asking) return;
    revealed[asking] = ok ? "yes" : "no";
    answerHole(gidOf(current.pack, current.sheet, asking), ok);
    asking = null;
    rerender();
  }

  function reveal(id){
    if (revealed[id] === "yes" || revealed[id] === "no") return;
    if (!covered(id) && revealed[id] !== "rev") return;
    /* If you leave one unanswered and reveal another, the first stays visible
     * without counting: nothing is recorded that you didn't say. */
    revealed[id] = "rev";
    asking = id;
    rerender();
  }

  function wire(){
    $("sh-back").onclick = function(){ renderList(); window.scrollTo(0, 0); };
    $("sheets").querySelectorAll("[data-mode]").forEach(function(b){
      b.onclick = function(){ mode = b.dataset.mode; revealed = {}; asking = null; renderSheet(); };
    });
    $("sheets").querySelectorAll(".hole.cov, .hole.rev").forEach(function(h){
      h.onclick = function(){ reveal(h.dataset.h); };
      h.onkeydown = function(e){ if (e.key === "Enter" || e.key === " "){ e.preventDefault(); reveal(h.dataset.h); } };
    });
    $("sh-quiz").onclick = function(){
      if (window.Study) window.Study.goTopic(current.pack.id, current.sheet.topic);
    };
  }

  document.addEventListener("keydown", function(e){
    if (!asking || $("view-sheets").hidden) return;
    if (/^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName) || e.metaKey || e.ctrlKey) return;
    if (e.key === "1"){ e.preventDefault(); answer(true); }
    if (e.key === "2"){ e.preventDefault(); answer(false); }
  });

  window.Sheets = {
    open: open,
    hide: renderAsk,
    /* Settings changed which courses are visible: load again next time. */
    reset: function(){ loaded = false; current = null; }
  };

})();
