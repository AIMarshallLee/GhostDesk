import os
import sys
import time
import json
import socket
import threading
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
sys.path.insert(0, str(ROOT_DIR))
CONFIG_FILE = ROOT_DIR / "swarm_config.json"
EXAMPLE_CONFIG = ROOT_DIR / "swarm_config.example.json"

def load_config():
    if not CONFIG_FILE.exists():
        if EXAMPLE_CONFIG.exists():
            import shutil
            shutil.copy2(EXAMPLE_CONFIG, CONFIG_FILE)
            print(f"[Init] 已根据模板生成配置文件: {CONFIG_FILE}")
        else:
            return {
                "broker": "broker.emqx.io",
                "port": 1883,
                "cluster_id": "ghostdesk_marshall_swarm",
                "cluster_token": "secret123",
                "node_id": socket.gethostname().lower(),
                "node_alias": f"{socket.gethostname()} ({'Windows' if IS_WINDOWS else 'macOS'})"
            }
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

CONFIG = load_config()
BROKER = CONFIG.get("broker", "broker.emqx.io")
PORT = CONFIG.get("port", 1883)
CLUSTER_ID = CONFIG.get("cluster_id", "ghostdesk_marshall_swarm")
CLUSTER_TOKEN = CONFIG.get("cluster_token", "secret123")
NODE_ID = CONFIG.get("node_id", socket.gethostname().lower())
NODE_ALIAS = CONFIG.get("node_alias", socket.gethostname())

TOPIC_TASK = f"ghostdesk/{CLUSTER_ID}/node/{NODE_ID}/task"
TOPIC_BROADCAST = f"ghostdesk/{CLUSTER_ID}/broadcast/task"
TOPIC_REGISTRY = f"ghostdesk/{CLUSTER_ID}/registry"
TOPIC_RESULT = f"ghostdesk/{CLUSTER_ID}/results"

def execute_action(action_type, payload):
    print(f"\n⚡ [Swarm Worker] 收到执行指令: [{action_type}]", flush=True)
    
    if action_type == "type_text":
        text = payload.get("text", "")
        press_enter = payload.get("enter", False)
        print(f"👉 正在输入文字: {text[:40]}... (回车={press_enter})", flush=True)
        try:
            import pyperclip
            import pyautogui
            old_clip = pyperclip.paste()
            pyperclip.copy(text)
            if IS_MAC:
                import subprocess
                subprocess.run(["osascript", "-e", 'tell application "System Events" to keystroke "v" using command down'])
                if press_enter:
                    time.sleep(0.05)
                    subprocess.run(["osascript", "-e", 'tell application "System Events" to key code 36'])
            else:
                pyautogui.hotkey("ctrl", "v")
                if press_enter:
                    time.sleep(0.05)
                    pyautogui.press("enter")
            time.sleep(0.05)
            pyperclip.copy(old_clip)
            return {"status": "ok", "message": f"成功敲入文字并执行"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    elif action_type == "video_factory":
        topic = payload.get("topic", "")
        print(f"🎬 [Swarm Worker] 启动短视频内容工厂任务: {topic}", flush=True)
        try:
            from skills.video_factory.engine import VideoFactoryEngine
            return VideoFactoryEngine.process_task(topic)
        except Exception as e:
            return {"status": "error", "message": f"短视频工厂执行失败: {e}"}

    elif action_type == "browser_agent":
        prompt = payload.get("prompt", "")
        print(f"🌐 [Swarm Worker] 启动浏览器自动化特工任务: {prompt}", flush=True)
        try:
            from skills.browser_agent.engine import BrowserAgentEngine
            return BrowserAgentEngine.process_task(prompt)
        except Exception as e:
            return {"status": "error", "message": f"浏览器特工执行失败: {e}"}

    elif action_type == "launch_app":
        app_name = payload.get("app", "")
        print(f"👉 正在唤醒/启动应用: {app_name}", flush=True)
        import subprocess
        try:
            if IS_MAC:
                subprocess.run(["open", "-a", app_name])
            else:
                subprocess.run(f"start {app_name}", shell=True)
            return {"status": "ok", "message": f"应用 {app_name} 已启动/聚焦"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    elif action_type == "run_command":
        cmd = payload.get("cmd", "")
        print(f"👉 正在后台执行命令: {cmd}", flush=True)
        import subprocess
        try:
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=60)
            return {"status": "ok", "stdout": res.stdout, "stderr": res.stderr}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    elif action_type == "lock_screen":
        import subprocess
        if IS_MAC:
            subprocess.run(["pmset", "displaysleepnow"])
        else:
            subprocess.run(["rundll32.exe", "user32.dll,LockWorkStation"])
        return {"status": "ok", "message": "已锁定屏幕"}

    return {"status": "unknown_action", "message": f"未支持的指令: {action_type}"}

def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f"✅ [Swarm Cloud] 成功连接至云端中继总线 [{BROKER}:{PORT}]", flush=True)
        print(f"📡 监听私有任务通道: {TOPIC_TASK}", flush=True)
        print(f"📡 监听广播任务通道: {TOPIC_BROADCAST}", flush=True)
        client.subscribe(TOPIC_TASK)
        client.subscribe(TOPIC_BROADCAST)
        send_heartbeat(client)
    else:
        print(f"❌ [Swarm Cloud] 连接失败，错误代码: {rc}", flush=True)

def on_message(client, userdata, msg):
    try:
        raw = msg.payload.decode("utf-8")
        data = json.loads(raw)
        
        # 安全 Token 校验
        token = data.get("token", "")
        if token != CLUSTER_TOKEN:
            print(f"⚠️ [Swarm Worker] 拒绝未经授权的任务请求 (Token 不匹配)")
            return

        task_id = data.get("task_id", f"task_{int(time.time())}")
        action = data.get("action", "")
        payload = data.get("payload", {})

        result = execute_action(action, payload)
        
        # 回传执行结果
        resp = {
            "task_id": task_id,
            "node_id": NODE_ID,
            "node_alias": NODE_ALIAS,
            "result": result,
            "timestamp": time.time()
        }
        client.publish(TOPIC_RESULT, json.dumps(resp, ensure_ascii=False))
        print(f"📤 [Swarm Worker] 任务结果已回传云端中继", flush=True)
    except Exception as e:
        print(f"❌ [Swarm Worker] 解析任务失败: {e}", flush=True)

def send_heartbeat(client):
    info = {
        "node_id": NODE_ID,
        "node_alias": NODE_ALIAS,
        "platform": sys.platform,
        "status": "online",
        "timestamp": time.time()
    }
    client.publish(TOPIC_REGISTRY, json.dumps(info, ensure_ascii=False))

def heartbeat_loop(client):
    while True:
        try:
            send_heartbeat(client)
        except Exception:
            pass
        time.sleep(15)

def main():
    print("========================================================", flush=True)
    print(f"🌐 GhostDesk 分布式云端节点启动中...", flush=True)
    print(f"🏷️  节点标识: [{NODE_ID}] - {NODE_ALIAS}", flush=True)
    print(f"🔐 集群频道: [{CLUSTER_ID}]", flush=True)
    print(f"☁️  云端中继: [{BROKER}:{PORT}]", flush=True)
    print("========================================================", flush=True)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"ghost_node_{NODE_ID}_{int(time.time())}")
    client.on_connect = on_connect
    client.on_message = on_message

    t = threading.Thread(target=heartbeat_loop, args=(client,), daemon=True)
    t.start()

    try:
        client.connect(BROKER, PORT, 60)
        client.loop_forever()
    except KeyboardInterrupt:
        print("\n节点已主动退出。")

if __name__ == "__main__":
    main()
