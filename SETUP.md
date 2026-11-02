# Setting up Preguntón

These are instructions for Claude. The person asked you to set up Preguntón for them. Your job is to get them from a fresh clone to answering their first question in a few minutes, with as little friction as you can: ask a few questions up front, then do the work, then tell them the three things they need to know.

Keep the conversation short and friendly. Don't explain the architecture unless asked. Every choice here can be changed later, so don't make them think too hard: offer a sensible default for each.

## 1. Check the basics

- Run `node -v`. Preguntón needs Node 18 or later (it uses the built-in `fetch`). If it's missing or older, tell them how to install it (https://nodejs.org, or `brew install node` on a Mac with Homebrew) and stop until they have it. Don't install it yourself without asking.
- You are in the repo root (the folder with `server.js`). If not, `cd` into it.
- Run `node check.js` to make sure the clone is fine. It should say "All good". Until you write `local.json` it shows the default data folder (`./data`); that changes in step 3.
- If they downloaded a ZIP instead of cloning, macOS may refuse to open `start.command` on double-click. The first time, right-click it → Open, or run `xattr -d com.apple.quarantine start.command`.

## 2. Ask the questions

Ask these together in one go (use your question tool if you have one, with the recommended option first). Adapt the wording; keep it short.

1. **Where should your courses and progress live?**
   - `~/Pregunton` (recommended): a folder of its own in their home.
   - Inside a notes vault or synced folder (Obsidian, iCloud, Dropbox…): ask for the path. Their questions then sit next to their notes and get backed up with them. (Obsidian Sync skips `.json` files unless "Sync all other types" is on; iCloud and Dropbox sync everything.)
   - Inside this repo (`./data`): simplest, but it's gitignored, so it's only on this machine.
2. **How do you want to start it?**
   - When I want to study (recommended): a double-click on `start.command` (macOS), or asking Claude "start Preguntón". Nothing runs in the background.
   - Every time I log in: it's always there at http://localhost:4700.
   - I'll wire it myself (Raycast, Alfred, Hammerspoon, a shell alias…): just tell them the command.
3. **What's your first course about?** A topic they're learning, a folder of notes, a codebase, or "nothing yet, show me the tour".
4. **Want a reminder in Claude Code?** One line when a session starts, like "Preguntón: 12 to review, 5 new today". Only shows when something is due.

## 3. Do the setup

### Data folder

Write `local.json` in the repo root (it's gitignored):

```json
{ "dataDir": "~/Pregunton" }
```

`~` is expanded; relative paths are relative to the repo. The server creates `courses/`, `sheets/` and `media/` inside it on first start.

Their existing files come first. Before writing `local.json`, look at the folder:

- **Doesn't exist or is empty**: fine, use it.
- **Already has Preguntón data** (`courses/`, `progress.json`…), say from a reinstall: reuse it as it is.
- **Has other things in it**, like the root of a notes vault: don't scatter folders there. Use a subfolder, e.g. `<vault>/Pregunton`, and mention it in the handover (no need to ask).
- **Has data from another quiz app or an older Preguntón of their own** with a different format: don't point at it. Make a new folder, and offer to bring their old courses over as a separate step, by copying (never moving) them.

Never move, rename or delete anything in a folder that existed before you started.

### Starting it

**On demand.** Nothing to do. On macOS `start.command` is ready (run `chmod +x start.command` if double-clicking doesn't work). Elsewhere it's `node server.js` from the repo.

**At login, macOS.** Use `extras/launchd.plist`:

1. Copy it to `~/Library/LaunchAgents/com.pregunton.server.plist`, replacing `__NODE__` with the output of `command -v node`, `__REPO__` with the absolute repo path, and `__HOME__` with `$HOME`.
2. `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.pregunton.server.plist`
3. Check with `curl -s localhost:4700/api/bootstrap | head -c 80`. Logs go to `~/Library/Logs/pregunton.log`.

Watch out: macOS doesn't let background processes read `~/Desktop`, `~/Documents` or iCloud Drive without permission. If the repo or the data folder is in one of those, the server will fail with `EPERM` in the log. Either move them (for example to `~/pregunton` and `~/Pregunton`), or tell them to give `node` Full Disk Access in System Settings → Privacy & Security. Don't change privacy settings yourself.

To undo: `launchctl bootout gui/$(id -u)/com.pregunton.server` and delete the plist.

**At login, Linux.** A systemd user service (`~/.config/systemd/user/pregunton.service` with `ExecStart=<node> <repo>/server.js` and `Restart=on-failure`), then `systemctl --user enable --now pregunton`.

**At login, Windows.** A Task Scheduler task "At log on" that runs `node <repo>\server.js`, or a shortcut in the Startup folder.

### The reminder

Add a SessionStart hook to their user settings, `~/.claude/settings.json`. Read the file first, merge (don't overwrite other hooks), show them the change and get a yes before writing it:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [{ "type": "command", "command": "\"/absolute/path/to/node\" \"/absolute/path/to/pregunton/due.js\" --hook", "timeout": 5 }]
      }
    ]
  }
}
```

- Use absolute paths for both: `command -v node` for node, since a hook started from the desktop app may not see the shell's PATH (nvm, for example). Keep the quotes: paths with spaces (iCloud) break without them.
- `--hook` makes `due.js` print the line as a `systemMessage`, which the person sees. It prints nothing when nothing is due, so it stays quiet.
- If they move the repo or switch Node versions with nvm, the hook stops working without saying so. Mention it in the handover.

### The first course

If they want one, follow `.claude/skills/new-course/SKILL.md`. Keep this first one modest (12-20 questions, smaller than the skill's usual size) so they're studying in minutes; they can ask for more later. If the topic is vague, ask one question about their level and what they want to be able to do, then go.

If they chose the tour, there's nothing to write.

### Creating courses from anywhere (offer it, don't push it)

The `new-course` skill only exists inside this repo. If they'd like to say "make me a Preguntón course about this repo" from any project, offer to copy it to `~/.claude/skills/pregunton-course/SKILL.md`, with a first line added saying where the repo and data folder are (absolute paths), so it works from elsewhere. Ask first: it's a change outside the repo.

## 4. Start it and hand over

1. `node check.js` must say "All good". Fix anything it reports in courses you wrote.
2. Start the server (unless it's already running from login). Best is to ask them to double-click `start.command`, which also opens the page. If you run `node server.js` in the background yourself, tell them it stops when this Claude session ends.
3. Open http://localhost:4700 (with `open` on macOS, `xdg-open` on Linux, `start` on Windows).
4. Tell them, in three short lines:
   - where their data lives,
   - how to start it next time,
   - that they can ask you for anything (new courses, changes to existing ones, new features) by opening Claude Code in this repo folder, the one with `server.js`, not the data folder. **Settings → Ask Claude** has ideas to copy.

Mention **Settings** once: theme, colours, features, daily limits. Don't list everything in it.

## If something goes wrong

- **Port in use**: Preguntón may already be running; open http://localhost:4700. If another app has the port, start it once with `node server.js 4701` and set that port in Settings → Data and server, so `start.command` and the reminder use it too. (The number after `server.js` is only for that run.)
- **Blank page**: the server isn't running. Start it.
- **A course doesn't show up**: run `node check.js`. A file that isn't valid JSON is skipped with a warning when the server starts.
