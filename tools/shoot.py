#!/usr/bin/env python3
"""
Screenshot the preview at a real device size.

    python3 tools/shoot.py out.png [url] [width] [height]

Headless Chrome will not give you a window narrower than 500px on macOS: pass
`--window-size=390,844` and you get a 500px viewport with the image cropped to
390, which looks exactly like a page overflowing its container and is not. An
afternoon went into a layout bug that did not exist because of it.

So this drives Chrome over the DevTools protocol instead and sets the viewport
with `Emulation.setDeviceMetricsOverride`, which has no such floor. What comes
back is the page as a phone actually sees it.
"""
import base64
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 9222


def main():
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "shot.png")
    url = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:8777/tools/preview.html"
    width = int(sys.argv[3]) if len(sys.argv) > 3 else 390
    height = int(sys.argv[4]) if len(sys.argv) > 4 else 844

    import websocket  # same dependency the HA helper already needs

    chrome = subprocess.Popen(
        [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
         f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
         "--window-size=800,900", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        target = None
        for _ in range(40):
            try:
                tabs = json.loads(urllib.request.urlopen(
                    f"http://127.0.0.1:{PORT}/json", timeout=2).read())
                target = next((t for t in tabs if t["type"] == "page"), None)
                if target:
                    break
            except Exception:
                pass
            time.sleep(0.25)
        if not target:
            sys.exit("Chrome never opened a debuggable page.")

        ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=45)
        n = [0]

        def cmd(method, **params):
            n[0] += 1
            ws.send(json.dumps({"id": n[0], "method": method, "params": params}))
            while True:
                m = json.loads(ws.recv())
                if m.get("id") == n[0]:
                    if "error" in m:
                        sys.exit(f"{method}: {m['error']}")
                    return m.get("result", {})

        # The whole point: a viewport Chrome would otherwise refuse to give.
        cmd("Emulation.setDeviceMetricsOverride", width=width, height=height,
            deviceScaleFactor=2, mobile=True)
        cmd("Page.enable")
        cmd("Page.navigate", url=url)
        time.sleep(6)   # the card fetches statistics before it is worth looking at

        shot = cmd("Page.captureScreenshot", captureBeyondViewport=True)
        out.write_bytes(base64.b64decode(shot["data"]))

        metrics = cmd("Runtime.evaluate", returnByValue=True, expression="""
            JSON.stringify({
              vw: document.documentElement.clientWidth,
              scroll: document.documentElement.scrollWidth
            })""")
        m = json.loads(metrics["result"]["value"])
        print(f"wrote {out} — viewport {m['vw']}px, scrollWidth {m['scroll']}px"
              + ("  OVERFLOWS" if m["scroll"] > m["vw"] + 1 else "  (no overflow)"))
        ws.close()
    finally:
        chrome.terminate()


if __name__ == "__main__":
    main()
