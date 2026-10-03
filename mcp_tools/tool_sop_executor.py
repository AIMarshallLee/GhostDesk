from typing import Dict, Any
from mcp_tools.base_tool import BaseMcpTool
from skills.sop_runner import SopSkillRunner

class SopExecutorTool(BaseMcpTool):
    """GhostDesk 标准 SOP 业务流全自动调度与执行工具"""

    @property
    def name(self) -> str:
        return "ghostdesk_sop_executor"

    @property
    def description(self) -> str:
        return (
            "加载并全自动执行标准 Markdown SOP 业务流程（如小红书截流跟进、增值税发票下载导出、飞书请假审批等）。"
            "支持自适应多进程窗口激活、步骤视觉核验与状态自愈，执行完毕自动记录至飞书多维表格。"
        )

    @property
    def input_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list", "execute"],
                    "default": "execute",
                    "description": "操作类型：list(列出所有已配置的SOP业务流)，execute(执行指定SOP)"
                },
                "sop_id": {
                    "type": "string",
                    "description": "待执行的 SOP 流程 ID（例如 'skill_xiaohongshu_lead_capture' 或 'skill_feishu_leave_approval'）"
                },
                "dry_run": {
                    "type": "boolean",
                    "default": False,
                    "description": "是否为沙箱试运行模式（不真正触发外设物理击键）"
                }
            }
        }

    def execute(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        action = arguments.get("action", "execute")
        if action == "list":
            sops = SopSkillRunner.list_available_sops()
            return {
                "status": "success",
                "count": len(sops),
                "sops": sops
            }
        
        sop_id = arguments.get("sop_id")
        if not sop_id:
            return {"status": "error", "message": "必须指定 sop_id 参数"}

        dry_run = arguments.get("dry_run", False)
        return SopSkillRunner.run_sop_by_id(sop_id, dry_run=dry_run)
