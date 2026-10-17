# Test-only: serves the app and a fake shared folder so two browser sessions can sync.
import http.server, json, time, urllib.parse, sys, os
FILES = {}
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith('/fs/list'):
            body = json.dumps([{"id": k, "name": k, "modified": v[1]} for k, v in FILES.items()]).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(body); return
        if self.path.startswith('/fs/file/'):
            k = urllib.parse.unquote(self.path[9:]); body = FILES.get(k, ("", ""))[0].encode()
            self.send_response(200); self.end_headers(); self.wfile.write(body); return
        return super().do_GET()
    def do_PUT(self):
        k = urllib.parse.unquote(self.path[9:]); n = int(self.headers.get('Content-Length', 0))
        FILES[k] = (self.rfile.read(n).decode(), str(time.time())); self.send_response(200); self.end_headers()
os.chdir(sys.argv[1] if len(sys.argv) > 1 else '.')
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[2]) if len(sys.argv) > 2 else 8767), H).serve_forever()
