from typing import Dict, Any
from mcp_tools.base_tool import BaseMcpTool
from skills.hardware_adapter import HardwareDriverAdapter

class DesktopActionTool(BaseMcpTool):
    """物理在环底层桌面键盘与窗口操作工具"""

    @property
    def name(self) -> str:
        return "ghostdesk_desktop_action"

    @property
    def description(self) -> str:
        return (
            "通过外接 Pico H 物理外设或系统底层驱动向当前前台窗口注入击键与文字，"
            "具备高抗风控与防封号特性，不受管理员权限弹窗限制。"
        )

    @property
    def input_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "要输入的文字内容"
                },
                "auto_enter": {
                    "type": "boolean",
                    "default": False,
                    "description": "输入完毕后是否自动敲击回车"
                }
            },
            "required": ["text"]
        }

    def execute(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        text = arguments.get("text", "")
        auto_enter = arguments.get("auto_enter", False)
        HardwareDriverAdapter.type_text(text, auto_enter=auto_enter)
        return {
            "status": "success",
            "message": f"已向活动窗口注入文字 ({len(text)} 字)",
            "is_physical_hardware": HardwareDriverAdapter.is_physical_hardware()
        }
