---
name: new-course
description: Create or extend a Preguntón course (spaced-repetition quiz) from a topic, a folder of notes, a codebase or a document — multiple-choice questions with an explanation per option, optional open questions with rubrics, images, Mermaid diagrams, listen buttons and cheat sheets. Use when the user asks for a course, quiz, flashcards, questions or a cheat sheet to study something in Preguntón, or wants to add questions to an existing course.
---

# Writing a Preguntón course

A good course teaches while it tests: every option explains why it's right or wrong, distractors are the mistakes someone who half-studied would make, and nothing gives the answer away except knowing it. Quality beats quantity: 15 sharp questions are worth more than 50 vague ones.

## 1. Find the data folder and what's there

```bash
node <repo>/check.js
```

It works from any folder. Its first two lines say where the data folder is and which features are on. Courses go in `<data>/courses/<id>.json`, cheat sheets in `<data>/sheets/<id>.json` (name each file after its `id`), images in `<data>/media/<id>/`. Create those folders if they don't exist yet; the server only makes them the first time it starts. Don't write open questions if `open` is off, or diagrams if `diagrams` is off, unless the user asks (then mention they can switch it on in Settings).

**Never lose someone's course.** List `<data>/courses/` before writing:

- For a new course, pick an `id` that no file there uses (and not `tour`, which would hide the example).
- If the course already exists, read it first and edit it in place: add questions, fix wording. Keep every existing question unless the user asks you to remove it.
- Before rewriting a big part of an existing file, copy it to `<data>/backups/<id>-<YYYY-MM-DD>.json` and say so.
- Never delete course, sheet or media files, and never touch `progress.json`.

## 2. Pin down scope (briefly)

Work out from the request: the source (topic, notes, repo, URL), the level, and the size. Default to 15-25 questions over 3-6 topics. If the topic is vague or the level unclear, ask one short question; otherwise go.

- **From notes or documents:** only use what's in them. If something important is missing or looks wrong, say so instead of filling the gap from memory.
- **From a codebase:** read the actual code. Ask about behaviour and design decisions someone working on it needs ("what happens when…", "why does X go through Y"), not trivia like line counts. Put the file path in `ref` so they can look it up. Code snippets in `code` must be real (trimmed is fine).
- **From general knowledge:** stick to well-established facts. Numbers, dates and limits must be right; if you're not sure, leave the question out or check the source.

## 3. The format

```jsonc
{
  "id": "k8s-networking",              // lowercase, hyphens; part of every progress key
  "title": "Kubernetes networking",
  "subtitle": "Where the questions come from, one line",
  "speak": "de-DE",                    // optional: default voice language for `say`
  "ordered": true,                     // optional: numbers topics in order (for a syllabus)
  "sourceBase": "https://docs…/",      // optional: prefix for relative `ref`s
  "topics": [ { "id": "services", "label": "Services" } ],
  "questions": [
    {
      "id": "svc-clusterip-reach",     // unique in the course and NEVER changed afterwards
      "topic": "services",
      "q": "Stem. `code` and **bold** work.",
      "code": "optional code block",
      "img": "k8s-networking/flow.svg",    // optional image with the stem (path under media/, or a URL)
      "imgCaption": "optional",
      "imgReveal": "…", "imgRevealCaption": "…",   // optional image shown after answering
      "diagram": "flowchart LR\n  A --> B",          // optional Mermaid with the stem
      "diagramReveal": "…",                          // optional Mermaid after answering
      "say": "Vielleicht", "speak": "de-DE", "sayFirst": true,   // optional listen button
      "multi": true,                   // optional: several correct options
      "recall": false,                 // set when it can't be answered without seeing options
      "ref": "src/net/proxy.ts",       // optional: where it comes from
      "options": [
        { "t": "Option", "ok": true,  "why": "Why it's right — teach something." },
        { "t": "Other",  "ok": false, "why": "Why it's tempting and why it's wrong." }
      ]
    },
    {
      "id": "why-headless",
      "topic": "services",
      "type": "open",
      "q": "Explain in your own words…",
      "rubric": [
        { "id": "dns", "p": "An idea a good answer must contain", "w": "must" },
        { "id": "nuance", "p": "A nuance that adds", "w": "nice" }
      ],
      "answer": "Model answer, shown after grading."
    }
  ]
}
```

