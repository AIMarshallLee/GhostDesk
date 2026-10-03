import os
import sys
import json
import time
from pathlib import Path

# 编码保护
if sys.platform == "win32" and hasattr(sys.stdout, "buffer"):
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "replace")
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "replace")

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
CONFIG_FILE = ROOT_DIR / "feishu_config.json"
LOG_DIR = ROOT_DIR / "dist" / "feishu_logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_CONFIG = {
    "webhook_url": "", # 填入你的飞书自定义群机器人 Webhook 地址
    "enable_feishu": True,
    "notify_on_start": True,
    "notify_on_complete": True
}

def load_feishu_config():
    if not CONFIG_FILE.exists():
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_CONFIG, f, indent=2, ensure_ascii=False)
        return DEFAULT_CONFIG
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return DEFAULT_CONFIG

CONFIG = load_feishu_config()

class FeishuSyncEngine:
    """GhostDesk 飞书机器人通知与多维表格数据同步引擎"""

    @classmethod
    def send_bot_card(cls, title: str, content: str, fields: list = None, color: str = "blue"):
        """向飞书群机器人发送标准化交互卡片"""
        webhook = CONFIG.get("webhook_url", "").strip()
        
        # 始终记录本地流水账日志 (可直接一键导入飞书多维表格)
        cls._append_local_bitable_log(title, content, fields)

        if not webhook:
            print(f"📋 [飞书同步] 未配置飞书 Webhook，已在本地多维表格日志中归档: [{title}]", flush=True)
            return {"status": "logged_local", "message": "已归档至本地日志"}

        import requests
        card_payload = {
            "msg_type": "interactive",
            "card": {
                "header": {
                    "title": {"tag": "plain_text", "content": title},
                    "template": color # blue, green, red, orange
                },
                "elements": [
                    {
                        "tag": "div",
                        "text": {"tag": "lark_md", "content": content}
                    }
                ]
            }
        }

        if fields:
            elements_fields = []
            for k, v in fields:
                elements_fields.append({"is_short": True, "text": {"tag": "lark_md", "content": f"**{k}**: {v}"}})
            card_payload["card"]["elements"].append({
                "tag": "div",
                "fields": elements_fields
            })

        try:
            res = requests.post(webhook, json=card_payload, timeout=5)
            print(f"📲 [飞书通知] 成功向飞书群推送卡片: {title}", flush=True)
            return res.json()
        except Exception as e:
            print(f"⚠️ [飞书通知] 推送失败: {e}")
            return {"status": "error", "message": str(e)}

    @classmethod
    def notify_task_start(cls, task_id: str, prompt: str, target_node: str):
        fields = [
            ("任务编号", task_id),
            ("执行电脑", target_node),
            ("下达时间", time.strftime("%Y-%m-%d %H:%M:%S"))
        ]
        return cls.send_bot_card("⚡ GhostDesk 任务派发中", f"**用户指令**: {prompt}", fields, "blue")

    @classmethod
    def notify_task_complete(cls, task_id: str, prompt: str, target_node: str, result_msg: str):
        fields = [
            ("任务编号", task_id),
            ("执行电脑", target_node),
            ("完成时间", time.strftime("%Y-%m-%d %H:%M:%S")),
            ("执行状态", "✅ 成功")
        ]
        return cls.send_bot_card("🎉 GhostDesk 任务圆满完成", f"**指令原文**: {prompt}\n**成果结果**: {result_msg}", fields, "green")

    @classmethod
    def append_bitable_record(cls, record_data: dict):
        """通用多维表格本地流水追加接口"""
        log_file = LOG_DIR / "bitable_records.jsonl"
        record = {
            "timestamp": time.time(),
            "time_str": time.strftime("%Y-%m-%d %H:%M:%S"),
            **record_data
        }
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    @classmethod
    def _append_local_bitable_log(cls, title: str, content: str, fields: list = None):
        cls.append_bitable_record({
            "title": title,
            "content": content,
            "fields": dict(fields) if fields else {}
        })


if __name__ == "__main__":
    FeishuSyncEngine.notify_task_start("task_001", "剪一个关于苹果M4的视频", "M4 Mac mini")
    time.sleep(1.0)
    FeishuSyncEngine.notify_task_complete("task_001", "剪一个关于苹果M4的视频", "M4 Mac mini", "已生成高清音频与剪映草稿工程")
