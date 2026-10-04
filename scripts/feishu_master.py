import os
import sys
import time
import json
import socket
import threading
import requests
from http.server import HTTPServer, BaseHTTPRequestHandler
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

def load_config():
    if not CONFIG_FILE.exists():
        default_cfg = {
            "broker": "broker.emqx.io",
            "port": 1883,
            "cluster_id": "ghostdesk_marshall_swarm",
            "cluster_token": "ghostdesk_marshall_2026",
            "feishu": {
                "enabled": False,
                "app_id": "",
                "app_secret": "",
                "default_chat_id": ""
            },
            "cores3_wifi": {
                "port": 4321
            }
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
FEISHU_CFG = CONFIG.get("feishu", {})
CORES3_PORT = CONFIG.get("cores3_wifi", {}).get("port", 4321)

TOPIC_REGISTRY = f"ghostdesk/{CLUSTER_ID}/registry"
TOPIC_RESULT = f"ghostdesk/{CLUSTER_ID}/results"

online_nodes = {}
latest_events = []
mqtt_client = None

# ==========================================
# 飞书 (Lark) OpenAPI 极速免依赖交互引擎
# ==========================================
class FeishuEngine:
    def __init__(self, app_id: str, app_secret: str):
        self.app_id = app_id
        self.app_secret = app_secret
        self.token = ""
        self.token_expire_time = 0

    def get_token(self) -> str:
        if not self.app_id or not self.app_secret:
            return ""
        if time.time() < self.token_expire_time:
            return self.token
        try:
            url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
            resp = requests.post(url, json={"app_id": self.app_id, "app_secret": self.app_secret}, timeout=5)
            data = resp.json()
            if data.get("code") == 0:
                self.token = data.get("tenant_access_token")
                self.token_expire_time = time.time() + data.get("expire", 7200) - 300
                return self.token
            else:
                print(f"⚠️ [Feishu] 获取 Token 失败: {data.get('msg')}")
        except Exception as e:
            print(f"⚠️ [Feishu] 网络连接失败: {e}")
        return ""

    def send_text(self, receive_id: str, text: str, id_type: str = "chat_id") -> bool:
        token = self.get_token()
        if not token or not receive_id:
            return False
        try:
            url = f"https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type={id_type}"
            headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"}
            body = {
                "receive_id": receive_id,
                "msg_type": "text",
                "content": json.dumps({"text": text}, ensure_ascii=False)
            }
            res = requests.post(url, headers=headers, json=body, timeout=5)
            return res.json().get("code") == 0
        except Exception as e:
            print(f"⚠️ [Feishu] 发送文字失败: {e}")
            return False

    def send_interactive_card(self, receive_id: str, title: str, content_lines: list, actions: list = None, id_type: str = "chat_id") -> bool:
        token = self.get_token()
        if not token or not receive_id:
            return False
        
        elements = []
        for line in content_lines:
            elements.append({
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": line
                }
            })

        if actions:
            action_elements = []
            for act in actions:
                btn_type = act.get("type", "primary") # primary / danger / default
                action_elements.append({
                    "tag": "button",
                    "text": {
                        "tag": "plain_text",
                        "content": act.get("text", "确认")
                    },
                    "type": btn_type,
                    "value": act.get("value", {})
                })
            elements.append({
                "tag": "action",
                "actions": action_elements
            })

        card = {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": title},
                "template": "blue"
            },
            "elements": elements
        }

        try:
            url = f"https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type={id_type}"
            headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"}
            body = {
                "receive_id": receive_id,
                "msg_type": "interactive",
                "content": json.dumps(card, ensure_ascii=False)
            }
            res = requests.post(url, headers=headers, json=body, timeout=5)
            return res.json().get("code") == 0
        except Exception as e:
            print(f"⚠️ [Feishu] 发送卡片失败: {e}")
            return False

    def send_webhook_card(self, webhook_url: str, title: str, content_lines: list) -> bool:
        if not webhook_url:
            return False
        elements = []
        for line in content_lines:
            elements.append({
                "tag": "div",
                "text": {"tag": "lark_md", "content": line}
            })
        card = {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": title},
                "template": "blue"
            },
            "elements": elements
        }
        try:
            res = requests.post(webhook_url, json={"msg_type": "interactive", "card": card}, timeout=5)
            return res.status_code == 200
        except Exception as e:
            print(f"⚠️ [Feishu Webhook] 推送失败: {e}")
            return False

