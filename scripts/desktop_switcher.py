#!/usr/bin/env python3
"""
GhostDesk 跨平台桌面应用切换与语音控制调度器 (Desktop Switcher & Voice Dispatcher)
支持:
1. 语音/文本调度: "打开终端", "切换到 VS Code", "关闭微信", "切到反重力运行 claude", "确认", "取消"
2. 三大核心操作: 打开 (Open/Launch)、关闭 (Close/Quit)、切换置顶与聚焦输入区 (Switch/Focus)
3. 跨平台支持:
   - Windows: 原生 Win32 API (OpenInputDesktop + EnumDesktopWindows + SetForegroundWindow + WM_CLOSE)
   - macOS: AppleScript (osascript tell application to activate / quit)
4. 双层语义解析:
   - 本地 5ms 零延迟规则引擎 (极速响应常用口令)
   - DeepSeek API 大模型语义兜底 (复杂长句提取结构化指令)
"""

import os
import sys
import time
import re
import json
import subprocess
import urllib.request
import urllib.error

# 解决 Windows 控制台编码问题
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

try:
    import pyautogui
    import pyperclip
    pyautogui.FAILSAFE = False
except ImportError:
    pyautogui = None
    pyperclip = None

IS_WINDOWS = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"

# ==============================================================================
# 目标应用注册表与别名映射 (支持 Windows 进程与路径、macOS App 名称)
# ==============================================================================
APP_DEFINITIONS = {
    "antigravity": {
        "name": "Antigravity (反重力)",
        "aliases": ["反重力", "antigravity", "agy", "反重力桌面端", "反重力工具"],
        "win_proc": ["Antigravity.exe", "antigravity-tools.exe"],
        "win_paths": [
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Antigravity Tools\antigravity-tools.exe"),
        ],
        "mac_app": "Antigravity",
        "focus_key": None,
    },
    "terminal": {
        "name": "终端 (Terminal / Claude Code)",
        "aliases": ["终端", "命令行", "terminal", "powershell", "cmd", "控制台", "claude code", "iterm"],
        "win_proc": ["WindowsTerminal.exe", "powershell.exe", "pwsh.exe", "cmd.exe"],
        "win_launch": ["wt.exe", "powershell.exe"],
        "mac_app": "Terminal",
        "focus_key": None,
    },
    "vscode": {
        "name": "Visual Studio Code",
        "aliases": ["vscode", "vs code", "code", "编辑器", "代码"],
        "win_proc": ["Code.exe"],
        "win_paths": [
            "code",
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe"),
            r"C:\Program Files\Microsoft VS Code\Code.exe",
        ],
        "mac_app": "Visual Studio Code",
        "focus_key": "ctrl+`",  # 打开/聚焦内置终端
    },
    "claude": {
        "name": "Claude 桌面端",
        "aliases": ["claude", "克劳德", "claude桌面端", "claude ai"],
        "win_proc": ["Claude.exe"],
        "win_paths": [
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Claude\Claude.exe"),
        ],
        "mac_app": "Claude",
        "focus_key": None,
    },
    "chatgpt": {
        "name": "ChatGPT 桌面端",
        "aliases": ["chatgpt", "chat gpt", "openai", "codex"],
        "win_proc": ["ChatGPT.exe"],
        "win_paths": ["chatgpt"],
        "mac_app": "ChatGPT",
        "focus_key": None,
    },
    "wechat": {
        "name": "微信",
        "aliases": ["微信", "wechat", "weixin"],
        "win_proc": ["Weixin.exe", "WeChat.exe"],
        "win_paths": [
            r"D:\software\wx\Weixin\Weixin.exe",
            r"C:\Program Files\Tencent\WeChat\WeChat.exe",
            r"C:\Program Files (x86)\Tencent\WeChat\WeChat.exe",
        ],
        "mac_app": "WeChat",
        "focus_key": None,
    },
    "browser": {
        "name": "浏览器",
        "aliases": ["浏览器", "chrome", "edge", "谷歌浏览器", "tabbit"],
        "win_proc": ["chrome.exe", "msedge.exe", "Tabbit Browser.exe"],
        "win_paths": ["msedge", "chrome"],
        "mac_app": "Google Chrome",
        "focus_key": None,
    },
}


