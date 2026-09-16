from __future__ import annotations
from typing import List, Optional, Dict, Any
import httpx
from pydantic import BaseModel, Field


class WindowTarget(BaseModel):
    hwnd: str
    process: str
    title: str
    pid: Optional[int] = 0


class ExecutionResult(BaseModel):
    ok: bool
    channel: str  # "ghost" or "fast"
    duration_ms: int = 0
    tokens_saved: int = 0
    message: str = ""
    error: Optional[str] = None


class GhostClient:
    """Client for controlling GhostDesk AI Employee Substrate over local API/MCP."""

    def __init__(self, base_url: str = "http://127.0.0.1:4318", timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.client = httpx.Client(base_url=self.base_url, timeout=timeout)

    def health(self) -> Dict[str, Any]:
        """Checks if the local GhostDesk desktop service is online and healthy."""
        try:
            resp = self.client.get("/health")
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def list_skills(self) -> List[Dict[str, Any]]:
        """Retrieves all available employee skills registered in GhostDesk."""
        try:
            resp = self.client.get("/skills")
            if resp.status_code == 200:
                return resp.json().get("skills", [])
            return []
        except Exception:
            return []

    def dispatch_skill(
        self, skill_id: str, target_windows: List[WindowTarget]
    ) -> Dict[str, Any]:
        """Dispatches an AI worker to autonomously execute a specific Skill SOP."""
        payload = {
            "skillId": skill_id,
            "targetWindows": [w.model_dump() for w in target_windows],
        }
        try:
            resp = self.client.post("/worker/dispatch", json=payload)
            if resp.status_code == 200:
                return resp.json()
            return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def execute_action(
        self,
        process: str,
        kind: str,
        text: Optional[str] = None,
        x: Optional[float] = None,
        y: Optional[float] = None,
        policy: str = "auto",
    ) -> ExecutionResult:
        """Executes a single action through the Hybrid Policy Router.

        - For high-risk apps (WeChat, DingTalk, e-commerce): routes to Ghost Channel (Pico USB HID).
        - For safe apps (Excel, Chrome, Notepad): routes to Fast Channel (50ms native injection).
        """
        payload: Dict[str, Any] = {
            "targetProcess": process,
            "action": {"kind": kind},
            "policy": policy,
        }
        if text is not None:
            payload["action"]["text"] = text
        if x is not None and y is not None:
            payload["action"]["x"] = x
            payload["action"]["y"] = y

        try:
            resp = self.client.post("/worker/act", json=payload)
            data = resp.json() if resp.status_code == 200 else {}
            return ExecutionResult(
                ok=data.get("ok", resp.status_code == 200),
                channel=data.get("channel", "ghost"),
                duration_ms=data.get("durationMs", 0),
                tokens_saved=data.get("tokensSavedEstimate", 0),
                message=data.get("message", ""),
                error=data.get("error") or (None if resp.status_code == 200 else f"HTTP {resp.status_code}: {resp.text}"),
            )
        except Exception as e:
            return ExecutionResult(
                ok=False,
                channel="none",
                error=f"Connection failed: {e}",
            )

    def switch_window(self, hwnd: str) -> Dict[str, Any]:
        """Safely activates an authorized window in the workspace scope."""
        try:
            resp = self.client.post("/workspace/switch", json={"hwnd": hwnd})
            if resp.status_code == 200:
                return resp.json()
            return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def close(self):
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
