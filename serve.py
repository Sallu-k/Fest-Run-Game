#!/usr/bin/env python3
"""Serve the built game (dist/) on http://localhost:8080 — no Node.js needed.

    python3 serve.py            # Linux / macOS
    py serve.py                 # Windows
    python3 serve.py 9000       # another port

Why not plain `python -m http.server`? On some Windows machines Python reports .js files as text/plain,
which stops the browser from loading ES modules. This wrapper sets the MIME types explicitly.
"""
import http.server
import os
import socketserver
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".html": "text/html",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):  # keep the console quiet
        pass


if not os.path.isdir(ROOT):
    sys.exit("dist/ not found - run `npm run build` first (or use the dist/ folder that ships with the project).")

socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("", PORT), Handler) as httpd:
    print(f"FestRun is running at  http://localhost:{PORT}")
    print("Projector window:                     http://localhost:%d/#/projector" % PORT)
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
