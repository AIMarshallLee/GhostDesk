import importlib
import inspect
from pathlib import Path
from typing import Dict, List, Any
from mcp_tools.base_tool import BaseMcpTool

class McpToolRegistry:
    """GhostDesk MCP 插件自动探查与注册总线"""

    def __init__(self):
        self._tools: Dict[str, BaseMcpTool] = {}
        self.auto_discover()

    def auto_discover(self):
        """自动扫描当前目录下所有以 tool_ 开头的模块并注册其中的 BaseMcpTool 类"""
        tools_dir = Path(__file__).resolve().parent
        for py_file in tools_dir.glob("tool_*.py"):
            mod_name = f"mcp_tools.{py_file.stem}"
            try:
                module = importlib.import_module(mod_name)
                for attr_name in dir(module):
                    attr = getattr(module, attr_name)
                    if inspect.isclass(attr) and issubclass(attr, BaseMcpTool) and attr is not BaseMcpTool:
                        tool_instance = attr()
                        self.register_tool(tool_instance)
            except Exception as e:
                print(f"⚠️ [MCP Registry] 动态加载插件 [{py_file.name}] 失败: {e}")

        # 静态硬化兜底：保证 PyInstaller 打包脱离源码环境后 100% 加载所有工具
        known_modules = [
            "tool_capability_governor",
            "tool_lead_capture",
            "tool_kada_reply",
            "tool_video_factory",
            "tool_sop_executor",
            "tool_wechat_publisher",
            "tool_feishu_sync",
            "tool_smart_reply",
            "tool_trade_order_agent",
            "tool_influencer_agent"
        ]
        for stem in known_modules:
            mod_name = f"mcp_tools.{stem}"
            try:
                module = importlib.import_module(mod_name)
                for attr_name in dir(module):
                    attr = getattr(module, attr_name)
                    if inspect.isclass(attr) and issubclass(attr, BaseMcpTool) and attr is not BaseMcpTool:
                        tool_instance = attr()
                        if tool_instance.name not in self._tools:
                            self.register_tool(tool_instance)
            except Exception:
                pass

    def register_tool(self, tool: BaseMcpTool):
        self._tools[tool.name] = tool
        # print(f"🔌 [MCP Registry] 已挂载标准工具: {tool.name}")

    def get_tool(self, name: str) -> BaseMcpTool:
        return self._tools.get(name)

    def list_tool_definitions(self) -> List[Dict[str, Any]]:
        return [tool.to_mcp_definition() for tool in self._tools.values()]

    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        tool = self.get_tool(name)
        if not tool:
            return {"isError": True, "error": f"找不到工具: {name}"}
        try:
            res = tool.execute(arguments)
            return {"isError": False, "result": res}
        except Exception as e:
            return {"isError": True, "error": str(e)}

# 全局单例
registry = McpToolRegistry()
