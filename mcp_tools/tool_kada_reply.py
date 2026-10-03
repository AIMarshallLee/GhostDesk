from typing import Dict, Any
from mcp_tools.base_tool import BaseMcpTool
from skills.kada_reply.engine import KadaReplyEngine

class KadaReplyTool(BaseMcpTool):
    """'咔哒' 智能客户回复与微信/私信转化工具"""

    @property
    def name(self) -> str:
        return "ghostdesk_kada_reply"

    @property
    def description(self) -> str:
        return (
            "调用'咔哒'客服大脑，针对意向客户的咨询内容智能生成高情商话术，"
            "并通过物理防封驱动向当前激活的微信或私信窗口敲入并发送。"
        )

    @property
    def input_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "customer_name": {
                    "type": "string",
                    "description": "客户昵称"
                },
                "inquiry": {
                    "type": "string",
                    "description": "客户咨询的问题或留言内容"
                },
                "target_window": {
                    "type": "string",
                    "description": "可选：目标软件窗口标题（如 '微信', '小红书', '记事本'），为空则向当前激活窗口发送"
                },
                "target_chat_name": {
                    "type": "string",
                    "description": "可选：聊天窗口内部会话名称（如 '高意向线索跟进群'），系统将自动触发 Ctrl+F 搜索定位"
                },
                "auto_send": {
                    "type": "boolean",
                    "default": True,
                    "description": "是否自动敲击回车发送"
                }
            },
            "required": ["customer_name", "inquiry"]
        }

    def execute(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        user = arguments.get("customer_name", "客户")
        inquiry = arguments.get("inquiry", "")
        target_win = arguments.get("target_window")
        target_chat = arguments.get("target_chat_name")
        auto_send = arguments.get("auto_send", True)
        
        reply = KadaReplyEngine.generate_reply_text(user, inquiry)
        res = KadaReplyEngine.dispatch_reply_to_chat(
            reply, 
            target_window=target_win, 
            target_chat_name=target_chat, 
            auto_send=auto_send
        )
        return {
            "reply_text": reply,
            "target_window": target_win,
            "target_chat": target_chat,
            "dispatch_result": res
        }