feishu_engine = FeishuEngine(
    app_id=FEISHU_CFG.get("app_id", ""),
    app_secret=FEISHU_CFG.get("app_secret", "")
)

class FeishuWsHandler:
    def _do_without_validation(self, pl: bytes):
        try:
            data = json.loads(pl.decode("utf-8"))
            header = data.get("header", {})
            event_type = header.get("event_type", "")
            event = data.get("event", {})
            
            if event_type == "im.message.receive_v1":
                msg = event.get("message", {})
                chat_id = msg.get("chat_id", "")
                content_str = msg.get("content", "{}")
                content = json.loads(content_str)
                text = content.get("text", "").strip()
                
                # 自动记忆当前活跃对话窗口 ID，以便主动回传报告
                if chat_id and FEISHU_CFG.get("default_chat_id") != chat_id:
                    FEISHU_CFG["default_chat_id"] = chat_id
                    try:
                        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                            json.dump(CONFIG, f, indent=2, ensure_ascii=False)
                        print(f"📌 [Feishu] 自动锁定并记住对话窗口: {chat_id}", flush=True)
                    except Exception:
                        pass

                print(f"\n📱 [收到手机飞书指令] 「{text}」", flush=True)
                feishu_engine.send_text(chat_id, f"🫡 收到指令: 「{text}」，正在安排蜂群电脑执行...")
                parse_and_route_command(text, source=f"Feishu_App")
                print("> ", end="", flush=True)
        except Exception as e:
            print(f"⚠️ [Feishu WS] 处理事件异常: {e}", flush=True)

def start_feishu_ws():
    app_id = FEISHU_CFG.get("app_id", "")
    app_secret = FEISHU_CFG.get("app_secret", "")
    if not app_id or not app_secret or not FEISHU_CFG.get("enabled", False):
        return
    try:
        from lark_oapi.ws.client import Client
        cli = Client(app_id, app_secret, event_handler=FeishuWsHandler())
        print(f"🚀 [Feishu WS] 手机飞书 WebSocket 长连接监听已启动！", flush=True)
        cli.start()
    except Exception as e:
        print(f"⚠️ [Feishu WS] 启动长连接异常: {e}", flush=True)

# ==========================================
# 意图路由与分布式任务派发
# ==========================================
def dispatch_task(target: str, action: str, payload: dict, originator: str = "local") -> dict:
    global mqtt_client
    if not mqtt_client:
        return {"status": "error", "message": "MQTT 中枢未连接"}

    task_id = f"task_{int(time.time()*1000)}"
    task_payload = {
        "token": CLUSTER_TOKEN,
        "task_id": task_id,
        "action": action,
        "payload": payload,
        "originator": originator,
        "timestamp": time.time()
    }

    if target == "all":
        topic = f"ghostdesk/{CLUSTER_ID}/broadcast/task"
        print(f"🚀 [广播派发] -> 向所有在线电脑广播任务 [{action}]: {payload}", flush=True)
    else:
        topic = f"ghostdesk/{CLUSTER_ID}/node/{target}/task"
        print(f"🚀 [定向派发] -> 向电脑【{target}】派发任务 [{action}]: {payload}", flush=True)

    mqtt_client.publish(topic, json.dumps(task_payload, ensure_ascii=False))
    return {"status": "ok", "task_id": task_id, "target": target}

def parse_and_route_command(raw_text: str, source: str = "console"):
    """
    智能口语解析器：
    支持口语示例：
      - '帮我把办公室Win的代码拉取最新' -> office_win: run_command git pull
      - '给办公室Mac截个图' -> office_mac: screenshot
      - 'office: 打开 微信'
      - '所有电脑：锁屏'
    """
    text = raw_text.strip()
    if not text:
        return

    target = "all"
    action = "type_text"
    payload = {}

    # 1. 结构化前缀解析
    if ":" in text or "：" in text:
        delimiter = ":" if ":" in text else "："
        prefix, content = text.split(delimiter, 1)
        prefix = prefix.strip().lower()
        content = content.strip()

        matched_id = None
        for nid, info in online_nodes.items():
            if prefix in nid.lower() or prefix in info.get("alias", "").lower():
                matched_id = nid
                break
        target = matched_id if matched_id else prefix

        if content.startswith("打开 ") or content.startswith("open "):
            action = "launch_app"
            payload = {"app": content.replace("打开 ", "").replace("open ", "").strip()}
        elif "截图" in content or "screenshot" in content:
            action = "screenshot"
        elif "锁屏" in content or "休眠" in content:
            action = "lock_screen"
        elif content.startswith("执行 ") or content.startswith("run "):
            action = "run_command"
            payload = {"cmd": content.replace("执行 ", "").replace("run ", "").strip()}
        else:
            action = "type_text"
            payload = {"text": content, "enter": True}

    # 2. 自然口语意图提取
    elif "截图" in text:
        action = "screenshot"
        target = resolve_target_from_text(text)
    elif "锁屏" in text or "休眠" in text:
        action = "lock_screen"
        target = resolve_target_from_text(text)
    elif "拉取代码" in text or "更新代码" in text or "git pull" in text:
        action = "run_command"
        payload = {"cmd": "git pull"}
        target = resolve_target_from_text(text)
    elif "打开" in text:
        action = "launch_app"
        app = text.split("打开", 1)[1].strip()
        payload = {"app": app}
        target = resolve_target_from_text(text)
    else:
        action = "type_text"
        payload = {"text": text, "enter": False}

    dispatch_task(target, action, payload, originator=source)