# ==============================================================================
# Windows 原生 Win32 API 引擎 (免依赖 ctypes 实现)
# ==============================================================================
if IS_WINDOWS:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    # Win32 常量
    SW_RESTORE = 9
    SW_SHOW = 5
    SW_MINIMIZE = 6
    WM_CLOSE = 0x0010
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

    WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

    def _ensure_desktop():
        """确保当前线程附加到真实的交互桌面，解决后台/非交互终端看不到窗口的问题"""
        try:
            hdesk = user32.OpenInputDesktop(0, False, 0x01FF)
            if hdesk:
                user32.SetThreadDesktop(hdesk)
                return hdesk
        except Exception:
            pass
        return None

    def _get_process_name(pid: int) -> str:
        h_proc = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h_proc:
            return ""
        buf = ctypes.create_unicode_buffer(512)
        size = wintypes.DWORD(512)
        name = ""
        if kernel32.QueryFullProcessImageNameW(h_proc, 0, buf, ctypes.byref(size)):
            name = buf.value.split("\\")[-1]
        kernel32.CloseHandle(h_proc)
        return name

    def list_windows():
        """枚举当前桌面所有顶层可见窗口 (hwnd, pid, process_name, title)"""
        hdesk = _ensure_desktop()
        results = []

        def enum_cb(hwnd, _):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buf = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buf, length + 1)
                    title = buf.value
                    if title and title != "Program Manager":
                        pid = wintypes.DWORD()
                        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                        pname = _get_process_name(pid.value)
                        results.append({
                            "hwnd": hwnd,
                            "pid": pid.value,
                            "process": pname,
                            "title": title
                        })
            return True

        if hdesk:
            user32.EnumDesktopWindows(hdesk, WNDENUMPROC(enum_cb), 0)
        else:
            user32.EnumWindows(WNDENUMPROC(enum_cb), 0)

        return results

    def activate_window_win32(hwnd: int) -> bool:
        """强化版激活并前台置顶窗口 (突破 Windows 前台锁定)"""
        _ensure_desktop()
        try:
            cur_thread = kernel32.GetCurrentThreadId()
            fg_hwnd = user32.GetForegroundWindow()
            fg_thread = user32.GetWindowThreadProcessId(fg_hwnd, None) if fg_hwnd else 0

            if cur_thread != fg_thread and fg_thread != 0:
                user32.AttachThreadInput(cur_thread, fg_thread, True)

            user32.ShowWindow(hwnd, SW_RESTORE)
            user32.BringWindowToTop(hwnd)
            user32.SetForegroundWindow(hwnd)

            if cur_thread != fg_thread and fg_thread != 0:
                user32.AttachThreadInput(cur_thread, fg_thread, False)
            return True
        except Exception as e:
            print(f"[Win32] 激活窗口失败: {e}")
            return False

    def close_window_win32(hwnd: int) -> bool:
        """优雅关闭窗口"""
        try:
            user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
            return True
        except Exception as e:
            print(f"[Win32] 关闭窗口失败: {e}")
            return False


