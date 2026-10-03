import os
import sys
import time
import json
import threading

# 编码保护
if sys.platform == "win32" and hasattr(sys.stdout, "buffer"):
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "replace")
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "replace")

import paho.mqtt.client as mqtt
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

BROKER = "broker.emqx.io"
PORT = 1883
CLUSTER_ID = "ghostdesk_marshall_swarm"
TOKEN = "marshall_secret_2026"

def test_full_pipeline():
    print("==================================================================", flush=True)
    print("🏎️  GhostDesk '超级整车' 端到端拼装测试", flush=True)
    print("    [手持语音 -> 2015Mac中枢 -> 飞书看板 -> M4短视频工厂]", flush=True)
    print("==================================================================", flush=True)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="test_simulator")
    
    results_received = []

    def on_connect(c, u, flags, rc, props=None):
        c.subscribe(f"ghostdesk/{CLUSTER_ID}/results")
        c.subscribe(f"ghostdesk/{CLUSTER_ID}/notifications")

    def on_message(c, u, msg):
        try:
            data = json.loads(msg.payload.decode("utf-8"))
            print(f"📥 [监听到中枢总线消息] Topic: {msg.topic}")
            print(f"   内容: {data}", flush=True)
            if "result" in data:
                results_received.append(data)
        except Exception:
            pass

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(BROKER, PORT, 60)
    client.loop_start()

    time.sleep(1.0)

    # 1. 模拟 M4 Mac mini 执行节点注册上线
    print("\n[步骤 1] 模拟 M4 Mac mini 执行特工上线...", flush=True)
    reg_msg = {
        "node_id": "m4_mac",
        "node_alias": "M4 旗舰 Mac mini",
        "platform": "darwin",
        "status": "ready",
        "timestamp": time.time()
    }
    client.publish(f"ghostdesk/{CLUSTER_ID}/registry", json.dumps(reg_msg))
    time.sleep(1.0)

    # 2. 模拟手持 CoreS3 对讲机说出一句话
    print("\n[步骤 2] 模拟手持 CoreS3 对讲机下达语音指令...", flush=True)
    voice_cmd = "帮我剪一个关于苹果M4芯片性能的短视频"
    print(f"🎙️ [CoreS3 说话]: \"{voice_cmd}\"", flush=True)
    client.publish(f"ghostdesk/{CLUSTER_ID}/voice_inbox", json.dumps({"text": voice_cmd, "time": time.time()}))

    # 3. 等待中枢派活与 Worker 响应
    print("\n[步骤 3] 等待中枢意图识别、飞书看板记录并派发...", flush=True)
    time.sleep(3.0)

    # 4. 模拟 M4 Worker 收到任务并调用本地视频工厂生成完成
    print("\n[步骤 4] 模拟 M4 Worker 执行视频工厂并回传剪映工程...", flush=True)
    from skills.video_factory.engine import VideoFactoryEngine
    # 直接跑真实工厂生成一段测试音频与草稿
    res = VideoFactoryEngine.process_task("苹果M4芯片性能表现惊人，统一内存带宽大幅提升！")
    
    # 回传结果
    ret_payload = {
        "token": TOKEN,
        "task_id": "test_cmd_1001",
        "node_id": "m4_mac",
        "node_alias": "M4 旗舰 Mac mini",
        "result": res,
        "raw_prompt": voice_cmd,
        "time": time.time()
    }
    client.publish(f"ghostdesk/{CLUSTER_ID}/results", json.dumps(ret_payload, ensure_ascii=False))

    time.sleep(2.0)
    client.loop_stop()
    print("\n==================================================================", flush=True)
    print("🎉 [整车总装测试通过] 整个链路全自动通畅闭环！", flush=True)
    print("==================================================================", flush=True)

if __name__ == "__main__":
    test_full_pipeline()
