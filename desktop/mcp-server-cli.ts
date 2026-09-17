#!/usr/bin/env node
/**
 * GhostDesk MCP Server CLI
 *
 * Runs the standard Model Context Protocol (MCP 2024-11-05) server over stdio.
 * Can be added to Claude Desktop configuration (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "ghostdesk": {
 *       "command": "npx",
 *       "args": ["tsx", "<path-to-repo>/desktop/mcp-server-cli.ts"]
 *     }
 *   }
 * }
 */

import { MultiWindowWorkspace } from './workspace-manager';
import { HybridExecutor, type GhostDriver, type FastDriver } from './hybrid-executor';
import { GhostDeskMcpServer, startMcpStdioServer } from './mcp-server';
import type { ComputerUseAction } from '../shared/computer-use';
import type { WindowIdentity } from './workspace-manager';

const ghostDriver: GhostDriver = {
  async execute(action: ComputerUseAction, target: WindowIdentity) {
    console.error(`[GhostDesk MCP] Ghost Channel action: ${action.kind} on ${target.title}`);
  },
};

const fastDriver: FastDriver = {
  async execute(action: ComputerUseAction, target: WindowIdentity) {
    console.error(`[GhostDesk MCP] Fast Channel action: ${action.kind} on ${target.title}`);
  },
};

const workspace = new MultiWindowWorkspace();
const executor = new HybridExecutor(ghostDriver, fastDriver);
const server = new GhostDeskMcpServer(workspace, executor);

startMcpStdioServer(server);
console.error('[GhostDesk MCP] Stdio server initialized. Listening for JSON-RPC 2.0 messages...');