# ==============================================================================
# 跨平台桌面操作总控 (Desktop Controller)
# ==============================================================================
class DesktopController:
    @staticmethod
    def find_app_window(app_key: str):
        """查找指定应用当前是否已打开对应窗口"""
        app = APP_DEFINITIONS.get(app_key)
        if not app:
            return None

        if IS_WINDOWS:
            windows = list_windows()
            proc_names = [p.lower() for p in app.get("win_proc", [])]
            aliases = [a.lower() for a in app.get("aliases", [])]

            # 1. 优先按进程名精确匹配
            for w in windows:
                if w["process"].lower() in proc_names:
                    return w

            # 2. 其次按标题模糊匹配
            for w in windows:
                t_lower = w["title"].lower()
                for a in aliases:
                    if a in t_lower:
                        return w
        return None

    @classmethod
    def switch_to_app(cls, app_key: str, focus_type: str = "default") -> bool:
        """切换到目标应用，将其置顶并聚焦输入区"""
        app = APP_DEFINITIONS.get(app_key)
        if not app:
            print(f"⚠️ 未知应用: {app_key}")
            return False

        print(f"🎯 正在切换到: {app['name']}...")

        # 1. 尝试找到已经打开的窗口
        w = cls.find_app_window(app_key)
        if w:
            if IS_WINDOWS:
                ok = activate_window_win32(w["hwnd"])
                time.sleep(0.15)
                # 处理聚焦快捷键
                if focus_type == "terminal" and app.get("focus_key"):
                    if pyautogui:
                        pyautogui.hotkey("ctrl", "`")
                return ok
            elif IS_MAC:
                mac_app = app.get("mac_app", "")
                subprocess.run(["osascript", "-e", f'tell application "{mac_app}" to activate'])
                return True

        # 2. 如果窗口不存在，自动启动它
        print(f"💡 目标应用未运行，正在为您启动...")
        return cls.launch_app(app_key)

    @classmethod
    def launch_app(cls, app_key: str) -> bool:
        """打开 / 启动目标应用"""
        app = APP_DEFINITIONS.get(app_key)
        if not app:
            return False

        if IS_WINDOWS:
            # 优先尝试已知路径与命令
            paths = app.get("win_paths", []) + app.get("win_launch", [])
            for p in paths:
                try:
                    if os.path.exists(p) or "\\" not in p:
                        subprocess.Popen(p, shell=True)
                        print(f"✨ 成功启动 {app['name']}")
                        return True
                except Exception:
                    continue
            print(f"⚠️ 无法自动定位 {app['name']} 的启动路径，请确认是否已安装")
            return False

        elif IS_MAC:
            mac_app = app.get("mac_app", "")
            cmd = f'tell application "{mac_app}" to activate'
            res = subprocess.run(["osascript", "-e", cmd], capture_output=True)
            return res.returncode == 0

        return False

    @classmethod
    def close_app(cls, app_key: str) -> bool:
        """关闭目标应用"""
        app = APP_DEFINITIONS.get(app_key)
        if not app:
            return False

        print(f"🛑 正在关闭: {app['name']}...")

        if IS_WINDOWS:
            w = cls.find_app_window(app_key)
            if w:
                return close_window_win32(w["hwnd"])
            # 若没找到顶层窗口，尝试按进程优雅结束
            for proc in app.get("win_proc", []):
                subprocess.run(f"taskkill /IM {proc} >nul 2>&1", shell=True)
            return True

        elif IS_MAC:
            mac_app = app.get("mac_app", "")
            subprocess.run(["osascript", "-e", f'tell application "{mac_app}" to quit'])
            return True

        return False

    @classmethod
    def execute_shortcut(cls, action: str) -> bool:
        """执行快捷系统指令 (放行/取消/回车/清屏)"""
        if not pyautogui:
            print("⚠️ 未安装 pyautogui，无法模拟按键")
            return False

        if action in ("approve", "confirm", "yes"):
            print("✅ 物理放行 (y + Enter)")
            pyautogui.press("y")
            time.sleep(0.05)
            pyautogui.press("enter")
            return True
        elif action in ("reject", "cancel", "stop"):
            print("❌ 紧急中断 (Ctrl+C / Esc)")
            pyautogui.hotkey("ctrl", "c")
            pyautogui.press("esc")
            return True
        elif action in ("enter", "submit"):
            print("⏎ 敲击回车")
            pyautogui.press("enter")
            return True
        return False

    @classmethod
    def type_and_submit(cls, text: str, auto_submit: bool = True):
        """向当前焦点输入框安全打字并回车 (支持中文通过剪贴板秒速注入)"""
        if not text:
            return
        if pyperclip and pyautogui:
            old_clip = ""
            try:
                old_clip = pyperclip.paste()
            except Exception:
                pass

            pyperclip.copy(text)
            pyautogui.hotkey("ctrl", "v" if IS_WINDOWS else "v")
            if auto_submit:
                time.sleep(0.08)
                pyautogui.press("enter")

            # 恢复剪贴板
            time.sleep(0.1)
            try:
                if old_clip:
                    pyperclip.copy(old_clip)
            except Exception:
                pass


