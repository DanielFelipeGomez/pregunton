/* Study and Progress tabs.
 *
 * A round takes what's due (oldest first) plus new questions up to the daily
 * limit, mixes courses if you want, and shows one card at a time. Answering
 * reveals every explanation; then you choose when to see it again, which is
 * what feeds the scheduler in core.js.
 */

"use strict";

(function(){

  var P = window.P, $ = P.$, esc = P.esc, md = P.md;

  var index = [];        // every question, flattened, with a global id

  var courseFilter = null, onlyFailed = false, formatFilter = "";
  /* Chosen topics, as a set of "course/topic". Empty = all: so "All" isn't a
   * separate state to keep in sync, and removing the last topic goes back to it. */
  var topicSel = {}, topicsOpen = false;
  var queue = [], current = null, picked = [], revealed = false;
  var opts = [];         // options of the current question, already shuffled

  /* Recall first: the stem shows alone and you say whether you can recall the
   * answer before seeing options. That same tap reveals them, so saying how
   * sure you are costs no extra step — and it gets recorded. */
  var claim = null;      // "y" I've got it · "n" can't recall · null without recall
  var shown = false;     // options revealed in recall mode

  /* Open questions: what you wrote, and what the grader says. */
  var openAns = "", grading = false, gradeRes = null;
  var graderStatus = { ready: false, mode: "self" };

  function S(){ return P.settings; }
  function recallMode(){ return !!S().study.recallFirst; }
  function isOpen(q){ return q && q.type === "open"; }
  function hidden(cid){ return S().hiddenCourses.indexOf(cid) >= 0; }

  /* Courses with "ordered" follow a syllabus: the number is the topic's
   * position in `topics`. */
  function topicName(c, t, i){ return (c.ordered ? (i+1) + ". " : "") + t.label; }

  function courses(){ return P.courses.filter(function(c){ return !hidden(c.id); }); }

  /* ------------------------------------------------------------- filters */

  function hasTopics(){ return Object.keys(topicSel).length > 0; }

  function pool(){
    var byTopic = hasTopics(), openOn = P.on("open");
    return index.filter(function(q){
      if (hidden(q.cid)) return false;
      if (isOpen(q) && !openOn) return false;
      if (courseFilter && q.cid !== courseFilter) return false;
      if (byTopic && !topicSel[q.topicKey]) return false;
      if (onlyFailed && !(P.cards[q.gid] && P.cards[q.gid].lapses > 0)) return false;
      if (formatFilter === "open" && !isOpen(q)) return false;
      if (formatFilter === "test" && isOpen(q)) return false;
      return true;
    });
  }

  /* How many brand-new questions this round may bring in. */
  function newAllowance(){
    var limit = Number(S().study.newPerDay) || 0;
    return limit ? Math.max(0, limit - P.newToday()) : Infinity;
  }

  function buildQueue(){
    var due = [], fresh = [];
    pool().forEach(function(q){
      var c = P.cards[q.gid];
      if (!c) fresh.push(q);
      else if (P.isDue(c)) due.push(q);
    });
    due.sort(function(a,b){ return P.cards[a.gid].due.localeCompare(P.cards[b.gid].due); });
    shuffle(fresh);
    fresh = fresh.slice(0, newAllowance());
    /* Mixing courses on purpose: switching context between questions is what
     * makes recall stick. Off, a round goes course by course. */
    var mixed = S().study.interleave ? interleave(due).concat(interleave(fresh)) : due.concat(fresh);
    queue = mixed.slice(0, Number(S().study.sessionSize) || 15);
  }

  function shuffle(a){
    for (var i=a.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=a[i]; a[i]=a[j]; a[j]=t; }
    return a;
  }

  function interleave(list){
    var byCourse = {};
    list.forEach(function(q){ (byCourse[q.cid] = byCourse[q.cid] || []).push(q); });
    var keys = Object.keys(byCourse), out = [], added = true;
    while (added){
      added = false;
      keys.forEach(function(k){
        if (byCourse[k].length){ out.push(byCourse[k].shift()); added = true; }
      });
    }
    return out;
  }

  function next(){
    picked = []; revealed = false;
    claim = null; shown = false;
    openAns = ""; grading = false; gradeRes = null;
    current = queue.shift() || null;
    /* JSON order is ignored on purpose: in files the correct option tends to
     * come first, so without shuffling you memorise the position, not the
     * idea. Shuffled once per showing so re-renders don't move options. */
    opts = current && current.options ? shuffle(current.options.slice()) : [];
    renderCard();
    renderFilters();
  }

  /* --------------------------------------------------------- topic picker */

  function visibleTopics(){
    var out = [];
    courses().forEach(function(c){
      if (courseFilter && c.id !== courseFilter) return;
      (c.topics||[]).forEach(function(t, i){
        out.push({ key: c.id + "/" + t.id, course: c, topic: t, i: i });
      });
    });
    return out;
  }

  function topicSummary(){
    var sel = visibleTopics().filter(function(v){ return topicSel[v.key]; });
    if (!sel.length) return "All topics";
    if (sel.length === 1) return topicName(sel[0].course, sel[0].topic, sel[0].i);
    var oneOrdered = sel.every(function(v){ return v.course === sel[0].course && v.course.ordered; });
    if (oneOrdered) return "Topics " + sel.map(function(v){ return v.i + 1; }).join(" + ");
    return sel.map(function(v){ return v.topic.label; }).join(" + ");
  }

  /* A tap adds or removes a topic. From "All", the first tap keeps only that
   * one. Selecting every topic is the same as "All", and stays that way. */
  function toggleTopic(key){
    if (topicSel[key]) delete topicSel[key]; else topicSel[key] = true;
    var all = visibleTopics();
    if (all.length > 1 && all.every(function(v){ return topicSel[v.key]; })) topicSel = {};
  }

  function renderTopicPicker(){
    var vis = visibleTopics(), mixed = !courseFilter, html = "", lastCourse = null;
    html += '<button class="chip all'+(hasTopics()?"":" on")+'" data-topic="">All</button>';
    vis.forEach(function(v){
      if (mixed && v.course !== lastCourse){
        html += '<span class="chip-h">'+esc(v.course.title)+'</span>';
        lastCourse = v.course;
      }
      var on = !!topicSel[v.key];
      html += '<button class="chip'+(on?" on":"")+'" data-topic="'+esc(v.key)+'" aria-pressed="'+on+'">'
        + esc(topicName(v.course, v.topic, v.i)) + '</button>';
    });
    return '<div class="topics" id="topics">'
      + '<p class="tiny muted">Tap to add or remove topics. <b>All</b> starts over.</p>'
      + '<div class="chips">'+html+'</div>'
      + '<div class="row" style="margin-top:12px"><button id="topics-done">Done · '+pool().length+' questions</button></div>'
      + '</div>';
  }

  function renderFilters(){
    var el = $("filters");
    var courseOpts = ['<option value="">All courses</option>'].concat(
      courses().map(function(c){
        return '<option value="'+esc(c.id)+'"'+(courseFilter===c.id?" selected":"")+'>'+esc(c.title)+'</option>';
      })
    ).join("");

    var anyOpen = P.on("open") && index.some(function(q){ return isOpen(q) && !hidden(q.cid); });
    var formatOpts = [["", "Choice and open"], ["test", "Multiple choice"], ["open", "Open only"]]
      .map(function(f){
        return '<option value="'+f[0]+'"'+(formatFilter===f[0]?" selected":"")+'>'+f[1]+'</option>';
      }).join("");

    el.innerHTML =
        '<select id="f-course" aria-label="Course">'+courseOpts+'</select>'
      + '<button class="tsum'+(hasTopics()?" on":"")+(topicsOpen?" open":"")+'" id="f-topic" aria-expanded="'+topicsOpen+'">'
      +   '<span>'+esc(topicSummary())+'</span><i aria-hidden="true"></i></button>'
      + (anyOpen ? '<select id="f-format" aria-label="Question type">'+formatOpts+'</select>' : "")
      + '<button class="toggle'+(onlyFailed?" on":"")+'" id="f-failed">Only the ones I miss</button>'
      + '<button class="toggle'+(recallMode()?" on":"")+'" id="f-recall" title="Stem first: try to recall the answer before seeing the options">Recall first</button>'
      + '<span class="tiny muted" style="margin-left:auto">'+pool().length+' in filter</span>'
      + (topicsOpen ? renderTopicPicker() : "");

    $("f-course").onchange = function(){
      courseFilter = this.value || null;
      topicSel = {};
      buildQueue(); next();
    };
    $("f-topic").onclick = function(){ topicsOpen = !topicsOpen; renderFilters(); };
    el.querySelectorAll("[data-topic]").forEach(function(b){
      b.onclick = function(){
        if (b.dataset.topic) toggleTopic(b.dataset.topic); else topicSel = {};
        buildQueue(); next();
      };
    });
    if ($("topics-done")) $("topics-done").onclick = function(){ topicsOpen = false; renderFilters(); };
    $("f-failed").onclick = function(){ onlyFailed = !onlyFailed; buildQueue(); next(); };
    if ($("f-format")) $("f-format").onchange = function(){ formatFilter = this.value; buildQueue(); next(); };
    /* Changes how a card is shown, not what's due: the queue stays. Saved as a
     * setting so it's the same on every device. */
    $("f-recall").onclick = function(){
      S().study.recallFirst = !recallMode();
      P.post("/api/settings", { settings: { study: { recallFirst: S().study.recallFirst } } });
      this.classList.toggle("on", recallMode());
      if (!revealed && !picked.length){ claim = null; shown = false; renderCard(); }
    };
  }

  /* ------------------------------------------------------------ the card */

  function sayBox(q, withText){
    if (!q.say || !q.speakLang || !P.on("audio")) return "";
    return '<div class="say">'
      + '<button class="ghost" data-say="1" title="Key E">▶ Listen</button>'
      + '<button class="ghost" data-say="slow" title="Key L">Slow</button>'
      + (withText ? '<span class="say-w" lang="'+esc(q.speakLang)+'">'+esc(q.say)+'</span>' : "")
      + '</div>';
  }

  function emptyState(){
    var none = !courses().length;
    var left = pool().filter(function(q){ var c = P.cards[q.gid]; return !c || P.isDue(c); }).length;
    var limited = left && !queue.length && newAllowance() === 0;
    if (none) return '<div class="done"><h2>No courses yet</h2>'
      + '<p class="muted tiny">Open Claude Code in the Preguntón repo and ask: <i>“make me a course about …”</i>. '
      + 'Or show the tour again from <b>Settings</b>.</p></div>';
    return '<div class="done">'
      + '<h2>'+(left ? "Round complete" : "Nothing due here")+'</h2>'
      + '<p class="muted tiny" style="margin:0 0 16px">'
      + (limited ? "You've reached today's limit of new questions. Change it in Settings if you want more."
         : left ? left+" questions still available with this filter."
         : "Come back when the next review is due, or pick another course or topic.")
      + '</p>'
      + (left && !limited ? '<button id="btn-more">Another round</button>' : "")
      + '</div>';
  }

  function renderCard(){
    var el = $("card");

    if (!current){
      el.innerHTML = emptyState();
      if ($("btn-more")) $("btn-more").onclick = function(){ buildQueue(); next(); };
      return;
    }

    var q = current, c = P.cards[q.gid];

    var html = '<div class="qmeta">'
      + '<span class="tags">'
      +   '<span class="tag">'+esc(q.courseTitle)+'</span>'
      +   '<span class="tag t">'+esc((q.topicNum ? q.topicNum+". " : "")+q.topicLabel)+'</span>'
      +   (q.multi ? '<span class="tag t">several correct</span>' : "")
      +   (isOpen(q) ? '<span class="tag t">open</span>' : "")
      + '</span>'
      + '<span>'+(c ? "review "+((c.reps||0)+1) : "first time")+' · '+queue.length+' left</span>'
      + '</div>'
      + '<p class="stem">'+md(q.q)+'</p>'
      + (q.code ? '<pre><code>'+esc(q.code)+'</code></pre>' : "")
      + P.figure(q.img, q.imgCaption)
      + P.diagram(q.diagram)
      + (q.sayFirst && !revealed ? sayBox(q, false) : "");

    if (isOpen(q)){
      el.innerHTML = html + renderOpen(q);
      P.renderDiagrams(el);
      return wireOpen();
    }

    if (inRecall()){
      el.innerHTML = html
        + '<div class="recall">'
        +   '<p class="tiny muted">Answer it in your head before seeing the options. Can you recall it?</p>'
        +   '<div class="rc">'
        +     '<button id="rc-y"><b>Got it</b><span>1 · space</span></button>'
        +     '<button id="rc-n"><b>Can’t recall</b><span>2</span></button>'
        +   '</div>'
        + '</div>';
      $("rc-y").onclick = function(){ claim = "y"; shown = true; renderCard(); };
      $("rc-n").onclick = function(){ claim = "n"; shown = true; renderCard(); };
      P.renderDiagrams(el);
      return;
    }

    html += '<div class="opts'+(revealed?" revealed":"")+'" id="opts">';
    opts.forEach(function(o,i){
      var chosen = picked.indexOf(i) >= 0;
      var cls = "opt", mark = "";
      if (revealed){
        if (o.ok){ cls += " ok"; mark = "✓"; }
        else if (chosen){ cls += " no"; mark = "✕"; }
        else cls += " dim";
      } else if (chosen) cls += " pick";

      html += '<div class="'+cls+'" data-i="'+i+'">'
        + '<div class="lab">'
        +   '<span class="key">'+String.fromCharCode(65+i)+'</span>'
        +   '<span class="txt">'+md(o.t)+'</span>'
        /* Once revealed, every option with `say` can be heard: comparing two
         * similar words is what teaches you to tell them apart. */
        +   (revealed && o.say && q.speakLang && P.on("audio") ? '<button class="ghost say-o" data-say-o="'+i+'" title="Listen">▶</button>' : "")
        +   (mark ? '<span class="mark">'+mark+'</span>' : "")
        + '</div>'
        + (revealed ? '<p class="why">'+(chosen && !o.ok ? "<b>Your answer.</b> " : "")+md(o.why)+'</p>' : "")
        + '</div>';
    });
    html += '</div>';

    if (!revealed && q.multi){
      html += '<div class="row" style="margin-top:14px">'
        + '<button id="btn-check">Check</button>'
        + '<span class="tiny muted">mark every one that applies</span></div>';
    }

    if (revealed){
      var ok = wasCorrect();
      /* Getting it right without having recalled it is recognising, not
       * knowing: it can't be Easy, and Hard is suggested. */
      var recognised = claim === "n" && ok;
      var verdict = (ok ? "Correct. " : "Missed. ")
        + (claim === "y" && ok ? "And you had it from memory. " : "")
        + (claim === "y" && !ok ? "You thought you had it: one of the most worth reviewing. " : "")
        + (recognised ? "You recognised it when you saw it, you didn’t recall it. " : "");
      html += P.figure(q.imgReveal, q.imgRevealCaption);
      html += P.diagram(q.diagramReveal);
      html += sayBox(q, true);
      html += '<div class="grade">'
        + '<div class="tiny muted">'+verdict+'When do you want to see it again?</div>'
        + gbtns(recognised ? [0,3,4] : [0,3,4,5], recognised ? 3 : null)
        + '</div>';
      if (q.ref){
        var href = /^https?:\/\//.test(q.ref) ? q.ref : (q.sourceBase || "") + q.ref;
        if (/^https?:\/\//.test(href)) html += '<p class="tiny" style="margin-top:14px"><a class="muted" target="_blank" rel="noreferrer" href="'
          + esc(href) + '">Source ↗</a></p>';
      }
    }

    el.innerHTML = html;
    P.renderDiagrams(el);
    wire();
  }

  var GLABEL = { 0:"Again", 3:"Hard", 4:"Good", 5:"Easy" };

  function previewInterval(grade){
    if (grade < 3) return "today";
    return P.nextInterval(P.cards[current.gid] || P.blank(), grade) + " d";
  }

  function gbtns(grades, suggested){
    return '<div class="gs" style="grid-template-columns:repeat('+grades.length+',1fr)">'
      + grades.map(function(g){
          return '<button class="g'+(g===suggested?" sug":"")+'" data-g="'+g+'"><b>'+GLABEL[g]+'</b>'
            + '<span>'+previewInterval(g)+(g===suggested?" · suggested":"")+'</span></button>';
        }).join("")
      + '</div>';
  }

  function inRecall(){
    return recallMode() && current && !isOpen(current) && current.recall !== false && !shown && !revealed;
  }

  /* What goes into the history besides the grade: whether you claimed to
   * recall it, or how much of an open question you covered. It feeds the
   * "Recall or recognise" numbers in Progress. */
  function extra(){
    if (isOpen(current)) return gradeRes ? { cov: openScore().pct } : {};
    return claim ? { r: claim } : {};
  }

  /* ------------------------------------------------------ open questions */

  /* "unset" is where self-grading starts: nothing judged yet, instead of a
   * wall of red before you've looked. It counts as missing for the grade. */
  var MARK  = { covered:"✓", partial:"◐", missing:"✕", unset:"?" };
  var CYCLE = { unset:"covered", covered:"partial", partial:"missing", missing:"covered" };

  function openScore(){
    var q = current, tot = 0, got = 0, mustN = 0, mustOk = 0, mustMiss = 0;
    q.rubric.forEach(function(r, i){
      var w = r.w === "nice" ? 1 : 2, e = gradeRes.points[i].state;
      tot += w;
      got += w * (e === "covered" ? 1 : e === "partial" ? 0.5 : 0);
      if (w === 2){ mustN++; if (e === "covered") mustOk++; if (e === "missing" || e === "unset") mustMiss++; }
    });
    var pct = Math.round(got / tot * 100) / 100;
    /* Missing a must-have or saying something false can't go above Hard,
     * however well you cover the rest. */
    var g = pct >= 0.9 ? 5 : pct >= 0.75 ? 4 : pct >= 0.5 ? 3 : 0;
    if ((mustMiss || gradeRes.errors.length) && g > 3) g = 3;
    return { pct:pct, g:g, mustN:mustN, mustOk:mustOk };
  }

  /* Your answer with the fragments the grader quoted, highlighted in the
   * colour of their point. */
  function markAnswer(text, points){
    var low = text.toLowerCase(), ranges = [];
    points.forEach(function(p){
      var c = (p.quote || "").trim();
      var at = c ? low.indexOf(c.toLowerCase()) : -1;
      if (at >= 0) ranges.push([at, at + c.length, p.state]);
    });
    ranges.sort(function(a,b){ return a[0]-b[0]; });
    var out = "", pos = 0;
    ranges.forEach(function(r){
      if (r[0] < pos) r[0] = pos;
      if (r[1] <= r[0]) return;
      out += esc(text.slice(pos, r[0])) + '<mark class="'+r[2]+'">' + esc(text.slice(r[0], r[1])) + "</mark>";
      pos = r[1];
    });
    return (out + esc(text.slice(pos))).replace(/\n/g, "<br>");
  }

  function renderOpen(q){
    if (!gradeRes){
      var who = graderStatus.ready
        ? "graded by " + esc(graderStatus.model) + " locally"
        : "you grade yourself against the rubric";
      return '<textarea id="ans" rows="6" placeholder="Explain it in your own words, as you would to a colleague."'
        + (grading ? " disabled" : "") + '>'+esc(openAns)+'</textarea>'
        + '<div class="row" style="margin-top:10px">'
        +   (grading
              ? '<span class="tiny muted">Grading with '+esc(graderStatus.model)+'… the first time is slower while the model loads.</span>'
              : '<button id="btn-grade">'+(graderStatus.ready ? "Grade" : "Check against the rubric")+'</button>'
                + '<button id="btn-dunno" class="ghost">Can’t answer</button>'
                + '<span class="tiny muted">⌘↵ · '+who+'</span>')
        + '</div>';
    }

    var s = openScore();
    var html = openAns.trim()
      ? '<div class="answer">'+markAnswer(openAns, gradeRes.points)+'</div>'
      : '<div class="answer muted">No answer.</div>';

    if (gradeRes.error){
      html += '<div class="callout warn">No grader ('+esc(gradeRes.error)+'). '
        + 'Mark which points you covered: each tap changes its state.</div>';
    } else if (gradeRes.self){
      html += '<p class="tiny muted" style="margin:12px 0 0">Tap each point to mark it: ✓ covered · ◐ partly · ✕ missing.</p>';
    }

    html += '<div class="rubric">' + q.rubric.map(function(r, i){
      var p = gradeRes.points[i];
      return '<div class="rb '+p.state+'">'
        + '<button class="st" data-rb="'+i+'" title="Change">'+MARK[p.state]+'</button>'
        + '<div><div>'+md(r.p)+(r.w === "nice" ? ' <span class="tag t">bonus</span>' : "")
        +   (p.yours ? ' <span class="tiny muted">· set by you</span>' : "") + '</div>'
        +   (p.quote ? '<div class="quote">“'+esc(p.quote)+'”</div>' : "")
        +   (p.note ? '<div class="tiny muted">'+md(p.note)+'</div>' : "")
        + '</div></div>';
    }).join("") + '</div>';

    if (gradeRes.errors.length){
      html += '<div class="callout no"><b>What you said that isn’t right:</b><ul>'
        + gradeRes.errors.map(function(e, i){
            return '<li>'+md(e)+' <button class="tiny ghost" data-err="'+i+'">not an error</button></li>';
          }).join("")
        + '</ul></div>';
    }

    if (q.answer) html += '<div class="model"><b>Model answer.</b> '+md(q.answer)+'</div>';

    html += '<div class="grade">'
      + '<div class="tiny muted">You cover '+s.mustOk+' of '+s.mustN+' must-haves · '
      +   Math.round(s.pct*100)+'% of the rubric. When do you want to see it again?</div>'
      + gbtns([0,3,4,5], s.g)
      + '</div>';
    return html;
  }

  function submitOpen(dunno){
    var q = current;
    openAns = dunno ? "" : ($("ans") ? $("ans").value : openAns);
    var blank = { points: q.rubric.map(function(r){ return { id:r.id, state:"missing", quote:"", note:"" }; }), errors: [] };
    if (dunno || !openAns.trim()){ gradeRes = blank; return renderCard(); }
    if (!graderStatus.ready){
      if (graderStatus.mode === "ollama") gradeRes = Object.assign(blank, { error: graderStatus.reason || "not available" });
      else {
        blank.points.forEach(function(p){ p.state = "unset"; });
        gradeRes = Object.assign(blank, { self: true });
      }
      return renderCard();
    }

    grading = true; renderCard();
    P.post("/api/grade", { course: q.cid, id: q.id, answer: openAns })
      .then(function(r){
        if (current !== q) return;              // moved on while grading
        gradeRes = { points: r.points, errors: r.errors || [] };
      })
      .catch(function(e){
        if (current !== q) return;
        gradeRes = Object.assign(blank, { error: e.message });
      })
      .then(function(){
        if (current !== q) return;
        grading = false; renderCard();
      });
  }

  function wireOpen(){
    var ta = $("ans");
    if (ta && !grading){
      ta.focus();
      ta.oninput = function(){ openAns = ta.value; };
      ta.onkeydown = function(e){
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)){ e.preventDefault(); submitOpen(false); }
      };
      $("btn-grade").onclick = function(){ submitOpen(false); };
      $("btn-dunno").onclick = function(){ submitOpen(true); };
    }
    document.querySelectorAll("[data-rb]").forEach(function(b){
      b.onclick = function(){
        var p = gradeRes.points[+b.dataset.rb];
        p.state = CYCLE[p.state]; p.yours = true;
        renderCard();
      };
    });
    document.querySelectorAll("[data-err]").forEach(function(b){
      b.onclick = function(){ gradeRes.errors.splice(+b.dataset.err, 1); renderCard(); };
    });
    wireGrades();
  }

  function wasCorrect(){
    if (isOpen(current)) return !!gradeRes && openScore().g >= 4;
    var ok = [];
    opts.forEach(function(o,i){ if (o.ok) ok.push(i); });   // indexes already shuffled
    return ok.length === picked.length && ok.every(function(i){ return picked.indexOf(i) >= 0; });
  }

  function wire(){
    var box = $("opts");
    if (box && !revealed){
      box.querySelectorAll(".opt").forEach(function(node){
        node.onclick = function(){
          var i = +node.dataset.i;
          if (current.multi){
            var at = picked.indexOf(i);
            if (at >= 0) picked.splice(at,1); else picked.push(i);
          } else {
            picked = [i]; revealed = true;
          }
          renderCard();
        };
      });
    }
    var chk = $("btn-check");
    if (chk) chk.onclick = function(){
      if (!picked.length) return P.toast("Mark at least one");
      revealed = true; renderCard();
    };
    wireGrades();
  }

  function wireGrades(){
    document.querySelectorAll(".g").forEach(function(b){
      b.onclick = function(){
        var g = +b.dataset.g;
        P.schedule(current.gid, g, wasCorrect(), extra());
        if (g < 3) queue.push(current);
        next();
      };
    });
  }

  /* ------------------------------------------------------------ progress */

  function visibleIndex(){
    return index.filter(function(q){ return !hidden(q.cid) && (P.on("open") || !isOpen(q)); });
  }

  function stats(){
    var seen = 0, mast = 0, due = 0, hits = 0, tries = 0, list = visibleIndex();
    list.forEach(function(q){
      var c = P.cards[q.gid];
      if (!c) return;
      seen++;
      if (P.isMastered(c)) mast++;
      if (P.isDue(c)) due++;
      (c.history||[]).forEach(function(h){ tries++; if (h.ok) hits++; });
    });
    return { seen:seen, mast:mast, due:due, total:list.length,
             accuracy: tries ? Math.round(hits/tries*100) : null };
  }

  function streak(){
    var days = {};
    Object.keys(P.cards).forEach(function(k){
      (P.cards[k].history||[]).forEach(function(h){ days[h.d] = true; });
    });
    var n = 0, d = new Date();
    if (!days[P.dayStr(d)]) d.setDate(d.getDate()-1);   // haven't studied yet today
    while (days[P.dayStr(d)]){ n++; d.setDate(d.getDate()-1); }
    return n;
  }

  function renderStats(){
    var s = stats();
    $("headline").innerHTML = [
      "<b>"+s.due+"</b><span>due today</span>",
      "<b>"+s.mast+"</b><span>mastered</span>",
      "<b>"+(s.total - s.seen)+"</b><span>not seen</span>",
      "<b>"+(s.accuracy===null?"—":s.accuracy+"%")+"</b><span>correct</span>",
      "<b>"+streak()+"</b><span>day streak</span>"
    ].map(function(m){ return '<div class="metric">'+m+'</div>'; }).join("");

    /* Bars per topic. In an ordered course, an untouched topic followed by one
     * already started is usually a lesson you skipped. */
    var rows = [], vis = visibleIndex(), many = courses().length > 1;
    courses().forEach(function(c){
      var lastSeen = -1;
      (c.topics||[]).forEach(function(t, i){
        if (vis.some(function(q){ return q.cid===c.id && q.topic===t.id && P.cards[q.gid]; })) lastSeen = i;
      });
      if (many) rows.push('<div class="bar-h">'+esc(c.title)+'</div>');
      (c.topics||[]).forEach(function(t, i){
        var qs = vis.filter(function(q){ return q.cid===c.id && q.topic===t.id; });
        if (!qs.length) return;
        var seen = qs.filter(function(q){ return P.cards[q.gid]; }).length;
        var mast = qs.filter(function(q){ return P.isMastered(P.cards[q.gid]); }).length;
        var pm = Math.round(mast/qs.length*100), ps = Math.round(seen/qs.length*100);
        var skipped = c.ordered && !seen && i < lastSeen;
        rows.push('<div class="bar-row'+(skipped?" skipped":"")+'">'
          + '<span class="name">'+esc(topicName(c, t, i))
          +   (skipped ? ' <em class="tiny">skipped?</em>' : "")+'</span>'
          + '<span class="bar"><i class="mast" style="width:'+pm+'%"></i>'
          +   '<i class="seen" style="width:'+Math.max(0,ps-pm)+'%"></i></span>'
          + '<span class="tiny muted">'+seen+'/'+qs.length+'</span>'
          + '</div>');
      });
    });
    $("bars").innerHTML = rows.join("") || '<p class="empty">No data yet.</p>';

    var buckets = [];
    for (var i=0;i<7;i++){
      var day = P.addDays(i);
      var n = Object.keys(P.cards).filter(function(k){
        var c = P.cards[k];
        return i === 0 ? c.due <= day : c.due === day;
      }).length;
      buckets.push({ n:n, label: i===0 ? "today" : new Date(day+"T12:00:00")
        .toLocaleDateString("en-GB",{ weekday:"short" }) });
    }
    var max = Math.max.apply(null, [1].concat(buckets.map(function(b){ return b.n; })));
    $("forecast").innerHTML = buckets.map(function(b){
      return '<div class="fc"><b>'+(b.n||"")+'</b>'
        + '<i style="height:'+Math.round(b.n/max*60)+'px"></i>'
        + '<em>'+esc(b.label)+'</em></div>';
    }).join("");

    renderStuck();
    renderCalibration();
  }

  /* What the "Got it / Can't recall" taps say. The number that matters is the
   * second one: what you get right without having recalled it is what a
   * normal quiz would have counted as known. */
  function renderCalibration(){
    var y = { n:0, ok:0 }, n = { n:0, ok:0 }, open = { n:0, cov:0 };
    Object.keys(P.cards).forEach(function(k){
      (P.cards[k].history||[]).forEach(function(h){
        if (h.r === "y"){ y.n++; if (h.ok) y.ok++; }
        if (h.r === "n"){ n.n++; if (h.ok) n.ok++; }
        if (typeof h.cov === "number"){ open.n++; open.cov += h.cov; }
      });
    });
    var pct = function(a){ return Math.round(a.ok / a.n * 100) + "%"; };
    var times = function(k){ return k === 1 ? "once" : k + " times"; };
    var rows = [];
    if (y.n) rows.push('<p>You said <b>“Got it”</b> '+times(y.n)+' and were right <b>'+pct(y)+'</b> of the time.'
      + (y.ok / y.n < 0.8 ? ' You overestimate a bit: when you think you know it, read the options carefully.' : '')
      + '</p>');
    if (n.n) rows.push('<p>You said <b>“Can’t recall”</b> '+times(n.n)+' and still got <b>'+pct(n)+'</b> right once you saw the options. '
      + 'That’s recognising, not recalling: without recall mode it would have counted as known.</p>');
    if (open.n) rows.push('<p><b>Open questions:</b> '+open.n+' answered, covering <b>'
      + Math.round(open.cov / open.n * 100) + '%</b> of the rubric on average.</p>');
    $("calibration").innerHTML = rows.join("")
      || '<p class="empty">Turn on <b>Recall first</b> in Study: every time you say whether you can recall it before seeing the options, '
       + 'this shows how much of what you get right you actually knew.</p>';
  }

  /* Questions you keep missing, each with a prompt to take it to Claude. */
  function renderStuck(){
    var stuck = visibleIndex()
      .filter(function(q){ return P.cards[q.gid] && P.cards[q.gid].lapses >= 2; })
      .sort(function(a,b){ return P.cards[b.gid].lapses - P.cards[a.gid].lapses; })
      .slice(0, 6);

    if (!stuck.length){
      $("stuck").innerHTML = '<p class="empty">Nothing is giving you trouble. When you miss a question twice or more '
        + 'it shows up here, with a prompt to work through it with Claude.</p>';
      return;
    }

    $("stuck").innerHTML = stuck.map(function(q, n){
      var c = P.cards[q.gid];
      return '<div class="stuck-item">'
        + '<div class="q">'+md(q.q)+'</div>'
        + '<div class="meta">'+esc(q.courseTitle)+' · '+esc(q.topicLabel)+' · missed '+c.lapses+' times</div>'
        + '<button class="tiny" style="margin-top:8px" data-copy="'+n+'">Copy a prompt for Claude</button>'
        + '</div>';
    }).join("");

    $("stuck").querySelectorAll("[data-copy]").forEach(function(b){
      var q = stuck[+b.dataset.copy];
      b.onclick = function(){
        P.copy("I keep missing this question from my Preguntón course \"" + q.courseTitle + "\" (id: "
          + q.cid + "/" + q.id + "). Explain the idea behind it simply, then add two new questions to the course "
          + "that approach it from different angles.\n\nQuestion: " + q.q);
      };
    });
  }

  /* ----------------------------------------------------------------- data */

  function buildIndex(){
    index = [];
    P.courses.forEach(function(c){
      var labels = {}, nums = {};
      (c.topics||[]).forEach(function(t, i){
        labels[t.id] = t.label;
        if (c.ordered) nums[t.id] = i + 1;
      });
      c.questions.forEach(function(q){
        index.push(Object.assign({}, q, {
          cid: c.id,
          gid: c.id + "/" + q.id,
          courseTitle: c.title,
          topicKey: c.id + "/" + q.topic,
          topicLabel: labels[q.topic] || q.topic,
          topicNum: nums[q.topic] || null,
          sourceBase: c.sourceBase,
          speakLang: q.speak || c.speak
        }));
      });
    });
  }

  function checkGrader(){
    if (S().open.grader !== "ollama" || !index.some(isOpen)){
      graderStatus = { ready: false, mode: "self" };
      return;
    }
    fetch("/api/grade/status").then(function(r){ return r.json(); })
      .then(function(s){ graderStatus = s; })
      .catch(function(){ graderStatus = { ready:false, mode:"ollama", reason:"the server doesn't answer" }; })
      .then(function(){ if (isOpen(current) && !gradeRes && !grading) renderCard(); });
  }

  function load(){
    return fetch("/api/bootstrap")
      .then(function(r){
        return r.json().then(function(j){
          if (!r.ok){ var e = new Error(j.error || r.status); e.server = true; throw e; }
          return j;
        });
      })
      .then(function(data){
        P.settings = data.settings;
        P.courses  = data.courses || [];
        P.cards    = data.progress || {};
        P.applyAppearance(P.settings.appearance);
        document.querySelector('.tab[data-view="sheets"]').hidden = !P.on("sheets");
        buildIndex();
        if (courseFilter && !courses().some(function(c){ return c.id === courseFilter; })) courseFilter = null;
        P.status("saved on the server");
        buildQueue();
        next();
        checkGrader();
      });
  }

  /* ----------------------------------------------------------------- init */

  function show(view){
    document.querySelectorAll(".tab").forEach(function(x){ x.classList.toggle("on", x.dataset.view === view); });
    document.querySelectorAll("section[id^='view-']").forEach(function(s){
      s.hidden = s.id !== "view-" + view;
    });
    if (view === "stats") renderStats();
    if (view === "settings" && window.Settings) window.Settings.open();
    if (window.Sheets) view === "sheets" ? window.Sheets.open() : window.Sheets.hide();
  }

  document.querySelectorAll(".tab").forEach(function(t){
    t.onclick = function(){ show(t.dataset.view); };
  });

  window.Study = {
    /* From a cheat sheet, "questions of this topic": Study filtered to it. */
    goTopic: function(courseId, topicId){
      courseFilter = courseId;
      topicSel = {}; topicSel[courseId + "/" + topicId] = true;
      topicsOpen = false;
      buildQueue(); next();
      show("study");
      window.scrollTo(0, 0);
    },
    /* After Settings changes what's shown (courses, modules, limits). */
    reload: function(){ return load(); },
    refilter: function(){
      document.querySelector('.tab[data-view="sheets"]').hidden = !P.on("sheets");
      buildQueue(); next(); checkGrader();
    }
  };

  /* Delegated: the card is re-rendered whole on every step. */
  $("card").addEventListener("click", function(e){
    var b = e.target.closest("[data-say]"), o = e.target.closest("[data-say-o]");
    if (b && current) P.say(current.say, current.speakLang, b.dataset.say === "slow");
    if (o && current) P.say(opts[+o.dataset.sayO].say, current.speakLang, false);
  });

  document.addEventListener("keydown", function(e){
    if (!current || $("view-study").hidden) return;
    if (/^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName) || e.metaKey || e.ctrlKey) return;

    var sb = e.key === "e" ? document.querySelector('[data-say="1"]')
           : e.key === "l" ? document.querySelector('[data-say="slow"]') : null;
    if (sb){ e.preventDefault(); return sb.click(); }

    if (inRecall()){
      var rc = e.key === "1" || e.key === " " ? $("rc-y") : e.key === "2" ? $("rc-n") : null;
      if (rc){ e.preventDefault(); rc.click(); }
      return;
    }
    /* preventDefault on all of them: if the next card is open, its textarea
     * takes focus inside this same keydown and would get the key typed. */
    if (isOpen(current)){
      if (gradeRes && /^[1-4]$/.test(e.key)){
        var gb = document.querySelector('.g[data-g="'+[0,3,4,5][+e.key-1]+'"]');
        if (gb){ e.preventDefault(); gb.click(); }
      }
      return;
    }
    if (!revealed && /^[1-9]$/.test(e.key)){
      var node = document.querySelector('.opt[data-i="'+(+e.key-1)+'"]');
      if (node){ e.preventDefault(); node.click(); }
    } else if (revealed && /^[1-4]$/.test(e.key)){
      var gr = document.querySelector('.g[data-g="'+[0,3,4,5][+e.key-1]+'"]');
      if (gr){ e.preventDefault(); gr.click(); }
    }
  });

  load().catch(function(e){
    $("card").innerHTML = e.server
      ? '<div class="done"><h2>Something needs fixing</h2><p class="muted tiny">'+esc(e.message)+'</p></div>'
      : '<div class="done"><h2>The server isn’t running</h2>'
        + '<p class="muted tiny">Start it with <code>node server.js</code> (or double-click <code>start.command</code>) and reload.</p></div>';
    P.status(e.server ? "error" : "offline");
  });

})();
