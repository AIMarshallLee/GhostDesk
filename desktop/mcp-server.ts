import { MultiWindowWorkspace, type WindowIdentity } from './workspace-manager';
import { HybridExecutor, type ExecutionResult } from './hybrid-executor';
import { resolveExecutionChannel, type ChannelPolicy } from './hybrid-policy';
import type { ComputerUseAction } from '../shared/computer-use';

export interface McpToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface McpToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface McpToolResponse {
  content: Array<{ type: 'text' | 'image'; text?: string; data?: string }>;
  isError?: boolean;
}

/**
 * GhostDeskMcpServer provides standard Model Context Protocol (MCP) tools
 * allowing any external agent (Gemini, Claude, custom planners) to drive
 * the hardware-in-the-loop desktop substrate safely.
 */
export class GhostDeskMcpServer {
  constructor(
    private workspace: MultiWindowWorkspace,
    private executor: HybridExecutor,
  ) {}

  public getToolDefinitions(): McpToolDefinition[] {
    return [
      {
        name: 'ghostdesk_list_workspace_windows',
        description: 'Lists all authorized application windows within the AI employee workspace.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'ghostdesk_switch_focus',
        description: 'Safely switches active focus to another authorized application window in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            hwnd: { type: 'string', description: 'Window handle (HWND) of the target application' },
          },
          required: ['hwnd'],
        },
      },
      {
        name: 'ghostdesk_act',
        description:
          'Executes an action (click, type, key, scroll) on the active window. Automatically routes between Ghost Channel (physical Pico USB HID for high-risk apps like WeChat) and Fast Channel (high-speed native injection for safe office apps like Excel).',
        parameters: {
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
        },
      },
      {
        name: 'ghostdesk_get_security_status',
        description: 'Retrieves current workspace security status, active window identity, and recent security events.',
        parameters: { type: 'object', properties: {} },
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
          const hwnd = String(call.arguments.hwnd ?? '');
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

          const action = call.arguments as unknown as ComputerUseAction;
          const policy = (call.arguments.policy as ChannelPolicy) ?? 'auto';

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
}
