"""
GhostDesk Python SDK
~~~~~~~~~~~~~~~~~~~~

The official Python client for GhostDesk: Hardware-in-the-Loop Desktop
AI Employee Substrate for Windows.
"""

from .client import GhostClient, WindowTarget, ExecutionResult

__version__ = "1.0.0"
__all__ = ["GhostClient", "WindowTarget", "ExecutionResult"]
