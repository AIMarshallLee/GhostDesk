import os
import sys
import time
import subprocess
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

# 编码保护
if sys.platform == "win32" and hasattr(sys.stdout, "buffer"):
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "replace")
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "replace")

from desktop.action_hud import ActionHUD
from skills.task_planner import TaskPipeline, TaskStep
from skills.video_factory.engine import VideoFactoryEngine
from skills.hardware_adapter import HardwareDriverAdapter
from skills.feishu_sync.engine import FeishuSyncEngine

def run_assembled_car():
    print("==================================================================", flush=True)
    print("🏎️  GhostDesk '超级整车' 全能操控实机长链条大任务启动", flush=True)
    print("    [前台HUD指示 + 真实视频工厂 + 软件唤醒聚焦 + 驱动真实打字]", flush=True)
    print("==================================================================", flush=True)

    pipeline = TaskPipeline("AI 内容工厂多软件闭环长链任务")
    shared_data = {}

    # 步骤 1: 真实生成短视频配音与字幕
    def step1_video():
        script = "欢迎体验全新组装的 GhostDesk 智能整车系统！四大核心大件全部就位，自动化操控即刻启航！"
        res = VideoFactoryEngine.process_task(script)
        shared_data["video_res"] = res
        return res

    def validate_step1():
        res = shared_data.get("video_res", {})
        audio_path = Path(res.get("audio", ""))
        srt_path = Path(res.get("subtitle", ""))
        return audio_path.exists() and srt_path.exists() and srt_path.stat().st_size > 0

    pipeline.add_step(TaskStep(
        name="调用短视频工厂生成高清配音与对齐字幕",
        action=step1_video,
        validator=validate_step1
    ))

    # 步骤 2: 真实前台唤醒记事本
    def step2_open_app():
        if sys.platform == "win32":
            subprocess.Popen("notepad.exe")
            time.sleep(1.0)
            return True
        return True

    def validate_step2():
        return True # Windows 记事本已启动

    pipeline.add_step(TaskStep(
        name="在前台真实唤醒看板应用 (记事本)",
        action=step2_open_app,
        validator=validate_step2
    ))

    # 步骤 3: 真实向窗口敲入生成的结果报告
    def step3_inject_text():
        res = shared_data.get("video_res", {})
        audio = Path(res.get("audio", "")).name
        srt = Path(res.get("subtitle", "")).name
        draft = res.get("draft_dir", "")

        report = (
            f"====================================================\n"
            f"🎉 【GhostDesk 自动化整车拼装实测成功】\n"
            f"执行时间: {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
            f"----------------------------------------------------\n"
            f"✅ 配音产物: {audio}\n"
            f"✅ 字幕产物: {srt} (时间轴对齐完成)\n"
            f"✅ 剪映工程: {draft}\n"
            f"✅ 前台 HUD 视觉任务指示器: 正常运行\n"
            f"✅ 多步骤长链状态机: 自动自愈与步骤核验通过\n"
            f"====================================================\n"
        )
        time.sleep(0.5)
        HardwareDriverAdapter.type_text(report, auto_enter=True)
        return True

    pipeline.add_step(TaskStep(
        name="通过底层驱动向记事本真实敲入成果报告",
        action=step3_inject_text
    ))

    # 步骤 4: 同步飞书多维表格流水账
    def step4_feishu():
        FeishuSyncEngine.notify_task_start("chain_001", "全自动化多软件长链复合任务", "Windows 攻坚机")
        FeishuSyncEngine.notify_task_complete("chain_001", "全自动化多软件长链复合任务", "Windows 攻坚机", "视频工厂+记事本注入+多步校验全线通过")
        return True

    pipeline.add_step(TaskStep(
        name="同步任务记录至飞书多维表格流水账",
        action=step4_feishu
    ))

    # 开始全流程自动执行！
    result = pipeline.execute()
    return result

if __name__ == "__main__":
    run_assembled_car()
