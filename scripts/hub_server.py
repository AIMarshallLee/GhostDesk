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

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))
CONFIG_FILE = ROOT_DIR / "hub_config.json"

DEFAULT_CONFIG = {
    "broker": "broker.emqx.io",
    "port": 1883,
    "cluster_id": "ghostdesk_marshall_swarm",
    "cluster_token": "marshall_secret_2026",
    "hub_name": "2015 MacBook Pro 中枢服务器",
    "ark_api_key": "",
    "ark_endpoint_id": ""
}

def load_hub_config():
    if not CONFIG_FILE.exists():
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_CONFIG, f, indent=2, ensure_ascii=False)
        print(f"[Hub] 已创建默认中枢配置: {CONFIG_FILE}")
        return DEFAULT_CONFIG
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return DEFAULT_CONFIG

CONFIG = load_hub_config()
BROKER = CONFIG.get("broker", "broker.emqx.io")
PORT = CONFIG.get("port", 1883)
CLUSTER_ID = CONFIG.get("cluster_id", "ghostdesk_marshall_swarm")
CLUSTER_TOKEN = CONFIG.get("cluster_token", "marshall_secret_2026")
HUB_NAME = CONFIG.get("hub_name", "2015 MacBook Pro 中枢")

TOPIC_REGISTRY = f"ghostdesk/{CLUSTER_ID}/registry"
TOPIC_RESULTS = f"ghostdesk/{CLUSTER_ID}/results"
TOPIC_VOICE_IN = f"ghostdesk/{CLUSTER_ID}/voice_inbox"
TOPIC_NOTIFICATIONS = f"ghostdesk/{CLUSTER_ID}/notifications"

# 在线节点池：{ node_id: { alias, platform, last_seen, status } }
online_workers = {}

def log(msg):
    now_str = time.strftime("%H:%M:%S")
    print(f"[{now_str}] {msg}", flush=True)

def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        log(f"✅ [中枢就绪] 成功连入云端总线 [{BROKER}:{PORT}]")
        log(f"📡 监听节点注册: {TOPIC_REGISTRY}")
        log(f"📡 监听各节点执行回报: {TOPIC_RESULTS}")
        log(f"📡 监听语音指令入口: {TOPIC_VOICE_IN}")
        client.subscribe(TOPIC_REGISTRY)
        client.subscribe(TOPIC_RESULTS)
        client.subscribe(TOPIC_VOICE_IN)
    else:
        log(f"❌ 连接失败，错误代码: {rc}")

def on_message(client, userdata, msg):
    try:
        payload_str = msg.payload.decode("utf-8")
        data = json.loads(payload_str)
        topic = msg.topic

        if topic == TOPIC_REGISTRY:
            # 节点心跳上报
            node_id = data.get("node_id")
            alias = data.get("node_alias", node_id)
            platform = data.get("platform", "unknown")
            is_new = node_id not in online_workers
            online_workers[node_id] = {
                "alias": alias,
                "platform": platform,
                "last_seen": time.time(),
                "status": data.get("status", "ready")
            }
            if is_new:
                log(f"🟢 [新节点上线] 【{alias}】(ID: {node_id}, 系统: {platform}) 已加入集群！")

        elif topic == TOPIC_RESULTS:
            # 节点执行完成回传
            task_id = data.get("task_id", "")
            node_id = data.get("node_id", "")
            alias = data.get("node_alias", node_id)
            res = data.get("result", {})
            status = res.get("status", "ok")
            msg_text = res.get("message") or res.get("stdout") or str(res)
            log(f"🎉 [执行回报] 电脑【{alias}】任务 [{task_id}] 完成 -> {msg_text[:60]}")
            
            # 同步飞书通知与本地多维表格日志
            try:
                from skills.feishu_sync.engine import FeishuSyncEngine
                FeishuSyncEngine.notify_task_complete(task_id, data.get("raw_prompt", ""), alias, msg_text)
            except Exception:
                pass

            # 向 CoreS3 / 通知频道广播结果
            notify = {
                "type": "task_completed",
                "node_alias": alias,
                "summary": f"{alias}: 任务已完成",
                "time": time.time()
            }
            client.publish(TOPIC_NOTIFICATIONS, json.dumps(notify, ensure_ascii=False))

        elif topic == TOPIC_VOICE_IN:
            # 收到来自 CoreS3 硬件或语音对讲的文字输入
            text = data.get("text", "").strip()
            log(f"🎙️ [收到语音指令] \"{text}\"")
            route_and_dispatch(client, text)

    except Exception as e:
        log(f"⚠️ 消息解析异常: {e}")

def route_and_dispatch(client, raw_text: str):
    """
    智能任务拆解与派发引擎
    支持：
      1. 单机定向派发（例如：“让办公室Windows打开Claude Code做登录接口”）
      2. 多机并行复合派发（例如：“让M4编译工程，同时让办公室电脑锁屏”）
      3. 全局广播（例如：“所有电脑锁屏”）
    """
    text = raw_text.strip()
    if not text:
        return

    # 简单模式拆解 (多指令以'同时'、'并且'、'还有'分割)
    sub_tasks = [text]
    for sep in ["同时，", "同时", "并且，", "并且", "还有，", "还有"]:
        if sep in text:
            sub_tasks = [s.strip() for s in text.split(sep) if s.strip()]
            break

    for task_text in sub_tasks:
        dispatch_single_task(client, task_text)

