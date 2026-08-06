#!/usr/bin/env python3
"""Minimal statisk server för lokal utveckling.

`python3 -m http.server` hade räckt, men den anropar os.getcwd() vid import
och kraschar i sandlådade miljöer. Den här varianten pekar ut mappen
explicit utifrån filens egen plats i stället.

    python3 serve.py [port]     # standard 8123
"""
import functools
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Ingen cache under utveckling: annars serverar webbläsaren en gammal
        # snapshot-latest.json direkt efter att insamlaren skrivit en ny.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), functools.partial(Handler, directory=ROOT)) as httpd:
    print("Fyndindex på http://localhost:%d  (Ctrl+C avslutar)" % PORT)
    httpd.serve_forever()