Text fields (`q`, `t`, `why`, `p`, list items, captions) take `**bold**`, `*italic*` and `` `code` ``.

Cheat sheet (`<data>/sheets/<course id>.json`). Each sheet covers one topic of the course; write them for the topics where a summary helps, not necessarily all:

```jsonc
{
  "id": "k8s-networking",
  "subtitle": "…",
  "sheets": [{
    "topic": "services",
    "summary": "One line for the list",
    "blocks": [
      { "h": "Section" },
      { "p": "Text with a {{hole-id|hidden answer}}" },
      { "list": ["…"] },
      { "table": { "head": ["", "A", "B"], "rows": [["Row", "{{a|x}}", "{{b|y}}"]] } },
      { "code": "kubectl expose … --type={{svc-type|NodePort}}" },
      { "note": "…", "kind": "trap" },          // tip · trap · why · fun · new · howto
      { "img": "k8s-networking/x.svg", "caption": "…" },
      { "diagram": "flowchart LR\n A-->B" }
    ]
  }]
}
```

## 4. Rules that matter

**Ids are forever.** Progress is stored as `course/question-id` (and `sheet:course/topic/hole-id`). Changing an id wipes that card's history. When editing a course, fix wording freely but keep ids; when adding, use new ids.

**Every option needs a `why`.** That's what turns the quiz into teaching. The right option's `why` explains the idea; each wrong option's `why` names the misconception behind it.

**Don't let the answer give itself away.** The biggest tell is length: the truth tends to come with its nuance and the lie gets written in one go, so the correct option ends up the longest. Put the nuance in `why`; in `t`, all options weigh the same and have the same grammatical shape. Also avoid: absolutes ("always", "never") only in distractors, the correct option being the only one that echoes the stem's words, and joke distractors. `check.js` flags a correct option more than 15% longer than the longest distractor, and courses where it's the longest (or the shortest) in over 40% of questions. Questions whose options are all short (under 30 characters, like command names) don't count.

**Options are shuffled.** Never "all of the above", "none of the above", "A and B".

**One clear answer.** If an expert could argue for two options, rewrite it or make it `multi`.

**Use `recall: false`** for questions you can't answer without the options ("Which of these statements is true?"). Everything else should be answerable from memory, which is what recall mode tests.

**Images and diagrams**: use `img`/`diagram` when the picture is context you need to reason; use `imgReveal`/`diagramReveal` when it contains the answer. Ask yourself: could you answer by looking only at the picture? Then it goes after. Draw simple SVGs into `<data>/media/<course id>/` (white background, dark ink, labels ≥ 13px) or use stable URLs. Mermaid 11 is used; flowchart and sequence diagrams are the safest, and other kinds (like `gitGraph`) work too. `check.js` can't catch Mermaid syntax errors, so tell the user to look at the diagram in the page.

**Open questions** (`type: "open"`) are for "explain why" and "compare" — things recognising an option can't prove. 2-4 `must` points plus 1-2 `nice` ones, each a single checkable idea. Always include a model `answer`.

**Listen buttons**: `say` is the text read aloud, in `speak` (BCP-47, e.g. `de-DE`, `pl-PL`, `en-GB`), from the question or the course. With `sayFirst` the button shows with the stem (questions about what you hear); without it, it shows after answering, so it can't give the answer away. Options can have their own `say` for pairs that get confused.

**Cheat sheets**: holes (`{{id|answer}}`) work in any text and in `code` blocks, but not inside `` `backticks` `` or `**bold**` in text: put the hole outside them. Hide only what has one clear answer (a number, a name, a short "why"). If after revealing it you'd wonder whether you "knew it", the hole is badly chosen. A sheet must agree with the quiz on the same topic.

## 5. Check and hand over

```bash
node check.js <course id>
```

Fix everything it reports, then run it again until it says "All good". Then tell the user how many questions and topics you wrote, anything you left out or weren't sure about, and to reload the page (no restart needed). If the server isn't running, offer to start it.