def dispatch_single_task(client, task_text: str):
    target_node = "all"
    action = "type_text"
    payload = {}

    lower_text = task_text.lower()
    
    # 1. 匹配目标节点
    for nid, info in online_workers.items():
        alias_lower = info["alias"].lower()
        if (nid in lower_text) or (alias_lower in lower_text) or \
           ("m4" in lower_text and "m4" in alias_lower) or \
           ("办公室" in lower_text and "办公室" in alias_lower) or \
           ("3050" in lower_text and "3050" in alias_lower) or \
           ("老家" in lower_text and "老家" in alias_lower) or \
           ("mac" in lower_text and "mac" in alias_lower):
            target_node = nid
            break

    # 2. 判断动作意图
    if any(kw in task_text for kw in ["剪视频", "做视频", "视频剪辑", "短视频", "生成视频", "剪映"]):
        action = "video_factory"
        payload = {"topic": task_text}
        # 默认优先指派给性能怪物 M4 或 3050，若未指定机器
        if target_node == "all":
            for nid in online_workers:
                if "m4" in nid.lower() or "3050" in nid.lower():
                    target_node = nid
                    break

    elif any(kw in task_text for kw in ["查一下", "搜索", "查网页", "打开网页", "抓取", "爬一下"]):
        action = "browser_agent"
        payload = {"prompt": task_text}

    elif "锁屏" in task_text or "休眠" in task_text or "睡眠" in task_text:
        action = "lock_screen"
        payload = {}
    elif "打开" in task_text or "启动" in task_text:
        action = "launch_app"
        # 提取应用名
        app_name = "code"
        for kw in ["claude code", "claude", "cursor", "vscode", "chrome", "浏览器", "微信", "终端", "terminal"]:
            if kw in lower_text:
                app_name = kw
                break
        payload = {"app": app_name}
    elif "执行" in task_text or "运行" in task_text:
        action = "run_command"
        cmd = task_text.replace("执行", "").replace("运行", "").strip()
        payload = {"cmd": cmd}
    else:
        action = "type_text"
        payload = {"text": task_text, "enter": True}

    task_id = f"cmd_{int(time.time()*1000)}"
    package = {
        "token": CLUSTER_TOKEN,
        "task_id": task_id,
        "action": action,
        "payload": payload,
        "raw_prompt": task_text,
        "time": time.time()
    }

    alias = online_workers.get(target_node, {}).get("alias", target_node)
    
    # 飞书任务开工通知
    try:
        from skills.feishu_sync.engine import FeishuSyncEngine
        FeishuSyncEngine.notify_task_start(task_id, task_text, alias)
    except Exception:
        pass

    if target_node == "all":
        topic = f"ghostdesk/{CLUSTER_ID}/broadcast/task"
        log(f"🚀 [广播派活] -> 所有电脑广播: [{action}] {payload}")
    else:
        topic = f"ghostdesk/{CLUSTER_ID}/node/{target_node}/task"
        log(f"🚀 [定向派活] -> 电脑【{alias}】: [{action}] {payload}")

    client.publish(topic, json.dumps(package, ensure_ascii=False))

def keep_mac_awake():
    """如果在 macOS 上作为服务器运行，调用系统的 caffeinate 防止合盖休眠"""
    if sys.platform == "darwin":
        import subprocess
        log("🛡️ [Mac 专属守护] 正在启用系统级防休眠锁 (支持合盖持续当服务器运行)...")
        try:
            subprocess.Popen(["caffeinate", "-dims"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

def main():
    print("==================================================================", flush=True)
    print(f"👑 GhostDesk 分布式中央网关中枢服务器 (Hub Master)", flush=True)
    print(f"🏠 当前中枢机: [{HUB_NAME}]", flush=True)
    print(f"☁️  云端中继总线: [{BROKER}:{PORT}]", flush=True)
    print(f"🔐 集群专属频道: [{CLUSTER_ID}]", flush=True)
    print("==================================================================", flush=True)

    keep_mac_awake()

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"ghost_hub_{int(time.time())}")
    client.on_connect = on_connect
    client.on_message = on_message

    client.connect(BROKER, PORT, 60)
    
    # 开启网络监听线程
    client.loop_start()

    log("✨ 中枢服务器运转中，等待各异地电脑连接与语音对讲指令...")
    log("💡 在本控制台输入 'status' 可随时查看各电脑在线情况，输入指令可直接手动派活，输入 'exit' 退出。")

    try:
        while True:
            cmd = input().strip()
            if not cmd:
                continue
            if cmd in ["exit", "quit"]:
                break
            elif cmd in ["status", "list", "ls"]:
                now = time.time()
                log("--- 📊 当前异地电脑在线状态表 ---")
                for nid, info in online_workers.items():
                    state = "🟢 在线" if (now - info["last_seen"] < 35) else "⚪ 离线"
                    log(f"  {state} [{nid}] -> {info['alias']} ({info['platform']})")
                if not online_workers:
                    log("  (暂无节点在线)")
                log("---------------------------------")
            else:
                route_and_dispatch(client, cmd)
    except (KeyboardInterrupt, EOFError):
        pass

    client.loop_stop()
    log("中枢已安全停机。")

if __name__ == "__main__":
    main()
