"""紹介動画の効果音を作る：record.mjs が書き残した打鍵と御朱印の時刻に、打鍵音とおりんを置く。

    python3 tools/video/audio.py <timeline.json> <打鍵音のフォルダ> <書き出す wav>

打鍵音はサイトと同じ録音（docs/sounds/keys/）から毎回ひとつ選び、大きさを少し揺らす。
おりんは docs/src/sound.js の stamp() と同じ倍音の組み立てで合成する。Python 3 の標準機能だけで動く。
"""

import array
import json
import math
import random
import sys
import wave
from pathlib import Path

SR = 44100
KEY_GAIN = 0.5
random.seed(7)

# おりん：[基音に対する倍率, 音量, 減衰（秒）, うなり（Hz）]（sound.js と同じ）
ORIN_F0 = 400
ORIN_PARTIALS = [
    (1, 0.26, 13.5, 1.54),
    (2.71, 0.13, 8.6, 2.66),
    (5.12, 0.06, 5.0, 3.78),
    (8.27, 0.03, 2.9, 5.04),
    (12.1, 0.012, 1.4, 0),
]


def load(path):
    with wave.open(str(path)) as w:
        assert w.getframerate() == SR and w.getsampwidth() == 2 and w.getnchannels() == 1, path
        data = array.array("h", w.readframes(w.getnframes()))
    return [v / 32768 for v in data]


def add(buf, start, samples, gain):
    i0 = int(start * SR)
    for i, v in enumerate(samples):
        j = i0 + i
        if 0 <= j < len(buf):
            buf[j] += v * gain


def orin(seconds):
    n = int(seconds * SR)
    out = [0.0] * n
    # 打った瞬間の、短い金属の当たり
    for i in range(int(0.012 * SR)):
        out[i] += (random.random() * 2 - 1) * (1 - i / (0.012 * SR)) ** 2 * 0.12
    for ratio, amp, decay, beat in ORIN_PARTIALS:
        for side in (-0.5, 0.5):
            f = ORIN_F0 * ratio + side * beat
            a0 = amp / 2
            k = math.log(0.0001 / a0) / decay
            w = 2 * math.pi * f / SR
            for i in range(min(n, int(decay * SR))):
                t = i / SR
                env = a0 * math.exp(k * t) * min(1, t / 0.004)
                out[i] += env * math.sin(w * i)
    return out


def main():
    timeline_path, keys_dir, out_path = sys.argv[1:4]
    timeline = json.loads(Path(timeline_path).read_text())
    keys_dir = Path(keys_dir)
    buf = [0.0] * int((timeline["duration"] + 1) * SR)

    keys = [load(keys_dir / f"key-{i}.wav") for i in range(1, 11)]
    spaces = [load(keys_dir / f"space-{i}.wav") for i in (1, 2)]
    for t, kind in timeline["keys"]:
        sample = random.choice(spaces if kind in ("space", "enter") else keys)
        add(buf, t, sample, KEY_GAIN * (0.85 + random.random() * 0.25))

    if timeline["stamps"]:
        bell = orin(13.5)
        for t in timeline["stamps"]:
            add(buf, t, bell, 1.0)

    pcm = array.array("h", (int(max(-1.0, min(1.0, v)) * 32767) for v in buf))
    with wave.open(out_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"打鍵 {len(timeline['keys'])}、おりん {len(timeline['stamps'])} → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
