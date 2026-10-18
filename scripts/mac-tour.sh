#!/bin/sh
# Run the tour on the Mac's GPU. Copied there with the build by the lab caller; run as
#   ssh mac sh ~/blue-lab/scripts/mac-tour.sh [desktop|phone]
export PATH=/opt/homebrew/bin:$PATH
cd ~/blue-lab || exit 1
PORT=4180
python3 -m http.server $PORT --bind 127.0.0.1 --directory dist >/dev/null 2>&1 &
SERVER=$!
sleep 1
mkdir -p shots
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" CDP_GPU=1 CDP_PROFILES="$HOME/blue-lab/profiles" \
  node scripts/tour.mjs "http://127.0.0.1:$PORT/" "$HOME/blue-lab/shots" "${1:-desktop}"
STATUS=$?
kill $SERVER
exit $STATUS
