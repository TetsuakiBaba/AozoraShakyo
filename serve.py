"""手元で確かめるための簡易サーバ。ファイルを書き換えたらすぐ反映されるよう、キャッシュさせない。

    python3 serve.py        # http://localhost:5174
    python3 serve.py 8000   # ポートを変えるとき
"""

import http.server
import sys
from functools import partial
from pathlib import Path

PUBLIC = Path(__file__).parent / "docs"  # 公開するファイルはここだけ（GitHub Pages が main の docs/ を配る）


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5174
    handler = partial(Handler, directory=str(PUBLIC))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"http://localhost:{port}/")
        server.serve_forever()


if __name__ == "__main__":
    main()
