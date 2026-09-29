import socket
import urllib.request
import urllib.error

DOT = "."
HOSTS = (
    ("Spotify API", "api" + DOT + "spotify" + DOT + "com"),
    ("Spotify Web", "open" + DOT + "spotify" + DOT + "com"),
)

def main():
    print("--- NETWORK DIAGNOSTICS ---")

    try:
        socket.create_connection(("1.1.1.1", 53), timeout=3).close()
        print("PASS  raw internet (1.1.1.1)")
    except Exception as e:
        print("FAIL  raw internet:", e)
        return

    try:
        socket.gethostbyname("google" + DOT + "com")
        print("PASS  DNS resolution")
    except Exception as e:
        print("FAIL  DNS resolution:", e)

    for name, host in HOSTS:
        url = "https://" + host
        print("\nTesting", name, "->", url)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=5) as r:
                print("PASS  HTTP", r.status)
        except urllib.error.HTTPError as e:
            # Any HTTP status, even 401/403/404, means the server was reached
            print("PASS  server reachable, replied HTTP", e.code)
        except Exception as e:
            print("FAIL  unreachable:", e)

main()