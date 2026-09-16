"""
LangGraph Agent + GhostDesk Substrate Integration Example.

This script demonstrates how an autonomous LangGraph agent uses GhostDesk
tools to execute Windows desktop operations with Zero-Ban Pico USB HID safety.
"""
from typing import Dict, Any, List
from ghostdesk import GhostClient, WindowTarget

class GhostDeskToolKit:
    """Provides callable tool definitions for LangChain / LangGraph agents."""

    def __init__(self, client: GhostClient):
        self.client = client

    def click(self, process: str, x: float, y: float) -> Dict[str, Any]:
        """Click at coordinates inside a target window. Routes automatically to Ghost/Fast channel."""
        result = self.client.execute_action(process=process, kind="click", x=x, y=y)
        return {
            "ok": result.ok,
            "channel_used": result.channel,
            "tokens_saved": result.tokens_saved,
            "duration_ms": result.duration_ms,
        }

    def type_text(self, process: str, text: str) -> Dict[str, Any]:
        """Type text into an application. Sensitive apps are typed via USB hardware keystrokes."""
        result = self.client.execute_action(process=process, kind="type_text", text=text)
        return {
            "ok": result.ok,
            "channel_used": result.channel,
            "duration_ms": result.duration_ms,
        }

    def run_sop_skill(self, skill_id: str, windows: List[Dict[str, str]]) -> Dict[str, Any]:
        """Runs a complete standardized SOP skill without token waste."""
        targets = [
            WindowTarget(
                hwnd=w.get("hwnd", "0x0001"),
                process=w.get("process", "app.exe"),
                title=w.get("title", ""),
            )
            for w in windows
        ]
        return self.client.dispatch_skill(skill_id, targets)


def main():
    print("Initializing GhostDesk Python Client...")
    client = GhostClient(base_url="http://127.0.0.1:4318")
    toolkit = GhostDeskToolKit(client)

    print("\n--- Example 1: High-Risk App Action (WeChat) ---")
    # Will be routed to GhostChannel (Pico USB HID) with 0-ban risk
    res_wechat = toolkit.type_text(process="wechat.exe", text="您好，您的订单已受理！")
    print("Action Result:", res_wechat)

    print("\n--- Example 2: Safe App Action (Excel) ---")
    # Will be routed to FastChannel (50ms Native Injection) for speed
    res_excel = toolkit.click(process="excel.exe", x=120.0, y=85.0)
    print("Action Result:", res_excel)

    print("\n--- Example 3: List Built-in and Community SOP Skills ---")
    skills = client.list_skills()
    print(f"Discovered {len(skills)} skills in GhostDesk substrate:")
    for s in skills:
        print(f" - [{s.get('id')}] {s.get('name')}")


if __name__ == "__main__":
    main()
