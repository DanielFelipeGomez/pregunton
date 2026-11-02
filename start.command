#!/bin/bash
# Double-click to study (macOS). Starts the server and opens the browser.
# Close this Terminal window when you're done.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js isn't installed. Get it from https://nodejs.org (version 18 or later)."
  read -r -p "  Press Enter to close."
  exit 1
fi

PORT=$(node -e 'console.log(require("./lib/config").readSettings().port)')

# Already running (from login, or another window): just open it.
if curl -s "http://localhost:$PORT/api/ping" | grep -q '"app":"pregunton"'; then
  open "http://localhost:$PORT"
  exit 0
fi

# Something else has the port: say so instead of opening the wrong app.
if curl -s -o /dev/null "http://localhost:$PORT"; then
  echo "  Port $PORT is taken by another app."
  echo "  Start Preguntón on another one with: node server.js $((PORT+1))"
  echo "  then set that port in Settings → Data and server, so it sticks."
  read -r -p "  Press Enter to close."
  exit 1
fi

( sleep 1; open "http://localhost:$PORT" ) &
node server.js
