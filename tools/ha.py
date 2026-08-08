"""Shared Home Assistant API helper (REST + WebSocket).

Credentials come from env.txt, one `key: value` per line, kept outside this
repo. Parse it line-wise — an earlier copy of this helper did
`read().split(':', 1)[1]` and swallowed the whole file the moment env.txt grew
a second line.
"""
import json, os, pathlib, urllib.request

# Nothing about one instance is baked in here. Point HA_ENV_FILE wherever the
# credentials live, or drop an env.txt beside the repo; the base URL and token
# come from that file or straight from the environment.
ENV = pathlib.Path(os.environ.get(
    "HA_ENV_FILE", pathlib.Path(__file__).resolve().parents[2] / "env.txt"))


def _env():
    out = {}
    if ENV.exists():
        for line in ENV.read_text().splitlines():
            if ":" in line and not line.lstrip().startswith("#"):
                k, v = line.split(":", 1)
                out[k.strip()] = v.strip()
    return out


_E = _env()
BASE = (os.environ.get("HA_BASE_URL") or _E.get("ha_base_url")
        or _E.get("ha_external_url"))
TOKEN = os.environ.get("HA_TOKEN") or _E.get("ha_api_token")
if not BASE or not TOKEN:
    raise SystemExit(
        "No Home Assistant credentials. Set HA_BASE_URL and HA_TOKEN, or put\n"
        "  ha_base_url: http://your-instance:8123\n"
        "  ha_api_token: <long-lived token>\n"
        f"in {ENV} (or point HA_ENV_FILE at it).")
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
