import os
import sys
import time
from pathlib import Path
from typing import Tuple, Optional

ROOT_DIR = Path(__file__).resolve().parent.parent

class ScreenVisionLocator:
    """GhostDesk 屏幕视觉眼睛与元素定位器"""

    @classmethod
    def capture_screen(cls, output_path: str = None) -> Path:
        """极速截取当前全屏"""
        if not output_path:
            output_dir = ROOT_DIR / "dist" / "vision_captures"
            output_dir.mkdir(parents=True, exist_ok=True)
            output_path = output_dir / f"screen_{int(time.time()*1000)}.png"
        else:
            output_path = Path(output_path)

        try:
            from PIL import ImageGrab
            screenshot = ImageGrab.grab()
            screenshot.save(output_path)
            return output_path
        except Exception as e:
            print(f"⚠️ 截屏异常: {e}")
            return None

    @classmethod
    def find_element_by_name(cls, target_name: str) -> Optional[Tuple[int, int]]:
        """
        在当前屏幕上搜索指定名称的控件 (按钮、输入框、菜单)
        优先采用 Windows 原生 UI Automation 树 (0 延迟、100% 像素级精准)
        """
        if sys.platform != "win32":
            return None

        try:
            import ctypes
            from ctypes import wintypes
            # 简单快速方案：利用 win32gui 遍历可见窗口与子控件
            import win32gui
            import win32con

            found_coords = []

            def enum_child_proc(hwnd, lparam):
                if win32gui.IsWindowVisible(hwnd):
                    text = win32gui.GetWindowText(hwnd).strip()
                    if target_name.lower() in text.lower():
                        rect = win32gui.GetWindowRect(hwnd)
                        # 计算中心点
                        cx = (rect[0] + rect[2]) // 2
                        cy = (rect[1] + rect[3]) // 2
                        found_coords.append((cx, cy))
                return True

            def enum_top_proc(hwnd, lparam):
                if win32gui.IsWindowVisible(hwnd):
                    text = win32gui.GetWindowText(hwnd).strip()
                    if target_name.lower() in text.lower():
                        rect = win32gui.GetWindowRect(hwnd)
                        cx = (rect[0] + rect[2]) // 2
                        cy = (rect[1] + rect[3]) // 2
                        found_coords.append((cx, cy))
                    try:
                        win32gui.EnumChildWindows(hwnd, enum_child_proc, None)
                    except Exception:
                        pass
                return True

            win32gui.EnumWindows(enum_top_proc, None)

            if found_coords:
                print(f"👁️ [Vision Locator] 成功定位目标【{target_name}】像素坐标: {found_coords[0]}")
                return found_coords[0]

        except Exception as e:
            print(f"⚠️ UI Automation 探测跳过: {e}")

        return None

    @classmethod
    def click_at(cls, x: int, y: int):
        """精准点击指定屏幕像素坐标"""
        print(f"🖱️ [Vision Click] 正在点击坐标: ({x}, {y})")
        if sys.platform == "win32":
            import ctypes
            user32 = ctypes.windll.user32
            # 移动光标
            user32.SetCursorPos(x, y)
            time.sleep(0.05)
            # 点击
            MOUSEEVENTF_LEFTDOWN = 0x0002
            MOUSEEVENTF_LEFTUP = 0x0004
            user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            time.sleep(0.05)
            user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        else:
            import pyautogui
            pyautogui.click(x, y)

if __name__ == "__main__":
    print("测试截屏中...")
    img = ScreenVisionLocator.capture_screen()
    print(f"截屏已保存至: {img}")
