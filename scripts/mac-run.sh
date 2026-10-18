#!/bin/sh
# Serve the build on the Mac and run one lab script against it on the Mac's GPU:
#   ssh mac sh ~/blue-lab/scripts/mac-run.sh probe.mjs 390 844 2 1 10
#   ssh mac sh ~/blue-lab/scripts/mac-run.sh probe-audio.mjs
# The script gets the local URL as its first argument, then the rest.
export PATH=/opt/homebrew/bin:$PATH
cd ~/blue-lab || exit 1
PORT=4181
python3 -m http.server $PORT --bind 127.0.0.1 --directory dist >/dev/null 2>&1 &
SERVER=$!
sleep 1
SCRIPT=$1
shift
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" CDP_GPU=1 CDP_PROFILES="$HOME/blue-lab/profiles" \
  node "scripts/$SCRIPT" "http://127.0.0.1:$PORT/" "$@"
STATUS=$?
kill $SERVER
exit $STATUS
