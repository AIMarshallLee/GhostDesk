import sys
import time
import threading
import tkinter as tk
from tkinter import ttk

class ActionHUD:
    """GhostDesk 前台高可见性半透明悬浮任务指示器"""
    _instance = None
    _lock = threading.Lock()

    def __init__(self):
        self.root = None
        self.label_step = None
        self.label_detail = None
        self.progress_bar = None
        self.ready_event = threading.Event()
        self._thread = threading.Thread(target=self._run_ui, daemon=True)
        self._thread.start()
        self.ready_event.wait(timeout=3.0)

    def _run_ui(self):
        self.root = tk.Tk()
        self.root.title("GhostDesk AI Agent")
        
        # 窗口无边框、置顶
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        
        # Windows 半透明磨砂质感 (透明度 0.92)
        try:
            self.root.attributes("-alpha", 0.92)
        except Exception:
            pass

        # 尺寸与右上角屏幕定位
        width = 380
        height = 80
        screen_w = self.root.winfo_screenwidth()
        x = screen_w - width - 30
        y = 30
        self.root.geometry(f"{width}x{height}+{x}+{y}")

        # 背景与边框
        frame = tk.Frame(self.root, bg="#1E1E2E", bd=2, relief="solid", highlightbackground="#89B4FA", highlightthickness=1)
        frame.pack(fill="both", expand=True)

        # 标题栏：微标与小红叉
        header_frame = tk.Frame(frame, bg="#1E1E2E")
        header_frame.pack(fill="x", padx=8, pady=(4, 0))

        title_lbl = tk.Label(header_frame, text="🤖 GhostDesk 任务执行中", fg="#89B4FA", bg="#1E1E2E", font=("Microsoft YaHei", 9, "bold"))
        title_lbl.pack(side="left")

        btn_close = tk.Label(header_frame, text="✕", fg="#A6ADC8", bg="#1E1E2E", cursor="hand2", font=("Arial", 9))
        btn_close.pack(side="right")
        btn_close.bind("<Button-1>", lambda e: self.hide())

        # 当前步骤文字
        self.label_step = tk.Label(frame, text="正在初始化...", fg="#CDD6F4", bg="#1E1E2E", font=("Microsoft YaHei", 10), anchor="w")
        self.label_step.pack(fill="x", padx=10, pady=(2, 2))

        # 进度条
        self.progress_bar = ttk.Progressbar(frame, orient="horizontal", mode="determinate")
        self.progress_bar.pack(fill="x", padx=10, pady=(0, 6))

        # 自定义进度条颜色样式
        style = ttk.Style()
        style.theme_use('clam')
        style.configure("Horizontal.TProgressbar", foreground='#A6E3A1', background='#89B4FA', troughcolor='#313244')

        self.ready_event.set()
        self.root.mainloop()

    def show_step(self, step_text: str, progress: int = 50, color: str = "#89B4FA"):
        """跨线程安全更新悬浮条状态"""
        if not self.root:
            return
        def _update():
            try:
                self.root.deiconify()
                self.label_step.config(text=step_text, fg=color)
                self.progress_bar["value"] = progress
                self.root.update_idletasks()
            except Exception:
                pass
        self.root.after(0, _update)

    def hide(self):
        if self.root:
            self.root.after(0, self.root.withdraw)

    @classmethod
    def get_instance(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = ActionHUD()
            return cls._instance

if __name__ == "__main__":
    print("正在启动前台 HUD 悬浮指示器测试...")
    hud = ActionHUD.get_instance()
    hud.show_step("步骤 1/3: 正在唤醒剪映专业版...", 30)
    time.sleep(2)
    hud.show_step("步骤 2/3: 正在定位【导出】按钮...", 70)
    time.sleep(2)
    hud.show_step("步骤 3/3: 导出完成！已保存到桌面", 100, color="#A6E3A1")
    time.sleep(2)
    hud.hide()
    print("测试完毕。")
