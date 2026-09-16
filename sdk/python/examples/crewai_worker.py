"""
CrewAI Multi-Agent Team + GhostDesk Substrate Integration Example.

This script demonstrates how a CrewAI 'Desktop Automation Operator'
delegates Windows OS actions to GhostDesk with hardware safety guarantees.
"""
from typing import Dict, Any
from ghostdesk import GhostClient, WindowTarget

class GhostDeskExecutionTool:
    """A tool wrapper compatible with CrewAI agents."""

    name: str = "ghostdesk_desktop_action"
    description: str = (
        "Executes a desktop GUI action on Windows. Automatically selects "
        "hardware USB HID injection for sensitive enterprise software or native "
        "high-speed input for productivity tools."
    )

    def __init__(self, client: GhostClient):
        self.client = client

    def _run(self, process: str, action_kind: str, text: str = "", x: float = 0.0, y: float = 0.0) -> str:
        res = self.client.execute_action(
            process=process,
            kind=action_kind,
            text=text if text else None,
            x=x if x > 0 else None,
            y=y if y > 0 else None,
        )
        if res.ok:
            return f"Success via {res.channel} channel in {res.duration_ms}ms (saved ~{res.tokens_saved} tokens)"
        return f"Failed: {res.error}"


def simulate_crewai_dispatch():
    """Simulates a CrewAI Task execution flow using GhostDesk."""
    client = GhostClient(base_url="http://127.0.0.1:4318")
    tool = GhostDeskExecutionTool(client)

    print("[CrewAI Agent: Desktop Operator] Received Task: Export Monthly VAT Invoices")
    
    step1 = tool._run(process="chrome.exe", action_kind="click", x=350.0, y=180.0)
    print("Step 1 (Open Query):", step1)

    step2 = tool._run(process="excel.exe", action_kind="click", x=50.0, y=50.0)
    print("Step 2 (Format Sheet):", step2)

    step3 = tool._run(process="wechat.exe", action_kind="type_text", text="本月发票已导出完毕，请财务查收。")
    print("Step 3 (Notify WeChat via Hardware HID):", step3)


if __name__ == "__main__":
    simulate_crewai_dispatch()
