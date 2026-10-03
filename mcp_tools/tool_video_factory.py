from typing import Dict, Any
from mcp_tools.base_tool import BaseMcpTool
from skills.video_factory.engine import VideoFactoryEngine

class VideoFactoryTool(BaseMcpTool):
    """短视频全自动内容工厂与 CapCut / 剪映工程构建工具 (全球出海版)"""

    @property
    def name(self) -> str:
        return "ghostdesk_video_factory"

    @property
    def description(self) -> str:
        return (
            "全球短视频全自动内容工厂：支持单条文案直出，或根据出海电商商品一键批量裂变 3~5 条不同爆款风格的短视频，"
            "全自动生成超拟人配音、对齐精确时间戳字幕，并在 CapCut (海外版) 与 剪映 Pro (国内版) 本地草稿目录生成官方原生工程。"
        )

    @property
    def input_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": ["single", "batch_campaign"],
                    "default": "single",
                    "description": "模式选择：single(单条指定文案成片), batch_campaign(输入商品和卖点批量裂变多条 CapCut/剪映 工程)"
                },
                "product_name": {
                    "type": "string",
                    "description": "当 mode=batch_campaign 时传入的商品名称（例如: Wireless Earbuds, 便携筋膜枪）"
                },
                "selling_points": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "当 mode=batch_campaign 时传入的核心卖点列表（例如: ['IP68防水', '超长续航', '降噪高保真']）"
                },
                "lang": {
                    "type": "string",
                    "enum": ["en", "zh", "id", "es", "ja", "de", "fr", "ar"],
                    "default": "en",
                    "description": "目标出海语种：en(欧美最火爆款配音), id(东南亚印尼语), zh(中文), es(西语/拉美), ar(中东阿语)"
                },
                "count": {
                    "type": "integer",
                    "default": 3,
                    "description": "当 mode=batch_campaign 时批量生成的短视频工程数量（默认3条）"
                },
                "topic_or_script": {
                    "type": "string",
                    "description": "当 mode=single 时传入的短视频主题或直接给定的口播解说词"
                },
                "voice": {
                    "type": "string",
                    "description": "可选自定义特定配音声音（如 zh-CN-YunxiNeural, en-US-JennyNeural）"
                }
            }
        }

    def execute(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        mode = arguments.get("mode", "single")
        lang = arguments.get("lang", "en")
        
        if mode == "batch_campaign":
            product = arguments.get("product_name") or arguments.get("topic_or_script") or "Viral Trending Product"
            points = arguments.get("selling_points", [])
            count = int(arguments.get("count", 3))
            return VideoFactoryEngine.batch_create_campaign(product_name=product, selling_points=points, lang=lang, count=count)
        else:
            topic = arguments.get("topic_or_script", "")
            voice = arguments.get("voice")
            return VideoFactoryEngine.process_task(topic, voice=voice, lang=lang)
