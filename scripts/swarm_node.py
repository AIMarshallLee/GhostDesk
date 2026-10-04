import os
import sys
import time
import json
import socket
import threading
import subprocess
from pathlib import Path

# 编码保护
if sys.platform == "win32":
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "replace")
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "replace")

try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("[Error] 请先安装 paho-mqtt: pip install paho-mqtt")
    sys.exit(1)

IS_WINDOWS = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"

ROOT_DIR = Path(__file__).resolve().parent.parent
CONFIG_FILE = ROOT_DIR / "swarm_config.json"

def load_config():
    if not CONFIG_FILE.exists():
        default_cfg = {
            "broker": "broker.emqx.io",
            "port": 1883,
            "cluster_id": "ghostdesk_marshall_swarm",
            "cluster_token": "ghostdesk_marshall_2026",
            "node_id": socket.gethostname().lower(),
            "node_alias": f"{socket.gethostname()} ({'Windows' if IS_WINDOWS else 'macOS'})"
        }
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(default_cfg, f, indent=2, ensure_ascii=False)
        return default_cfg
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

CONFIG = load_config()
BROKER = CONFIG.get("broker", "broker.emqx.io")
PORT = CONFIG.get("port", 1883)
CLUSTER_ID = CONFIG.get("cluster_id", "ghostdesk_marshall_swarm")
CLUSTER_TOKEN = CONFIG.get("cluster_token", "ghostdesk_marshall_2026")
NODE_ID = CONFIG.get("node_id", socket.gethostname().lower())
NODE_ALIAS = CONFIG.get("node_alias", socket.gethostname())

TOPIC_TASK = f"ghostdesk/{CLUSTER_ID}/node/{NODE_ID}/task"
TOPIC_BROADCAST = f"ghostdesk/{CLUSTER_ID}/broadcast/task"
TOPIC_REGISTRY = f"ghostdesk/{CLUSTER_ID}/registry"
TOPIC_RESULT = f"ghostdesk/{CLUSTER_ID}/results"

def execute_action(action_type, payload):
    print(f"\n⚡ [{time.strftime('%H:%M:%S')}] 收到执行指令: [{action_type}]", flush=True)
    
    if action_type == "ping":
        return {
            "status": "ok",
            "message": f"节点 {NODE_ALIAS} 在线正常",
            "node_id": NODE_ID,
            "platform": sys.platform,
            "time": time.time()
        }

    elif action_type == "type_text":
        text = payload.get("text", "")
        press_enter = payload.get("enter", False)
        print(f"👉 正在敲入文字: {text[:60]}... (回车={press_enter})", flush=True)
        try:
            import pyperclip
            old_clip = ""
            try:
                old_clip = pyperclip.paste()
            except Exception:
                pass
            pyperclip.copy(text)
            if IS_MAC:
                subprocess.run(["osascript", "-e", 'tell application "System Events" to keystroke "v" using command down'])
                if press_enter:
                    time.sleep(0.05)
                    subprocess.run(["osascript", "-e", 'tell application "System Events" to key code 36'])
            else:
                import pyautogui
                pyautogui.hotkey("ctrl", "v")
                if press_enter:
                    time.sleep(0.05)
                    pyautogui.press("enter")
            time.sleep(0.05)
            if old_clip:
                try:
                    pyperclip.copy(old_clip)
                except Exception:
                    pass
            return {"status": "ok", "message": f"成功注入文字 (长度: {len(text)})"}
        except Exception as e:
            return {"status": "error", "message": f"打字失败: {e}"}

    elif action_type == "screenshot":
        print(f"📸 正在截取屏幕画面...", flush=True)
        try:
            from PIL import ImageGrab
            import base64
            import io
            img = ImageGrab.grab()
            # 缩放到合适宽度，保证传输极速
            if img.width > 1280:
                scale = 1280 / img.width
                img = img.resize((1280, int(img.height * scale)))
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=75)
            b64_str = base64.b64encode(buf.getvalue()).decode("utf-8")
            return {
                "status": "ok",
                "message": "截图成功",
                "width": img.width,
                "height": img.height,
                "image_base64": b64_str
            }
        except Exception as e:
            return {"status": "error", "message": f"截图失败: {e}"}

    elif action_type == "launch_app":
        app_name = payload.get("app", "")
        print(f"👉 正在启动/唤醒应用: {app_name}", flush=True)
        try:
            if IS_MAC:
                subprocess.run(["open", "-a", app_name])
            else:
                subprocess.run(f"start {app_name}", shell=True)
            return {"status": "ok", "message": f"应用 [{app_name}] 已成功唤醒"}
        except Exception as e:
            return {"status": "error", "message": f"唤醒应用失败: {e}"}

    elif action_type == "run_command":
        cmd = payload.get("cmd", "")
        print(f"👉 正在执行系统命令: {cmd}", flush=True)
        try:
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=120)
            stdout = res.stdout.strip()
            stderr = res.stderr.strip()
            output = stdout if stdout else stderr
            return {
                "status": "ok" if res.returncode == 0 else "nonzero_exit",
                "exit_code": res.returncode,
                "output": output[:2000],
                "message": f"命令执行完成 (退出码: {res.returncode})"
            }
        except subprocess.TimeoutExpired:
            return {"status": "error", "message": "命令执行超时 (超限 120 秒)"}
        except Exception as e:
            return {"status": "error", "message": f"命令执行异常: {e}"}

    elif action_type == "run_python":
        code = payload.get("code", "")
        print(f"👉 正在执行 Python 代码块...", flush=True)
        try:
            res = subprocess.run(
                [sys.executable, "-c", code],
                capture_output=True,
                text=True,
                timeout=60
            )
            return {
                "status": "ok" if res.returncode == 0 else "error",
                "output": (res.stdout + res.stderr)[:2000],
                "message": "Python 代码块执行完成"
            }
        except Exception as e:
            return {"status": "error", "message": f"Python 执行失败: {e}"}

    elif action_type == "lock_screen":
        print("🔒 正在执行屏幕锁定...", flush=True)
        try:
            if IS_MAC:
                subprocess.run(["pmset", "displaysleepnow"])
            else:
                subprocess.run(["rundll32.exe", "user32.dll,LockWorkStation"])
            return {"status": "ok", "message": "已成功锁定电脑屏幕"}
        except Exception as e:
            return {"status": "error", "message": f"锁屏失败: {e}"}

    return {"status": "unknown_action", "message": f"未支持的指令动作: {action_type}"}

