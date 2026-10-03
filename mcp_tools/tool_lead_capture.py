from typing import Dict, Any
from mcp_tools.base_tool import BaseMcpTool
from skills.lead_capture.engine import LeadCaptureEngine

class LeadCaptureTool(BaseMcpTool):
    """小红书/抖音/视频号评论区客户截流与线索提取工具"""

    @property
    def name(self) -> str:
        return "ghostdesk_lead_capture"

    @property
    def description(self) -> str:
        return (
            "在小红书、抖音、视频号等平台评论区进行高意向客户截流与线索挖掘。"
            "能够自动识别求购、询价、求合作评论，提取手机号、微信号并格式化归档。"
        )

    @property
    def input_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "platform": {
                    "type": "string",
                    "enum": ["小红书", "抖音", "视频号", "快手"],
                    "default": "小红书",
                    "description": "目标社交/电商平台"
                },
                "mode": {
                    "type": "string",
                    "enum": ["comments", "raw_text", "clipboard", "search_browser", "live_url"],
                    "default": "comments",
                    "description": "截流模式: live_url(利用DrissionPage真实抓取指定网址), comments(结构化列表), raw_text(直接传复制的杂乱多行文本), clipboard(从Windows剪贴板自动提取), search_browser(自动打开浏览器定位搜索)"
                },
                "url": {
                    "type": "string",
                    "description": "当 mode=live_url 时传入目标网页/博文地址"
                },
                "comments": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "user": {"type": "string", "description": "评论者昵称"},
                            "text": {"type": "string", "description": "评论原文"}
                        },
                        "required": ["user", "text"]
                    },
                    "description": "当 mode=comments 时传入待扫描的评论列表"
                },
                "raw_text": {
                    "type": "string",
                    "description": "当 mode=raw_text 时传入从网页/App复制的杂乱评论全文"
                },
                "keyword": {
                    "type": "string",
                    "description": "当 mode=search_browser 时传入搜索关键词"
                }
            }
        }

    def execute(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        platform = arguments.get("platform", "小红书")
        mode = arguments.get("mode", "comments")

        if mode == "live_url":
            target_url = arguments.get("url", "")
            return LeadCaptureEngine.scrape_url_live(target_url, platform)
        elif mode == "clipboard":
            return LeadCaptureEngine.capture_from_clipboard(platform)
        elif mode == "search_browser":
            kw = arguments.get("keyword", "对讲机")
            return LeadCaptureEngine.open_platform_search(platform, kw)
        elif mode == "raw_text":
            text = arguments.get("raw_text", "")
            parsed_comments = LeadCaptureEngine.parse_raw_text(text)
            return LeadCaptureEngine.process_leads_batch(platform, parsed_comments)
        else:
            comments = arguments.get("comments", [])
            return LeadCaptureEngine.process_leads_batch(platform, comments)


