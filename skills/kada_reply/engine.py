import os
import sys
import time
import json
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT_DIR))

from skills.hardware_adapter import HardwareDriverAdapter

class KadaReplyEngine:
    """GhostDesk '咔哒' 智能客户回复与微信私信转化引擎"""

    DEFAULT_TEMPLATES = {
        "price": "您好呀！这款支持手持语音和多电脑远程控制的对讲机系统，开源版可以直接免费用，整机开箱即用的硬件款目前特惠中，已私信发您详细配置啦~",
        "cooperation": "老板好！感谢关注，我们支持多台电脑矩阵管理与定制部署，已加您微信详聊！",
        "default": "您好！看到您的留言啦，稍后我将详细使用指南私信给您，请留意右上角消息提醒哦~"
    }

    @classmethod
    def generate_reply_text(cls, customer_name: str, inquiry_text: str) -> str:
        """根据客户咨询语义智能生成针对性回复话术"""
        lower = inquiry_text.lower()
        if "多少钱" in lower or "价格" in lower or "求链接" in lower:
            body = cls.DEFAULT_TEMPLATES["price"]
        elif "合作" in lower or "代理" in lower or "采购" in lower:
            body = cls.DEFAULT_TEMPLATES["cooperation"]
        else:
            body = cls.DEFAULT_TEMPLATES["default"]

        return f"@{customer_name} {body}"

    @classmethod
    def format_lead_card(cls, lead: dict) -> str:
        """根据线索数据生成格式化线索播报卡片（用于推送销售跟进群）"""
        user = lead.get("user", "匿名访客")
        platform = lead.get("platform", "社交平台")
        contact = lead.get("contact") or "未留电话/私信沟通"
        inquiry = lead.get("comment", "")
        reply = lead.get("recommended_reply", "")
        return (
            f"【{platform}高意向新线索】\n"
            f"👤 客户: {user}\n"
            f"📱 电话/微信: {contact}\n"
            f"💬 咨询内容: {inquiry}\n"
            f"💡 推荐话术: {reply}\n"
            f"⏰ 捕获时间: {time.strftime('%H:%M:%S')}"
        )

    @classmethod
    def focus_window(cls, title_keyword: str) -> bool:
        """在前台寻找并激活包含特定关键词的窗口"""
        try:
            import pygetwindow as gw
            windows = gw.getWindowsWithTitle(title_keyword)
            if windows:
                win = windows[0]
                if win.isMinimized:
                    win.restore()
                win.activate()
                time.sleep(0.3)
                print(f"🎯 [咔哒回复] 成功聚焦目标窗口: 【{win.title}】", flush=True)
                return True
        except Exception as e:
            print(f"⚠️ [咔哒回复] 窗口聚焦跳过/未找到: {e}")
        return False

    @classmethod
    def dispatch_reply_to_chat(
        cls, 
        reply_text: str, 
        target_window: str = None, 
        target_chat_name: str = None, 
        auto_send: bool = True
    ) -> dict:
        """
        向指定窗口或当前激活的聊天窗口敲入并发送回复
        - target_window: 窗口标题关键词（如 '微信', '小红书', '记事本'）
        - target_chat_name: 聊天会话名（如指定，先触发 Ctrl+F 搜索定位群聊）
        """
        if target_window:
            cls.focus_window(target_window)

        if target_chat_name:
            print(f"🔍 [咔哒回复] 尝试定位内部会话: 【{target_chat_name}】", flush=True)
            try:
                import pyautogui
                # 触发微信/企业微信内部搜索 Ctrl+F
                pyautogui.hotkey('ctrl', 'f')
                time.sleep(0.3)
                HardwareDriverAdapter.type_text(target_chat_name, auto_enter=True)
                time.sleep(0.5)
            except Exception as e:
                print(f"⚠️ 会话定位跳过: {e}")

        print(f"\n💬 [咔哒回复] 准备向当前会话输入话术: \"{reply_text[:35]}...\"", flush=True)
        try:
            # 调用底层硬件自适应驱动打字
            HardwareDriverAdapter.type_text(reply_text, auto_enter=auto_send)
            print("✅ [咔哒回复] 话术已成功键入并发送！", flush=True)
            return {"status": "ok", "message": f"成功回复: {reply_text[:20]}..."}
        except Exception as e:
            print(f"❌ [咔哒回复] 输入遇阻: {e}", flush=True)
            return {"status": "error", "message": str(e)}

    @classmethod
    def dispatch_reply_to_active_chat(cls, reply_text: str, auto_send: bool = True) -> dict:
        return cls.dispatch_reply_to_chat(reply_text, auto_send=auto_send)


if __name__ == "__main__":
    test_reply = KadaReplyEngine.generate_reply_text("电商老李", "求链接！这个对讲机一套多少钱？")
    print("生成话术:\n", test_reply)
    # 模拟敲入
    # KadaReplyEngine.dispatch_reply_to_active_chat(test_reply, auto_send=False)
