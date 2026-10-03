import sys
import subprocess
from pathlib import Path
from typing import Dict, Any
from mcp_tools.base_tool import BaseMcpTool

OBSIDIAN_PUBLISHER_DIR = Path("D:/Obsidian/wechat-oa-daily-publisher")

class WechatPublisherTool(BaseMcpTool):
    """微信公众号矩阵图文全自动生产与草稿发布工具"""

    @property
    def name(self) -> str:
        return "ghostdesk_wechat_publisher"

    @property
    def description(self) -> str:
        return (
            "微信公众号矩阵每日内容工厂（接入自研 wechat-oa-daily-publisher）。"
            "支持一键检查公众号配置、自动根据关键词库生成 8 篇深度行业图文并自动渲染品牌封面与插图。"
        )

    @property
    def input_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["doctor", "generate_daily", "preview"],
                    "default": "doctor",
                    "description": "操作指令：doctor(自检API权限与依赖), generate_daily(自动生成今日图文内容), preview(查看已有草稿与封面)"
                }
            }
        }

    def execute(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        if not OBSIDIAN_PUBLISHER_DIR.exists():
            return {
                "status": "not_installed",
                "message": f"未在 {OBSIDIAN_PUBLISHER_DIR} 找到微信公众号发布套件"
            }

        action = arguments.get("action", "doctor")
        scripts_dir = OBSIDIAN_PUBLISHER_DIR / "scripts"
        py_exe = sys.executable

        if action == "doctor":
            doctor_script = scripts_dir / "doctor.py"
            if not doctor_script.exists():
                return {"status": "error", "message": "未找到 doctor.py 诊断脚本"}
            res = subprocess.run([py_exe, str(doctor_script)], cwd=str(OBSIDIAN_PUBLISHER_DIR), capture_output=True, text=True, encoding="utf-8", errors="replace")
            return {
                "status": "completed",
                "exit_code": res.returncode,
                "stdout": res.stdout,
                "stderr": res.stderr
            }

        elif action == "generate_daily":
            gen_script = scripts_dir / "daily_gen.py"
            res = subprocess.run([py_exe, str(gen_script)], cwd=str(OBSIDIAN_PUBLISHER_DIR), capture_output=True, text=True, encoding="utf-8", errors="replace")
            return {
                "status": "completed",
                "exit_code": res.returncode,
                "stdout": res.stdout,
                "stderr": res.stderr
            }

        elif action == "preview":
            preview_dir = OBSIDIAN_PUBLISHER_DIR / "preview"
            covers = list(scripts_dir.glob("_cover_*.png"))
            return {
                "status": "completed",
                "preview_dir": str(preview_dir.resolve()),
                "covers_count": len(covers),
                "cover_files": [f.name for f in covers]
            }

        return {"status": "error", "message": f"未知操作: {action}"}