def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f"✅ [Swarm Node] 成功连接至云端总线 [{BROKER}:{PORT}]", flush=True)
        print(f"📡 监听私有任务通道: {TOPIC_TASK}", flush=True)
        print(f"📡 监听全网广播通道: {TOPIC_BROADCAST}", flush=True)
        client.subscribe(TOPIC_TASK)
        client.subscribe(TOPIC_BROADCAST)
        send_heartbeat(client)
    else:
        print(f"❌ [Swarm Node] 连接云端失败，错误代码: {rc}", flush=True)

def on_message(client, userdata, msg):
    try:
        raw = msg.payload.decode("utf-8")
        data = json.loads(raw)
        
        # 安全 Token 校验
        token = data.get("token", "")
        if token != CLUSTER_TOKEN:
            print(f"⚠️ [Swarm Node] 拒绝未经授权的任务请求 (Token 不匹配: {token[:4]}***)", flush=True)
            return

        task_id = data.get("task_id", f"task_{int(time.time()*1000)}")
        action = data.get("action", "")
        payload = data.get("payload", {})

        result = execute_action(action, payload)
        
        # 回传执行结果
        resp = {
            "task_id": task_id,
            "node_id": NODE_ID,
            "node_alias": NODE_ALIAS,
            "action": action,
            "result": result,
            "timestamp": time.time()
        }
        client.publish(TOPIC_RESULT, json.dumps(resp, ensure_ascii=False))
        print(f"📤 [Swarm Node] 任务 [{task_id}] 结果已回传至云端中继", flush=True)
    except Exception as e:
        print(f"❌ [Swarm Node] 处理任务异常: {e}", flush=True)

def send_heartbeat(client):
    info = {
        "node_id": NODE_ID,
        "node_alias": NODE_ALIAS,
        "platform": sys.platform,
        "status": "online",
        "timestamp": time.time()
    }
    try:
        client.publish(TOPIC_REGISTRY, json.dumps(info, ensure_ascii=False))
    except Exception:
        pass

def heartbeat_loop(client):
    while True:
        try:
            send_heartbeat(client)
        except Exception:
            pass
        time.sleep(15)

def main():
    print("========================================================", flush=True)
    print(f"🌐 GhostDesk 分布式云端智能节点 (Swarm Worker)", flush=True)
    print(f"🏷️  节点标识: [{NODE_ID}] - {NODE_ALIAS}", flush=True)
    print(f"🔐 集群频道: [{CLUSTER_ID}]", flush=True)
    print(f"☁️  云端中继: [{BROKER}:{PORT}]", flush=True)
    print("========================================================", flush=True)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"ghost_node_{NODE_ID}_{int(time.time())}")
    client.on_connect = on_connect
    client.on_message = on_message

    t = threading.Thread(target=heartbeat_loop, args=(client,), daemon=True)
    t.start()

    while True:
        try:
            client.connect(BROKER, PORT, 60)
            client.loop_forever()
        except KeyboardInterrupt:
            print("\n节点已主动退出。")
            break
        except Exception as e:
            print(f"⚠️ 网络闪断: {e}，5秒后自动重连...", flush=True)
            time.sleep(5)

if __name__ == "__main__":
    main()
