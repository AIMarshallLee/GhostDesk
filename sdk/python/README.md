# GhostDesk Python SDK 🐍👻

> **The Hardware-in-the-Loop Desktop Automation Client for Python AI Agents**

Easily integrate physical-level Windows anti-ban automation (via Raspberry Pi Pico USB HID + VLM Computer Use) into your **CrewAI**, **LangGraph**, **AutoGen**, or custom Python agents!

---

## ⚡ Quick Start

### Installation
```bash
pip install ghostdesk
```

### 1. Basic Usage (Type into WeChat with Physical USB HID)
```python
from ghostdesk import GhostClient

with GhostClient() as client:
    # Check connection to local GhostDesk substrate
    status = client.health()
    print("Substrate status:", status)

    # Type into WeChat: Automatically routed to Ghost Channel (Physical Pico USB + full pinyin)
    result = client.execute_action(
        process="wechat.exe",
        kind="type",
        text="您好，您的订单已经核实并录入系统！"
    )
    print(f"Executed via {result.channel} channel in {result.duration_ms}ms")
```

### 2. Fast Channel (50ms Instant Typing into Excel)
```python
with GhostClient() as client:
    # Type into Excel: Automatically routed to Fast Channel (50ms execution, zero token waste)
    result = client.execute_action(
        process="excel.exe",
        kind="type",
        text="SKU-99201, 50, 已完成\n"
    )
    print(f"Fast channel executed, saved ~{result.tokens_saved} VLM tokens!")
```

### 3. Integrate into LangGraph / CrewAI Tool
```python
from ghostdesk import GhostClient, WindowTarget

def ghostdesk_order_sync_tool(order_data: str) -> str:
    """Agent tool to physically record an order from WeChat into Excel."""
    with GhostClient() as client:
        result = client.dispatch_skill(
            skill_id="skill_order_to_excel",
            target_windows=[
                WindowTarget(hwnd="1001", process="wechat.exe", title="微信"),
                WindowTarget(hwnd="1002", process="excel.exe", title="订单表.xlsx")
            ]
        )
        return f"Order sync finished with status: {result['status']}"
```
