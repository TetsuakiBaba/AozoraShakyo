#!/bin/sh
# 紹介動画（1920×1080、約 1 分）を作る
#
#   sh tools/video/build.sh
#
# 要るもの：Google Chrome、Node.js、Python 3、ffmpeg。BGM は shakyo の Shakyo.m4a（BGM=... で変えられる）
# できるもの：video/aozora-shakyo-intro.mp4（OUT=... で変えられる）
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BGM=${BGM:-"$ROOT/../shakyo/video/Shakyo.m4a"}
OUT=${OUT:-"$ROOT/video/aozora-shakyo-intro.mp4"}
WORK=${WORK:-$(mktemp -d)}
PORT=${PORT:-5175}

# サイトと動画の画面を同じ場所から配る（stage.html が iframe のサイトを操作できるように）
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1

echo "撮る → $WORK"
node "$ROOT/tools/video/record.mjs" "http://localhost:$PORT/tools/video/stage.html" "$WORK"

echo "音を作る"
python3 "$ROOT/tools/video/audio.py" "$WORK/timeline.json" "$ROOT/docs/sounds/keys" "$WORK/effects.wav"

DUR=$(python3 -c "import json,sys; print(round(json.load(open(sys.argv[1]))['duration'], 2))" "$WORK/timeline.json")
FADE=$(python3 -c "print(round($DUR - 3, 2))")

echo "まとめる（${DUR} 秒）→ $OUT"
mkdir -p "$(dirname "$OUT")"
ffmpeg -hide_banner -loglevel error -y \
  -f concat -safe 0 -i "$WORK/frames.txt" \
  -i "$WORK/effects.wav" \
  -i "$BGM" \
  -filter_complex "\
[0:v]fps=30,format=yuv420p[v];\
[2:a]atrim=0:$DUR,asetpts=PTS-STARTPTS,afade=t=in:d=1.2,afade=t=out:st=$FADE:d=3,volume=0.9[bgm];\
[bgm][1:a]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]" \
  -map "[v]" -map "[a]" -t "$DUR" \
  -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart \
  "$OUT"
echo "できました：$OUT"
