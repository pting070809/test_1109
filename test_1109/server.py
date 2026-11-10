#!/usr/bin/env python3
import http.server
import socketserver
import os

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def run():
    os.chdir(DIRECTORY)
    # Allow port reuse
    socketserver.TCPServer.allow_reuse_address = True
    
    # Try PORT, if busy try next
    port = PORT
    for attempt in range(5):
        try:
            with socketserver.TCPServer(("", port), Handler) as httpd:
                print("==================================================")
                print("🌊 安平四草出海口潮汐預測推估 Web App 已啟動！")
                print(f"👉 請在瀏覽器開啟: http://localhost:{port}")
                print("==================================================")
                httpd.serve_forever()
                break
        except OSError:
            port += 1

if __name__ == "__main__":
    run()
