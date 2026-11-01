"""Serve the five independent, local-only study projects without dependencies."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread

root = Path(__file__).resolve().parent
servers = []
try:
    for i, name in enumerate(('dashboard', 'shop', 'board', 'booking', 'cms')):
        handler = partial(SimpleHTTPRequestHandler, directory=str(root / name))
        server = ThreadingHTTPServer(('127.0.0.1', 59030 + i), handler)
        servers.append(server)
        Thread(target=server.serve_forever, daemon=True).start()
        print(f'{name}: http://127.0.0.1:{59030+i}/', flush=True)
    Event().wait()
except KeyboardInterrupt:
    pass
finally:
    for server in servers:
        server.shutdown()
