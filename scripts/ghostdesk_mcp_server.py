#!/usr/bin/env python3
"""
GhostDesk 官方统一 MCP 插件化服务总线 (Model Context Protocol Server)
通过 mcp_tools.registry 自动探查并挂载所有已接入的标准工具插件。
"""

import sys
import json
from pathlib import Path

# 编码保护
if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

# 保存真实的标准输出用于 JSON-RPC 通信，普通 print 重定向到 stderr 防协议破坏
_real_stdout = sys.stdout
if "--list" not in sys.argv:
    sys.stdout = sys.stderr

from mcp_tools.registry import registry


def run_mcp_stdio():
    """标准 MCP JSON-RPC 2.0 stdio 服务端主循环"""
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue

            req = json.loads(line)
            req_id = req.get("id")
            method = req.get("method")
            params = req.get("params", {})

            if method == "initialize":
                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "ghostdesk-mcp-server", "version": "2.0.0"}
                    }
                }
            elif method == "tools/list":
                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"tools": registry.list_tool_definitions()}
                }
            elif method == "tools/call":
                tool_name = params.get("name")
                arguments = params.get("arguments", {})
                call_res = registry.call_tool(tool_name, arguments)
                if call_res.get("isError"):
                    resp = {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "isError": True,
                            "content": [{"type": "text", "text": call_res.get("error", "执行出错")}]
                        }
                    }
                else:
                    result_data = call_res.get("result", {})
                    resp = {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "content": [{"type": "text", "text": json.dumps(result_data, ensure_ascii=False, indent=2)}]
                        }
                    }
            else:
                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {}
                }

            _real_stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            _real_stdout.flush()

        except (KeyboardInterrupt, EOFError):
            break
        except Exception as e:
            err_resp = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32603, "message": str(e)}
            }
            _real_stdout.write(json.dumps(err_resp, ensure_ascii=False) + "\n")
            _real_stdout.flush()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--list":
        tools = registry.list_tool_definitions()
        print(f"[GhostDesk MCP 插件总线] 动态发现并挂载了 {len(tools)} 个标准工具：\n")
        print(json.dumps(tools, indent=2, ensure_ascii=False))
    else:
        run_mcp_stdio()
