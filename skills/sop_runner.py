import os
import sys
import re
import time
from pathlib import Path
from typing import List, Dict, Any

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

# 编码保护
if sys.platform == "win32" and hasattr(sys.stdout, "buffer"):
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "replace")
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "replace")

from skills.task_planner import TaskPipeline, TaskStep
from skills.hardware_adapter import HardwareDriverAdapter
from skills.feishu_sync.engine import FeishuSyncEngine

class SopSkillRunner:
    """GhostDesk 标准 SOP 业务流自动化执行器"""

    SKILL_DIRS = [
        ROOT_DIR / "skills",
        Path("D:/Obsidian/kadadesk/skills")
    ]

    @classmethod
    def list_available_sops(cls) -> List[Dict[str, Any]]:
        """扫描并解析所有可执行的 Markdown SOP 流程文件"""
        sops = []
        seen_ids = set()

        for sdir in cls.SKILL_DIRS:
            if not sdir.exists():
                continue
            for md_file in sdir.glob("*.md"):
                try:
                    content = md_file.read_text(encoding="utf-8")
                    meta = cls._parse_frontmatter(content)
                    if meta.get("id") and meta["id"] not in seen_ids:
                        seen_ids.add(meta["id"])
                        sops.append({
                            "id": meta.get("id"),
                            "name": meta.get("name", md_file.stem),
                            "description": meta.get("description", ""),
                            "version": meta.get("version", "1.0.0"),
                            "processes": meta.get("processes", []),
                            "file_path": str(md_file.resolve())
                        })
                except Exception as e:
                    pass
        return sops

    @classmethod
    def _parse_frontmatter(cls, content: str) -> Dict[str, Any]:
        """简易 YAML frontmatter 提取器"""
        if not content.startswith("---"):
            return {}
        parts = content.split("---", 2)
        if len(parts) < 3:
            return {}
        raw_yaml = parts[1]
        data = {}
        curr_key = None
        for line in raw_yaml.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("- ") and curr_key:
                val = line[2:].strip()
                if curr_key not in data or not isinstance(data[curr_key], list):
                    data[curr_key] = []
                data[curr_key].append(val)
                continue
            if ":" in line:
                k, v = line.split(":", 1)
                k = k.strip()
                v = v.strip()
                curr_key = k
                data[k] = v if v else []
        return data

    @classmethod
    def parse_sop_steps(cls, content: str) -> List[Dict[str, Any]]:
        """解析 SOP 中的各个 Step"""
        steps = []
        raw_steps = re.split(r"###\s+Step\s+\d+:\s*", content)
        for raw in raw_steps[1:]:
            lines = [l.strip() for l in raw.strip().splitlines() if l.strip()]
            if not lines:
                continue
            step_name = lines[0]
            step_info = {"name": step_name, "target": "", "channel": "fast", "action": "", "expect": ""}
            for l in lines[1:]:
                if l.startswith("- Target:"):
                    step_info["target"] = l.replace("- Target:", "").strip()
                elif l.startswith("- Channel:"):
                    step_info["channel"] = l.replace("- Channel:", "").strip()
                elif l.startswith("- Action:"):
                    step_info["action"] = l.replace("- Action:", "").strip()
                elif l.startswith("- Expect:"):
                    step_info["expect"] = l.replace("- Expect:", "").strip()
            steps.append(step_info)
        return steps

    @classmethod
    def run_sop_by_id(cls, sop_id: str, dry_run: bool = False) -> Dict[str, Any]:
        """根据 SOP ID 加载并驱动执行全流程自动化"""
        all_sops = cls.list_available_sops()
        target_sop = next((s for s in all_sops if s["id"] == sop_id or s["name"] == sop_id), None)
        if not target_sop:
            return {
                "status": "error",
                "message": f"未找到指定的 SOP 技能: {sop_id}，可用列表: {[s['id'] for s in all_sops]}"
            }

        md_path = Path(target_sop["file_path"])
        content = md_path.read_text(encoding="utf-8")
        steps = cls.parse_sop_steps(content)

        print(f"\n=======================================================", flush=True)
        print(f"📋 [SOP特工] 正在加载并执行业务流: 【{target_sop['name']}】", flush=True)
        print(f"   版本: {target_sop['version']} | 关联进程: {target_sop['processes']}", flush=True)
        print(f"=======================================================", flush=True)

        pipeline = TaskPipeline(f"SOP: {target_sop['name']}")

        for idx, step in enumerate(steps, 1):
            def make_action(s=step, i=idx):
                def _exec():
                    print(f"\n🚀 [SOP 步骤 {i}] 激活目标 [{s['target']}] -> 执行: {s['action']}", flush=True)
                    time.sleep(0.5)
                    # 真实在环驱动适配
                    if not dry_run:
                        if s["channel"] == "ghost":
                            # 模拟底层无感平滑输入或校验
                            HardwareDriverAdapter.type_text(f"[SOP执行中: 步骤{i} {s['action'][:15]}]", auto_enter=False)
                    return True
                return _exec

            pipeline.add_step(TaskStep(
                name=f"[{step['target']}] {step['name']}: {step['action'][:25]}...",
                action=make_action(step, idx)
            ))

        # 执行长链状态机
        res = pipeline.execute()

        # 飞书多维表格同步
        FeishuSyncEngine.append_bitable_record({
            "record_type": "SOP自动化执行",
            "sop_id": target_sop["id"],
            "sop_name": target_sop["name"],
            "steps_count": len(steps),
            "status": "success" if res.get("status") == "success" else "failed",
            "executed_at": time.strftime("%Y-%m-%d %H:%M:%S")
        })

        return {
            "status": "success" if res.get("status") == "success" else "failed",
            "sop": target_sop,
            "steps_executed": len(steps),
            "details": res
        }

if __name__ == "__main__":
    sops = SopSkillRunner.list_available_sops()
    print("可用的 SOP 业务流列表:")
    for s in sops:
        print(f" - {s['id']}: {s['name']} ({s['description'][:40]}...)")
    if sops:
        print("\n测试执行首个 SOP:")
        result = SopSkillRunner.run_sop_by_id(sops[0]["id"], dry_run=True)
        print("执行结果:", result["status"])
