import os
import sys
import json
import time
import socket
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

# 兼容平台
IS_WINDOWS = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"

PORT = 4319
UDP_BROADCAST_PORT = 4320
HOSTNAME = socket.gethostname()
NODE_NAME = f"{HOSTNAME} ({'Windows' if IS_WINDOWS else 'macOS'})"

def execute_action(action_type: str, payload: dict) -> dict:
    """执行主控机派发的具体任务"""
    print(f"\n[Worker] 收到主控机指令: {action_type} -> {payload}", flush=True)
    
    if action_type == "type_text":
        text = payload.get("text", "")
        try:
            import pyperclip
            import pyautogui
            old_clip = pyperclip.paste()
            pyperclip.copy(text)
            if IS_MAC:
                import subprocess
                subprocess.run(["osascript", "-e", 'tell application "System Events" to keystroke "v" using command down'])
            else:
                pyautogui.hotkey("ctrl", "v")
            time.sleep(0.05)
            pyperclip.copy(old_clip)
            return {"status": "ok", "message": f"已在屏幕打入文字: {text[:20]}..."}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    elif action_type == "run_command":
        cmd = payload.get("cmd", "")
        import subprocess
        try:
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
            return {"status": "ok", "stdout": res.stdout, "stderr": res.stderr}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    elif action_type == "lock_screen":
        import subprocess
        if IS_MAC:
            subprocess.run(["pmset", "displaysleepnow"])
        else:
            subprocess.run(["rundll32.exe", "user32.dll,LockWorkStation"])
        return {"status": "ok", "message": "屏幕已锁定/休眠"}

    return {"status": "unknown_action", "message": f"不支持的动作: {action_type}"}

class WorkerHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass # 静默控制台请求日志

    def do_GET(self):
        if self.path == "/status" or self.path == "/ping":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            data = {
                "name": NODE_NAME,
                "hostname": HOSTNAME,
                "platform": sys.platform,
                "status": "ready",
                "time": time.time()
            }
            self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/execute":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8")
            try:
                data = json.loads(body)
                action = data.get("action", "")
                payload = data.get("payload", {})
                result = execute_action(action, payload)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

def start_broadcast():
    """后台向局域网广播宣告自己在线"""
    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    msg = json.dumps({"type": "worker_online", "name": NODE_NAME, "port": PORT}).encode("utf-8")
    while True:
        try:
            udp.sendto(msg, ("255.255.255.255", UDP_BROADCAST_PORT))
        except Exception:
            pass
        time.sleep(5)

def main():
    print("========================================================", flush=True)
    print(f">>> GhostDesk 集群工作节点已就绪: [{NODE_NAME}]", flush=True)
    print(f">>> 正在监听局域网派活端口: http://0.0.0.0:{PORT}", flush=True)
    print(">>> 正在向局域网广播就绪信号，等待主控电脑调度...", flush=True)
    print("========================================================", flush=True)

    t = threading.Thread(target=start_broadcast, daemon=True)
    t.start()

    server = HTTPServer(("0.0.0.0", PORT), WorkerHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nWorker 已停止。")

if __name__ == "__main__":
    main()
