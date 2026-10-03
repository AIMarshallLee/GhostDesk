from typing import Dict, Any
from mcp_tools.base_tool import BaseMcpTool
from skills.feishu_sync.engine import FeishuSyncEngine

class FeishuSyncTool(BaseMcpTool):
    """飞书多维表格流水账与群机器人交互通知工具"""

    @property
    def name(self) -> str:
        return "ghostdesk_feishu_sync"

    @property
    def description(self) -> str:
        return (
            "向飞书群机器人推送任务开工/完工交互卡片，并自动将所有任务记录写入本地多维表格流水账。"
        )

    @property
    def input_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "任务唯一标识符"},
                "prompt": {"type": "string", "description": "指令或任务描述"},
                "target_node": {"type": "string", "description": "执行电脑名称"},
                "status": {"type": "string", "enum": ["start", "complete"], "description": "任务阶段"},
                "result_message": {"type": "string", "description": "完成时的结果摘要"}
            },
            "required": ["task_id", "prompt", "status"]
        }

    def execute(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        task_id = arguments.get("task_id", "task_001")
        prompt = arguments.get("prompt", "")
        node = arguments.get("target_node", "本地主机")
        status = arguments.get("status", "complete")
        msg = arguments.get("result_message", "任务已完成")

        if status == "start":
            res = FeishuSyncEngine.notify_task_start(task_id, prompt, node)
        else:
            res = FeishuSyncEngine.notify_task_complete(task_id, prompt, node, msg)
        return {"status": "ok", "feishu_res": res}
