from typing import Dict, Any
from mcp_tools.base_tool import BaseMcpTool
from skills.influencer_agent.engine import InfluencerOutreachEngine

class InfluencerAgentTool(BaseMcpTool):
    """GhostDesk 海外带货达人建联与挖掘特工工具"""

    @property
    def name(self) -> str:
        return "ghostdesk_influencer_agent"

    @property
    def description(self) -> str:
        return (
            "专为跨境出海品牌与卖家（TikTok Shop / 独立站 / 亚马逊）打造的海外带货达人建联与挖掘特工。"
            "根据出海品类智能匹配高权重、高带货投产比的海外网红（TikTok/Instagram），"
            "全自动生成个性化高转化率邀约信与移动端私信 (DM)，生成三步自动跟进序列 (Day 1 / Day 3 / Day 7)，"
            "并一键导出企业级达人合作与样品追踪 CRM 看板 (.xlsx)。"
        )

    @property
    def input_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "product_name": {
                    "type": "string",
                    "description": "出海商品名称（如: 4K Smart Projector, Wireless Noise Cancelling Earbuds, Cozy Bedding Set）"
                },
                "niche": {
                    "type": "string",
                    "enum": ["tech", "home", "beauty", "fitness", "auto"],
                    "default": "auto",
                    "description": "目标赛道分类，选 'auto' 则系统根据商品名称自动识别匹配"
                },
                "count": {
                    "type": "integer",
                    "default": 3,
                    "description": "需要挖掘与生成邀约的海外达人数量"
                },
                "brand_name": {
                    "type": "string",
                    "default": "AuraTech",
                    "description": "出海品牌名称"
                },
                "commission_rate": {
                    "type": "integer",
                    "default": 20,
                    "description": "承诺给达人的带货佣金比例 (如 20 代表 20%)"
                }
            },
            "required": ["product_name"]
        }

    def execute(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        product = arguments.get("product_name", "")
        niche = arguments.get("niche", "auto")
        if niche == "auto":
            niche = ""
        count = int(arguments.get("count", 3))
        brand = arguments.get("brand_name", "AuraTech")
        commission = int(arguments.get("commission_rate", 20))

        return InfluencerOutreachEngine.run_pipeline(
            product_name=product,
            niche=niche,
            count=count,
            brand_name=brand,
            commission_rate=commission
        )
