import time
import sys
from typing import List, Callable, Dict, Any
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

try:
    from desktop.action_hud import ActionHUD
except ImportError:
    ActionHUD = None

class TaskStep:
    def __init__(self, name: str, action: Callable[[], Any], validator: Callable[[], bool] = None, max_retries: int = 2, timeout_sec: float = 8.0):
        self.name = name
        self.action = action
        self.validator = validator
        self.max_retries = max_retries
        self.timeout_sec = timeout_sec

class TaskPipeline:
    """GhostDesk 多步骤长链条任务规划与自愈执行流水线"""
    
    def __init__(self, title: str):
        self.title = title
        self.steps: List[TaskStep] = []
        self.hud = ActionHUD.get_instance() if ActionHUD else None

    def add_step(self, step: TaskStep):
        self.steps.append(step)
        return self

    def execute(self) -> Dict[str, Any]:
        total_steps = len(self.steps)
        print(f"\n==================================================", flush=True)
        print(f"🚀 [Task Pipeline] 启动多步长链任务: 【{self.title}】 (共 {total_steps} 步)", flush=True)
        print(f"==================================================", flush=True)

        results = []
        for i, step in enumerate(self.steps, 1):
            pct = int((i / total_steps) * 100)
            step_display = f"步骤 {i}/{total_steps}: {step.name}"
            print(f"\n▶️  [{i}/{total_steps}] 正在执行: {step.name}...", flush=True)
            
            if self.hud:
                self.hud.show_step(step_display, pct, color="#89B4FA")

            success = False
            last_err = None
            for attempt in range(1, step.max_retries + 1):
                try:
                    # 1. 执行动作
                    res = step.action()
                    
                    # 2. 状态自反思校验 (Validator)
                    if step.validator:
                        time.sleep(0.3)
                        is_valid = step.validator()
                        if not is_valid:
                            raise RuntimeError(f"校验未通过 (尝试 {attempt}/{step.max_retries})")
                    
                    success = True
                    results.append({"step": step.name, "status": "success", "result": res})
                    print(f"   ✅ {step.name} 执行并通过校验！", flush=True)
                    break

                except Exception as e:
                    last_err = str(e)
                    print(f"   ⚠️  步骤 [{step.name}] 遇阻: {e}，尝试自愈重试...", flush=True)
                    if self.hud:
                        self.hud.show_step(f"⚠️ 自愈重试中 ({attempt}/{step.max_retries}): {step.name}", pct, color="#F9E2AF")
                    
                    # 尝试自愈：发送 ESC 消除可能的阻挡弹窗
                    self._self_heal_neutral_state()
                    time.sleep(0.5)

            if not success:
                print(f"❌ [Task Pipeline] 步骤 [{step.name}] 最终失败: {last_err}", flush=True)
                if self.hud:
                    self.hud.show_step(f"❌ 任务中断: {step.name} 失败", pct, color="#F38BA8")
                    time.sleep(2)
                    self.hud.hide()
                return {"status": "failed", "failed_step": step.name, "error": last_err, "results": results}

            time.sleep(0.3)

        print(f"\n🎉 [Task Pipeline] 所有 {total_steps} 个步骤全部圆满完成！", flush=True)
        if self.hud:
            self.hud.show_step(f"✅ 任务完成: {self.title}", 100, color="#A6E3A1")
            time.sleep(2.5)
            self.hud.hide()

        return {"status": "success", "title": self.title, "results": results}

    def _self_heal_neutral_state(self):
        """自愈动作：向系统发送 ESC 键以关掉阻挡弹窗，恢复中立状态"""
        try:
            if sys.platform == "win32":
                import ctypes
                VK_ESCAPE = 0x1B
                KEYEVENTF_KEYUP = 0x0002
                ctypes.windll.user32.keybd_event(VK_ESCAPE, 0, 0, 0)
                time.sleep(0.05)
                ctypes.windll.user32.keybd_event(VK_ESCAPE, 0, KEYEVENTF_KEYUP, 0)
        except Exception:
            pass