def resolve_target_from_text(text: str) -> str:
    t_lower = text.lower()
    for nid, info in online_nodes.items():
        if nid.lower() in t_lower or info.get("alias", "").lower() in t_lower:
            return nid
    if "mac" in t_lower:
        for nid in online_nodes:
            if "mac" in nid.lower():
                return nid
        return "office_mac"
    if "win" in t_lower or "电脑" in t_lower:
        for nid in online_nodes:
            if "win" in nid.lower():
                return nid
        return "office_win"
    return "all"

# ==========================================
# CoreS3 WiFi 与本地 Web 接口网关
# ==========================================
class GatewayHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/status" or self.path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            active_list = []
            now = time.time()
            for nid, info in online_nodes.items():
                if now - info.get("last_seen", 0) < 30:
                    active_list.append(f"{info.get('alias', nid)}")
            
            summary_text = "🟢 " + " | ".join(active_list) if active_list else "⚪ 等待电脑上线"
            data = {
                "status": "ok",
                "cluster_id": CLUSTER_ID,
                "online_count": len(active_list),
                "summary": summary_text,
                "nodes": online_nodes,
                "latest_event": latest_events[-1] if latest_events else "就绪"
            }
            self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/api/voice_command":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            try:
                req = json.loads(body)
                text = req.get("text", "")
            except Exception:
                text = body.strip()

            print(f"🎙️ [CoreS3 WiFi] 收到随身对讲机语音指令: 「{text}」", flush=True)
            parse_and_route_command(text, source="CoreS3_WiFi")

            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "dispatched", "command": text}, ensure_ascii=False).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # 静默常规 HTTP 日志，保持控制台整洁
        pass

def run_http_server():
    server = HTTPServer(("0.0.0.0", CORES3_PORT), GatewayHandler)
    print(f"📡 CoreS3 WiFi 网关端口已监听: http://0.0.0.0:{CORES3_PORT}", flush=True)
    server.serve_forever()

# ==========================================
# MQTT 云端集群总线回调
# ==========================================
def on_mqtt_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f"✅ [Swarm Master] 成功连接至跨公网云端总线 [{BROKER}:{PORT}]", flush=True)
        print(f"📡 监听节点心跳汇聚: {TOPIC_REGISTRY}", flush=True)
        print(f"📡 监听任务执行回传: {TOPIC_RESULT}", flush=True)
        client.subscribe(TOPIC_REGISTRY)
        client.subscribe(TOPIC_RESULT)
    else:
        print(f"❌ [Swarm Master] 连接云端失败: {rc}", flush=True)

