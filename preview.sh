#!/bin/zsh
# Local preview of site/ only. Does not deploy.
cd "$(dirname "$0")/site" || exit 1
PORT=4180
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already serving a preview. Open http://127.0.0.1:$PORT/"
  exit 0
fi
echo "Preview: http://127.0.0.1:$PORT/   (Ctrl-C stops it)"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
