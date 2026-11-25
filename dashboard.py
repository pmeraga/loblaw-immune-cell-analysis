"""Serve the dashboard generated from the pipeline's SQLite database."""

import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from analysis import OUTPUT, build_dashboard

if __name__ == "__main__":
    build_dashboard()
    port = int(os.environ.get("PORT", "8000"))
    handler = partial(SimpleHTTPRequestHandler, directory=OUTPUT)
    with ThreadingHTTPServer(("0.0.0.0", port), handler) as server:
        print(f"Dashboard available at http://localhost:{port}/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
