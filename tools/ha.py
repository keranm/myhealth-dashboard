"""Shared Home Assistant API helper (REST + WebSocket).

Credentials come from env.txt, one `key: value` per line, kept outside this
repo. Parse it line-wise — an earlier copy of this helper did
`read().split(':', 1)[1]` and swallowed the whole file the moment env.txt grew
a second line.
"""
import json, pathlib, urllib.request

ENV = pathlib.Path.home() / "Development/HomeAssistant-Plugins/env.txt"


def _env():
    out = {}
    for line in ENV.read_text().splitlines():
        if ":" in line and not line.lstrip().startswith("#"):
            k, v = line.split(":", 1)
            out[k.strip()] = v.strip()
    return out


_E = _env()
BASE = _E.get("ha_base_url", "http://homeassistant.local:8123")
TOKEN = _E["ha_api_token"]
H = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def rest(path, data=None, method=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(BASE + path, data=body, headers=H,
                                 method=method or ("POST" if body else "GET"))
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


class WS:
    """Websocket client. Needed for anything the REST API doesn't expose —
    long-term statistics, the entity registry, Lovelace config."""

    def __init__(self, timeout=180):
        import websocket
        self.ws = websocket.create_connection(
            BASE.replace("http", "ws") + "/api/websocket", timeout=timeout)
        self.ws.recv()
        self.ws.send(json.dumps({"type": "auth", "access_token": TOKEN}))
        self.ws.recv()
        self.i = 0

    def cmd(self, **m):
        self.i += 1
        m["id"] = self.i
        self.ws.send(json.dumps(m))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.i and r.get("type") == "result":
                if not r.get("success"):
                    raise RuntimeError(r.get("error"))
                return r.get("result")

    def close(self):
        self.ws.close()
