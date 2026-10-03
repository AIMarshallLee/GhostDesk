from abc import ABC, abstractmethod
from typing import Dict, Any

class BaseMcpTool(ABC):
    """GhostDesk 标准 MCP 工具基类"""

    @property
    @abstractmethod
    def name(self) -> str:
        """工具唯一标识符 (例如: ghostdesk_lead_capture)"""
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        """向大模型解释该工具的功能、适用场景与返回值"""
        pass

    @property
    @abstractmethod
    def input_schema(self) -> Dict[str, Any]:
        """标准的 JSON Schema 参数定义"""
        pass

    @abstractmethod
    def execute(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """执行该工具的具体逻辑，返回结构化结果字典"""
        pass

    def to_mcp_definition(self) -> Dict[str, Any]:
        """转换为标准 MCP 协议格式"""
        return {
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input_schema
        }
