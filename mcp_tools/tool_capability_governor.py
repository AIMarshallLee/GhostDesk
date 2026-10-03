from typing import Dict, Any
from mcp_tools.base_tool import BaseMcpTool
from skills.capability_governor import CapabilityGovernor

class CapabilityGovernorTool(BaseMcpTool):
    """GhostDesk 宿主环境体检、开源能力雷达与优先级决策引擎"""

    @property
    def name(self) -> str:
        return "ghostdesk_capability_governor"

    @property
    def description(self) -> str:
        return (
            "对当前电脑环境（系统、剪映、微信、磁盘空间）进行全方位体检，"
            "扫描高星高Fork开源工具库，并依据电脑实际负荷智能给出当前'应专心做透的核心能力'与'建议先放一边的能力'决策报告。"
        )

    @property
    def input_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["evaluate", "inspect_machine", "view_radar"],
                    "default": "evaluate",
                    "description": "操作类型：evaluate(综合决策与优先级评估), inspect_machine(单纯检测电脑硬件/软件态), view_radar(查看高星高Fork开源工具库)"
                }
            }
        }

    def execute(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        action = arguments.get("action", "evaluate")
        if action == "inspect_machine":
            return {"status": "success", "machine": CapabilityGovernor.inspect_current_machine()}
        elif action == "view_radar":
            return {"status": "success", "radar": CapabilityGovernor.RADAR_DATABASE}
        else:
            return {"status": "success", "roadmap": CapabilityGovernor.evaluate_priority_roadmap()}
