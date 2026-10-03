import os
import sys
import time
import json
import socket
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

ROOT_DIR = Path(__file__).resolve().parent.parent
CONFIG_FILE = ROOT_DIR / "swarm_config.json"
EXAMPLE_CONFIG = ROOT_DIR / "swarm_config.example.json"

def load_config():
    if not CONFIG_FILE.exists():
        if EXAMPLE_CONFIG.exists():
            import shutil
            shutil.copy2(EXAMPLE_CONFIG, CONFIG_FILE)
        else:
            return {
                "broker": "broker.emqx.io",
                "port": 1883,
                "cluster_id": "ghostdesk_marshall_swarm",
                "cluster_token": "secret123"
            }
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

CONFIG = load_config()
BROKER = CONFIG.get("broker", "broker.emqx.io")
PORT = CONFIG.get("port", 1883)
CLUSTER_ID = CONFIG.get("cluster_id", "ghostdesk_marshall_swarm")
CLUSTER_TOKEN = CONFIG.get("cluster_token", "secret123")

TOPIC_REGISTRY = f"ghostdesk/{CLUSTER_ID}/registry"
TOPIC_RESULT = f"ghostdesk/{CLUSTER_ID}/results"

online_nodes = {}

def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f"✅ [Swarm Dispatcher] 成功连接至云端中继总线 [{BROKER}:{PORT}]", flush=True)
        print(f"📡 监听节点心跳注册: {TOPIC_REGISTRY}", flush=True)
        print(f"📡 监听各节点执行结果: {TOPIC_RESULT}", flush=True)
        client.subscribe(TOPIC_REGISTRY)
        client.subscribe(TOPIC_RESULT)
    else:
        print(f"❌ 连接失败，代码: {rc}", flush=True)

def on_message(client, userdata, msg):
    try:
        data = json.loads(msg.payload.decode("utf-8"))
        if msg.topic == TOPIC_REGISTRY:
            node_id = data.get("node_id")
            online_nodes[node_id] = {
                "alias": data.get("node_alias", node_id),
                "platform": data.get("platform", "unknown"),
                "last_seen": time.time()
            }
        elif msg.topic == TOPIC_RESULT:
            task_id = data.get("task_id")
            alias = data.get("node_alias")
            res = data.get("result", {})
            print(f"\n🔔 [异地回传] 电脑【{alias}】任务 [{task_id}] 完成！结果: {res.get('message', res)}", flush=True)
            print("> ", end="", flush=True)
    except Exception as e:
        pass

def parse_and_dispatch(client, prompt: str):
    """
    轻量意图解析器：解析自然语言指令
    示例：
      - 'office: 正在打开代码'
      - 'mac: 打开 safari'
      - 'all: 锁定屏幕'
    """
    prompt = prompt.strip()
    if not prompt:
        return

    target = "all"
    action = "type_text"
    payload = {}

    # 简单前缀解析规则 (后续可接大模型做深度意图拆解)
    if ":" in prompt or "：" in prompt:
        delimiter = ":" if ":" in prompt else "："
        prefix, content = prompt.split(delimiter, 1)
        prefix = prefix.strip().lower()
        content = content.strip()
        
        # 寻找匹配的节点
        matched_id = None
        for nid, info in online_nodes.items():
            if prefix in nid.lower() or prefix in info["alias"].lower():
                matched_id = nid
                break
        
        target = matched_id if matched_id else prefix
        
        # 判断具体动作
        if content.startswith("打开 ") or content.startswith("open "):
            action = "launch_app"
            payload = {"app": content.replace("打开 ", "").replace("open ", "").strip()}
        elif "锁屏" in content or "休眠" in content:
            action = "lock_screen"
        elif content.startswith("执行 ") or content.startswith("run "):
            action = "run_command"
            payload = {"cmd": content.replace("执行 ", "").replace("run ", "").strip()}
        else:
            action = "type_text"
            payload = {"text": content, "enter": True}
    else:
        # 无前缀默认向所有机器广播打字
        action = "type_text"
        payload = {"text": prompt, "enter": False}

    task_payload = {
        "token": CLUSTER_TOKEN,
        "task_id": f"task_{int(time.time()*1000)}",
        "action": action,
        "payload": payload,
        "timestamp": time.time()
    }

    if target == "all":
        topic = f"ghostdesk/{CLUSTER_ID}/broadcast/task"
        print(f"🚀 [广播派发] -> 向所有在线电脑广播任务 [{action}]: {payload}", flush=True)
    else:
        topic = f"ghostdesk/{CLUSTER_ID}/node/{target}/task"
        print(f"🚀 [定向派发] -> 向电脑【{target}】派发任务 [{action}]: {payload}", flush=True)

    client.publish(topic, json.dumps(task_payload, ensure_ascii=False))

def print_cluster_status():
    now = time.time()
    print("\n========================================================", flush=True)
    print(f"📊 [GhostDesk 异地电脑集群状态盘] (频道: {CLUSTER_ID})", flush=True)
    active_count = 0
    for nid, info in list(online_nodes.items()):
        if now - info["last_seen"] < 30: # 30秒内有心跳
            active_count += 1
            print(f"  🟢 在线: [{nid}] - {info['alias']} ({info['platform']})", flush=True)
        else:
            print(f"  ⚪ 离线: [{nid}] - {info['alias']}", flush=True)
    if active_count == 0:
        print("  ⚠️ 暂无任何电脑在线。启动异地电脑上的 swarm_node 即可自动现身！", flush=True)
    print("========================================================\n", flush=True)

def main():
    print("========================================================", flush=True)
    print("👑 GhostDesk 云端多电脑集群中枢调度器 (Swarm Dispatcher)", flush=True)
    print("========================================================", flush=True)
    
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"dispatcher_{int(time.time())}")
    client.on_connect = on_connect
    client.on_message = on_message
    
    client.connect(BROKER, PORT, 60)
    client.loop_start()

    time.sleep(1.0)
    print("\n💡 指令输入提示:")
    print("  1. 输入 'status' 或 'list' 查看当前所有在线电脑")
    print("  2. 输入 'mac: 打开 Chrome' 给 Mac 机器下发指令")
    print("  3. 输入 'win: 执行 dir' 给 Windows 机器执行命令")
    print("  4. 输入 'all: 锁屏' 让所有电脑锁定屏幕")
    print("  5. 输入 'exit' 退出\n")

    while True:
        try:
            line = input("> ").strip()
            if not line:
                continue
            if line in ["exit", "quit"]:
                break
            elif line in ["status", "list", "ls"]:
                print_cluster_status()
            else:
                parse_and_dispatch(client, line)
        except (KeyboardInterrupt, EOFError):
            break

    client.loop_stop()
    print("调度器已退出。")

if __name__ == "__main__":
    main()
