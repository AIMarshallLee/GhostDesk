from typing import Dict, Any
from mcp_tools.base_tool import BaseMcpTool
from skills.trade_order_agent.engine import TradeOrderAgent

class TradeOrderAgentTool(BaseMcpTool):
    """GhostDesk 24小时外贸智能接单与抢单特工工具"""

    @property
    def name(self) -> str:
        return "ghostdesk_trade_order_agent"

    @property
    def description(self) -> str:
        return (
            "专为跨境出海企业与工贸工厂打造的 24 小时外贸智能抢单与报价特工。"
            "零时差实时解析海外客户（WhatsApp / 邮件）询盘，结合工厂阶梯底价与起订量 (MOQ) 自动计算报价，"
            "瞬间生成地道海外商务话术 (WhatsApp即发短报 + 正式商业邮件公函)，并全自动导出企业级英文形式发票/报价单 Excel。"
        )

    @property
    def input_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "inquiry_text": {
                    "type": "string",
                    "description": "海外买家发来的询盘内容或聊天记录（例如: 'What is your best price for 500 pcs smart watch shipped to California?'）"
                },
                "customer_name": {
                    "type": "string",
                    "default": "Client",
                    "description": "海外客户姓名或买家称呼"
                }
            },
            "required": ["inquiry_text"]
        }

    def execute(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        inquiry = arguments.get("inquiry_text", "")
        customer = arguments.get("customer_name", "Client")
        return TradeOrderAgent.process_inquiry(inquiry_text=inquiry, customer_name=customer)