def on_mqtt_message(client, userdata, msg):
    try:
        data = json.loads(msg.payload.decode("utf-8"))
        if msg.topic == TOPIC_REGISTRY:
            node_id = data.get("node_id")
            is_new = node_id not in online_nodes
            online_nodes[node_id] = {
                "alias": data.get("node_alias", node_id),
                "platform": data.get("platform", "unknown"),
                "status": "online",
                "last_seen": time.time()
            }
            if is_new:
                alias = online_nodes[node_id]["alias"]
                print(f"\n🎉 [新电脑上线] 【{alias}】(ID: {node_id}) 已加入蜂群集群！", flush=True)
                print("> ", end="", flush=True)

        elif msg.topic == TOPIC_RESULT:
            task_id = data.get("task_id")
            alias = data.get("node_alias", "未知电脑")
            action = data.get("action", "")
            res = data.get("result", {})
            msg_text = res.get("message", "执行完毕")
            output = res.get("output", "")
            
            event_line = f"电脑【{alias}】完成 [{action}]: {msg_text}"
            latest_events.append(event_line)
            if len(latest_events) > 20:
                latest_events.pop(0)

            print(f"\n🔔 [执行结果回传] {event_line}", flush=True)
            if output:
                print(f"   输出明细: {output[:300]}...", flush=True)
            print("> ", end="", flush=True)

            # 自动通知手机飞书 (支持群 Webhook 或 自建应用 Bot)
            webhook_url = FEISHU_CFG.get("webhook_url", "")
            if webhook_url:
                feishu_engine.send_webhook_card(
                    webhook_url=webhook_url,
                    title=f"🤖 AI 员工执行报告 · {alias}",
                    content_lines=[
                        f"**任务编号**：`{task_id}`",
                        f"**执行动作**：`{action}`",
                        f"**结果反馈**：{msg_text}",
                        f"**详细输出**：\n```\n{output[:500] if output else '无控制台输出'}\n```"
                    ]
                )
            chat_id = FEISHU_CFG.get("default_chat_id", "")
            if FEISHU_CFG.get("enabled", False) and chat_id:
                feishu_engine.send_interactive_card(
                    receive_id=chat_id,
                    title=f"🤖 AI 员工执行报告 · {alias}",
                    content_lines=[
                        f"**任务编号**：`{task_id}`",
                        f"**执行动作**：`{action}`",
                        f"**结果反馈**：{msg_text}",
                        f"**详细输出**：\n```\n{output[:500] if output else '无控制台输出'}\n```"
                    ]
                )
    except Exception as e:
        pass

def main():
    global mqtt_client
    print("=" * 66, flush=True)
    print("👑 GhostDesk 全球多电脑自主 AI 员工总控中枢 (Master Gateway)")
    print(f"🔐 集群频道: [{CLUSTER_ID}]")
    print(f"☁️  云端中继: [{BROKER}:{PORT}]")
    print(f"📱 飞书通知: {'已启用 ✅' if FEISHU_CFG.get('enabled') else '待配置 (在 swarm_config.json 填入 AppID 即生效)'}")
    print("=" * 66, flush=True)

    # 启动 CoreS3 WiFi HTTP 监听服务
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()

    # 启动 飞书 WebSocket 长连接监听 (无需公网域名，手机实时收发)
    if FEISHU_CFG.get("enabled", False) and FEISHU_CFG.get("app_id"):
        ws_thread = threading.Thread(target=start_feishu_ws, daemon=True)
        ws_thread.start()

    # 启动 MQTT 总线通信
    mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"master_{int(time.time())}")
    mqtt_client.on_connect = on_mqtt_connect
    mqtt_client.on_message = on_mqtt_message
    mqtt_client.connect(BROKER, PORT, 60)
    mqtt_client.loop_start()

    time.sleep(1.0)
    print("\n💡 实时控制台已就绪，直接输入指令即可指挥全网电脑:")
    print("  • 输入 'status' 查看所有在线电脑状态")
    print("  • 输入 'office: 截图' 获取办公室电脑当前实时画面")
    print("  • 输入 'office: 执行 git pull' 远程更新代码")
    print("  • 输入 'all: 锁屏' 让所有电脑锁定屏幕")
    print("  • 输入 'exit' 退出\n")

    while True:
        try:
            line = input("> ").strip()
            if not line:
                continue
            if line in ["exit", "quit"]:
                break
            elif line in ["status", "list", "ls"]:
                now = time.time()
                print("\n================ 当前在线电脑蜂群 ================", flush=True)
                active = 0
                for nid, info in list(online_nodes.items()):
                    if now - info["last_seen"] < 30:
                        active += 1
                        print(f"  🟢 在线: [{nid}] - {info['alias']} ({info['platform']})", flush=True)
                    else:
                        print(f"  ⚪ 离线: [{nid}] - {info['alias']}", flush=True)
                if active == 0:
                    print("  ⚠️ 暂无在线电脑。在目标电脑上运行 python scripts/swarm_node.py 即可！", flush=True)
                print("===================================================\n", flush=True)
            else:
                parse_and_route_command(line, source="Console")
        except (KeyboardInterrupt, EOFError):
            break

    mqtt_client.loop_stop()
    print("中控调度器已安全退出。")

if __name__ == "__main__":
    main()