# ==============================================================================
# 自然语言意图解析器 (本地规则 + DeepSeek API)
# ==============================================================================
class IntentDispatcher:
    DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"

    @classmethod
    def parse_intent_local(cls, text: str):
        """本地零延迟正则快筛 (<5ms)"""
        text_clean = text.strip().lower()

        # 1. 快捷确认与取消口令
        if text_clean in ("确认", "放行", "同意", "好", "可以", "y", "yes", "approve"):
            return {"action": "shortcut", "target": "approve"}
        if text_clean in ("取消", "中断", "停掉", "停止", "否", "n", "no", "reject", "esc"):
            return {"action": "shortcut", "target": "reject"}
        if text_clean in ("回车", "发送", "enter", "提交"):
            return {"action": "shortcut", "target": "enter"}

        # 2. 匹配动词: 打开 / 关闭 / 切换
        action = None
        if any(w in text_clean for w in ["打开", "启动", "开启", "launch", "open", "start"]):
            action = "open"
        elif any(w in text_clean for w in ["关闭", "退出", "关掉", "关了", "close", "quit", "exit", "kill"]):
            action = "close"
        elif any(w in text_clean for w in ["切换到", "切到", "转到", "聚焦", "打开", "switch to", "switch", "goto", "focus"]):
            action = "switch"

        # 3. 匹配目标应用
        matched_app = None
        for key, app in APP_DEFINITIONS.items():
            for alias in app["aliases"]:
                if alias in text_clean:
                    matched_app = key
                    break
            if matched_app:
                break

        if not action and matched_app:
            action = "switch"  # 默认如果是单独应用名，如"反重力"，直接做切换

        # 4. 检查是否附带了需要键入的文本
        # 例如: "切到终端运行 claude" -> app: terminal, type_text: "claude"
        type_text = ""
        if matched_app:
            # 提取应用名后面的文本
            for alias in APP_DEFINITIONS[matched_app]["aliases"]:
                idx = text_clean.find(alias)
                if idx != -1:
                    suffix = text[idx + len(alias):].strip()
                    # 去除连接词: 并运行, 运行, 执行, 帮我, 说, 输入, 查一下
                    suffix = re.sub(r"^(并运行|运行|执行|输入|帮我|说|：|:|,|，|\s+)+", "", suffix)
                    if suffix:
                        type_text = suffix
                    break

        if action and matched_app:
            return {
                "action": action,
                "target_app": matched_app,
                "type_text": type_text,
                "auto_submit": bool(type_text)
            }

        return None

    @classmethod
    def parse_intent_deepseek(cls, text: str, api_key: str):
        """调用 DeepSeek API 进行自然语言意图理解"""
        if not api_key:
            return None

        prompt = (
            "你是一个极客桌面助手意图分析器。用户输入了一句自然语言指令，请解析为 JSON 动作格式。\n"
            "支持的 action: 'switch' (切换/置顶应用), 'open' (打开应用), 'close' (关闭应用), 'shortcut' (快捷操作: approve/reject/enter)\n"
            "支持的 target_app: 'antigravity', 'terminal', 'vscode', 'claude', 'chatgpt', 'wechat', 'browser'\n"
            "如果有需要向该应用输入并执行的代码或问题，请填入 'type_text' 字段，并将 'auto_submit' 设为 true。\n"
            "请仅输出纯 JSON 字符串，不要带 markdown 代码块。示例:\n"
            "{\"action\": \"switch\", \"target_app\": \"terminal\", \"type_text\": \"claude\", \"auto_submit\": true}\n"
            f"用户指令: \"{text}\""
        )

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }
        payload = {
            "model": "deepseek-chat",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1
        }

        try:
            req = urllib.request.Request(
                cls.DEEPSEEK_API_URL,
                data=json.dumps(payload).encode("utf-8"),
                headers=headers,
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                content = data["choices"][0]["message"]["content"].strip()
                # 剔除可能存在的 markdown 标记
                content = re.sub(r"^```json\s*", "", content)
                content = re.sub(r"```$", "", content).strip()
                return json.loads(content)
        except Exception as e:
            print(f"[DeepSeek API] 解析失败或超时: {e}")
            return None

    @classmethod
    def dispatch(cls, query: str, deepseek_api_key: str = ""):
        """主入口: 智能调度分发执行"""
        print(f"\n🎙️ 收到指令: \"{query}\"")

        # 1. 尝试本地 0 延迟命中
        intent = cls.parse_intent_local(query)

        # 2. 若本地未命中且有 API Key，走 DeepSeek 语义兜底
        if not intent and deepseek_api_key:
            print("🤖 本地规则未完全匹配，正在调用 DeepSeek 进行意图理解...")
            intent = cls.parse_intent_deepseek(query, deepseek_api_key)

        if not intent:
            print("❓ 未能识别出明确的窗口或控制指令，将直接作为打字文本输入当前窗口。")
            DesktopController.type_and_submit(query, auto_submit=False)
            return

        print(f"📋 识别意图: {intent}")
        action = intent.get("action")
        target_app = intent.get("target_app")
        type_text = intent.get("type_text", "")
        auto_submit = intent.get("auto_submit", True)

        # 执行动作
        if action == "shortcut":
            DesktopController.execute_shortcut(intent.get("target"))
        elif action == "open":
            DesktopController.launch_app(target_app)
        elif action == "close":
            DesktopController.close_app(target_app)
        elif action == "switch":
            DesktopController.switch_to_app(target_app)
            if type_text:
                time.sleep(0.2)
                print(f"⌨️ 正在自动输入: \"{type_text}\" (回车={auto_submit})")
                DesktopController.type_and_submit(type_text, auto_submit=auto_submit)


# ==============================================================================
# CLI 测试与交互入口
# ==============================================================================
if __name__ == "__main__":
    api_key = os.environ.get("DEEPSEEK_API_KEY", "")

    if len(sys.argv) > 1:
        cmd_input = " ".join(sys.argv[1:])
        IntentDispatcher.dispatch(cmd_input, deepseek_api_key=api_key)
    else:
        print("=" * 65)
        print("  GhostDesk 跨平台桌面应用切换与语音控制调度器")
        print("  支持命令: 打开终端 / 切换到反重力 / 关闭微信 / 切到VS Code并运行claude")
        print("=" * 65)
        print("当前可见应用窗口列表:")
        if IS_WINDOWS:
            for w in list_windows():
                print(f"  • [{w['process']:20s}] {w['title'][:50]}")
        print("-" * 65)

        while True:
            try:
                user_cmd = input("\n请输入测试语音口令 (输入 q 退出): ").strip()
                if not user_cmd or user_cmd.lower() == "q":
                    break
                IntentDispatcher.dispatch(user_cmd, deepseek_api_key=api_key)
            except (KeyboardInterrupt, EOFError):
                break
