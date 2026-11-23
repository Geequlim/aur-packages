"""Exercise the installed binary with disposable state as an ordinary user."""
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid


def smoke(binary):
    binary = str(Path(binary).resolve())
    with tempfile.TemporaryDirectory(prefix="thirtyfile-smoke-") as temporary:
        directory = Path(temporary)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        password = "packaging-test-" + uuid.uuid4().hex
        environment = {key: value for key, value in os.environ.items() if not key.startswith("THIRTYFILE_")}
        environment.update({
            "THIRTYFILE_ADDR": f"127.0.0.1:{port}",
            "THIRTYFILE_DATA": str(directory / "data"),
            "THIRTYFILE_STORAGE": str(directory / "storage"),
            "THIRTYFILE_ADMIN_PASSWORD": password,
        })
        log_path = directory / "server.log"
        process = None

        def start(log):
            server = subprocess.Popen([binary], env=environment, stdout=log, stderr=subprocess.STDOUT)
            try:
                for _ in range(100):
                    if server.poll() is not None:
                        raise RuntimeError("ThirtyFile exited before becoming healthy")
                    result = subprocess.run(
                        [binary, "health"], env=environment, capture_output=True, timeout=5,
                    )
                    if result.returncode == 0:
                        return server
                    time.sleep(0.2)
                raise RuntimeError("ThirtyFile did not become healthy")
            except BaseException:
                if server.poll() is None:
                    server.kill()
                    server.wait()
                raise

        def stop(server):
            server.terminate()
            server.wait(timeout=20)

        try:
            with log_path.open("wb") as log:
                process = start(log)
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=5) as response:
                    assert response.status == 200 and b"<html" in response.read().lower()
                data = directory / "data"
                assert list(data.glob("*.db")), "Database was not created"
                key = (data / "secret.key").read_bytes()
                marker = data / "packaging-smoke-marker"
                marker.write_text("preserved")
                stop(process)
                process = None
                process = start(log)
                assert marker.read_text() == "preserved"
                assert (data / "secret.key").read_bytes() == key
                stop(process)
                process = None
        except Exception:
            print(log_path.read_text(errors="replace")[-6000:].replace(password, "[test password]"), file=sys.stderr)
            raise
        finally:
            if process is not None and process.poll() is None:
                process.kill()
                process.wait()
    print("ThirtyFile startup, embedded web UI, health and state preservation checks passed.")


if __name__ == "__main__":
    smoke(sys.argv[1])
