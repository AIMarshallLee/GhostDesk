import * as readline from 'readline';
import { MultiWindowWorkspace, type WindowIdentity } from './workspace-manager';
import { HybridExecutor, type ExecutionResult } from './hybrid-executor';
import { resolveExecutionChannel, type ChannelPolicy } from './hybrid-policy';
import type { ComputerUseAction } from '../shared/computer-use';

export interface McpToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface McpToolResponse {
  content: Array<{ type: 'text' | 'image'; text?: string; data?: string }>;
  isError?: boolean;
}

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, any>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * GhostDeskMcpServer provides standard Model Context Protocol (MCP) tools
 * allowing any external agent (Gemini, Claude, Cursor, custom planners) to drive
 * the hardware-in-the-loop desktop substrate safely.
 */
export class GhostDeskMcpServer {
  constructor(
    private workspace: MultiWindowWorkspace,
    private executor: HybridExecutor,
  ) {}

  public getToolDefinitions(): McpToolDefinition[] {
    const listWindowsSchema = { type: 'object', properties: {} };
    const switchFocusSchema = {
      type: 'object',
      properties: {
        hwnd: { type: 'string', description: 'Window handle (HWND) of the target application' },
      },
      required: ['hwnd'],
    };
    const actSchema = {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['click', 'type', 'key', 'scroll', 'move'] },
        text: { type: 'string', description: 'Text to type (when kind is "type")' },
        x: { type: 'number', description: 'Normalized X coordinate (0.0 to 1.0)' },
        y: { type: 'number', description: 'Normalized Y coordinate (0.0 to 1.0)' },
        button: { type: 'string', enum: ['left', 'right'], default: 'left' },
        policy: { type: 'string', enum: ['auto', 'ghost', 'fast'], default: 'auto' },
      },
      required: ['kind'],
    };
    const secStatusSchema = { type: 'object', properties: {} };

    return [
      {
        name: 'ghostdesk_list_workspace_windows',
        description: 'Lists all authorized application windows within the AI employee workspace.',
        parameters: listWindowsSchema,
        inputSchema: listWindowsSchema,
      },
      {
        name: 'ghostdesk_switch_focus',
        description: 'Safely switches active focus to another authorized application window in the workspace.',
        parameters: switchFocusSchema,
        inputSchema: switchFocusSchema,
      },
      {
        name: 'ghostdesk_act',
        description:
          'Executes an action (click, type, key, scroll) on the active window. Automatically routes between Ghost Channel (physical Pico USB HID for high-risk apps like WeChat) and Fast Channel (high-speed native injection for safe office apps like Excel).',
        parameters: actSchema,
        inputSchema: actSchema,
      },
      {
        name: 'ghostdesk_get_security_status',
        description: 'Retrieves current workspace security status, active window identity, and recent security events.',
        parameters: secStatusSchema,
        inputSchema: secStatusSchema,
      },
    ];
  }

  public async callTool(call: McpToolCall): Promise<McpToolResponse> {
    try {
      switch (call.name) {
        case 'ghostdesk_list_workspace_windows': {
          const windows = this.workspace.listWindows();
          const active = this.workspace.getActiveWindow();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ activeHwnd: active?.hwnd, total: windows.length, windows }, null, 2),
              },
            ],
          };
        }

        case 'ghostdesk_switch_focus': {
          const hwnd = String(call.arguments?.hwnd ?? '');
          const switched = this.workspace.switchFocus(hwnd);
          return {
            content: [
              {
                type: 'text',
                text: `Successfully switched focus to "${switched.title}" (${switched.process}, HWND ${switched.hwnd}).`,
              },
            ],
          };
        }

        case 'ghostdesk_act': {
          const active = this.workspace.getActiveWindow();
          if (!active) {
            return {
              content: [{ type: 'text', text: 'Error: No active window in workspace.' }],
              isError: true,
            };
          }

          const rawAction = (call.arguments ?? {}) as unknown as ComputerUseAction;
          if (!rawAction || !rawAction.kind) {
            return {
              content: [{ type: 'text', text: 'Error: Missing action "kind".' }],
              isError: true,
            };
          }

          // Sanitize coordinates and parameters
          const action = { ...rawAction };
          if (action.kind === 'click' || action.kind === 'move') {
            if (action.x !== undefined) {
              const numX = Number(action.x);
              if (isNaN(numX)) {
                return {
                  content: [{ type: 'text', text: `Error: Coordinate x must be a valid number, got ${action.x}` }],
                  isError: true,
                };
              }
              action.x = Math.max(0.0, Math.min(1.0, numX));
            }
            if (action.y !== undefined) {
              const numY = Number(action.y);
              if (isNaN(numY)) {
                return {
                  content: [{ type: 'text', text: `Error: Coordinate y must be a valid number, got ${action.y}` }],
                  isError: true,
                };
              }
              action.y = Math.max(0.0, Math.min(1.0, numY));
            }
          } else if (action.kind === 'type') {
            action.text = String(action.text ?? '');
          }

          const policy = (call.arguments?.policy as ChannelPolicy) ?? 'auto';

          const result: ExecutionResult = await this.executor.execute(active, action, { policy });
          if (!result.ok) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Action failed on [${active.title}] (${result.channel} channel): ${result.error}`,
                },
              ],
              isError: true,
            };
          }

          const speedInfo =
            result.channel === 'fast'
              ? `(Fast Channel: ${result.durationMs}ms, saved ~${result.tokensSavedEstimate} VLM tokens)`
              : `(Ghost Channel: Physical Pico USB HID, ${result.durationMs}ms)`;

          return {
            content: [
              {
                type: 'text',
                text: `Action ${action.kind} succeeded on [${active.title}] ${speedInfo}`,
              },
            ],
          };
        }

        case 'ghostdesk_get_security_status': {
          const active = this.workspace.getActiveWindow();
          const events = this.workspace.getRecentEvents(10);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: 'active',
                    activeWindow: active,
                    recentEvents: events,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown MCP tool: ${call.name}` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Tool error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }

  /**
   * Dispatches a JSON-RPC 2.0 message conforming to the Model Context Protocol.
   * Returns a JSON-RPC response object, or null for notifications that require no response.
   */
  public async handleJsonRpc(req: any): Promise<JsonRpcResponse | null> {
    if (!req || typeof req !== 'object' || typeof req.method !== 'string') {
      return {
        jsonrpc: '2.0',
        id: req?.id ?? null,
        error: { code: -32600, message: 'Invalid Request: Missing or invalid JSON-RPC method.' },
      };
    }

    const id = req.id ?? null;
    const method = req.method;

    // Handle notifications (no response expected)
    if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
      return null;
    }

    try {
      switch (method) {
        case 'initialize': {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: { listChanged: false },
              },
              serverInfo: {
                name: 'ghostdesk-mcp',
                version: '2.0.0',
              },
            },
          };
        }

        case 'ping': {
          return {
            jsonrpc: '2.0',
            id,
            result: {},
          };
        }

        case 'tools/list': {
          const tools = this.getToolDefinitions().map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema ?? t.parameters,
          }));
          return {
            jsonrpc: '2.0',
            id,
            result: { tools },
          };
        }

        case 'tools/call': {
          const params = req.params ?? {};
          const toolName = String(params.name ?? '');
          const toolArgs = params.arguments ?? {};

          const toolResponse = await this.callTool({
            name: toolName,
            arguments: toolArgs,
          });

          return {
            jsonrpc: '2.0',
            id,
            result: toolResponse,
          };
        }

        default: {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: "${method}"`,
            },
          };
        }
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: `Internal error: ${(err as Error).message}`,
        },
      };
    }
  }

  /**
   * Processes a single incoming text line (e.g. from stdio), returns serialized JSON-RPC response or null.
   */
  public async processLine(line: string): Promise<string | null> {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: Invalid JSON.' },
      });
    }

    const response = await this.handleJsonRpc(parsed);
    return response ? JSON.stringify(response) : null;
  }
}

/**
 * Starts an MCP stdio server over standard input/output streams.
 */
export function startMcpStdioServer(
  server: GhostDeskMcpServer,
  inStream: NodeJS.ReadableStream = process.stdin,
  outStream: NodeJS.WritableStream = process.stdout,
): readline.Interface {
  const rl = readline.createInterface({
    input: inStream,
    output: outStream,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const reply = await server.processLine(line);
    if (reply) {
      outStream.write(reply + '\n');
    }
  });

  return rl;
}
