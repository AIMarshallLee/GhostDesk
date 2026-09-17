import test from 'node:test';
import assert from 'node:assert/strict';
import { GhostDeskMcpServer } from './mcp-server';
import { MultiWindowWorkspace, type WindowIdentity } from './workspace-manager';
import { HybridExecutor, type GhostDriver, type FastDriver } from './hybrid-executor';

const winWechat: WindowIdentity = {
  hwnd: '3001',
  pid: 101,
  process: 'wechat.exe',
  title: '微信客户群',
};

const winExcel: WindowIdentity = {
  hwnd: '3002',
  pid: 102,
  process: 'excel.exe',
  title: '2026发票流水.xlsx',
};

test('MCP server lists tool definitions', () => {
  const ws = new MultiWindowWorkspace([winWechat, winExcel]);
  const server = new GhostDeskMcpServer(
    ws,
    new HybridExecutor({ async execute() {} }, { async execute() {} }),
  );

  const tools = server.getToolDefinitions();
  assert.equal(tools.length, 5);
  assert.ok(tools.some((t) => t.name === 'ghostdesk_list_workspace_windows'));
  assert.ok(tools.some((t) => t.name === 'ghostdesk_switch_focus'));
  assert.ok(tools.some((t) => t.name === 'ghostdesk_act'));
  assert.ok(tools.some((t) => t.name === 'ghostdesk_get_security_status'));
  assert.ok(tools.some((t) => t.name === 'ghostdesk_get_hardware_status'));
});

test('MCP server executes list_workspace_windows tool', async () => {
  const ws = new MultiWindowWorkspace([winWechat, winExcel]);
  const server = new GhostDeskMcpServer(
    ws,
    new HybridExecutor({ async execute() {} }, { async execute() {} }),
  );

  const res = await server.callTool({
    name: 'ghostdesk_list_workspace_windows',
    arguments: {},
  });

  assert.equal(res.isError, undefined);
  const data = JSON.parse(res.content[0].text!);
  assert.equal(data.total, 2);
  assert.equal(data.activeHwnd, '3001');
});

test('MCP server switches focus and executes hybrid action', async () => {
  const ws = new MultiWindowWorkspace([winWechat, winExcel]);
  let executedChannel: string | undefined;

  const ghostDriver: GhostDriver = {
    async execute() {
      executedChannel = 'ghost';
    },
  };
  const fastDriver: FastDriver = {
    async execute() {
      executedChannel = 'fast';
    },
  };

  const server = new GhostDeskMcpServer(ws, new HybridExecutor(ghostDriver, fastDriver));

  // 1. First act on WeChat -> should be Ghost channel
  const actWechat = await server.callTool({
    name: 'ghostdesk_act',
    arguments: { kind: 'type', text: '你好' },
  });
  assert.equal(actWechat.isError, undefined);
  assert.equal(executedChannel, 'ghost');
  assert.match(actWechat.content[0].text!, /Ghost Channel/);

  // 2. Switch focus to Excel
  const switchRes = await server.callTool({
    name: 'ghostdesk_switch_focus',
    arguments: { hwnd: '3002' },
  });
  assert.equal(switchRes.isError, undefined);
  assert.match(switchRes.content[0].text!, /2026发票流水/);

  // 3. Act on Excel -> should be Fast channel
  const actExcel = await server.callTool({
    name: 'ghostdesk_act',
    arguments: { kind: 'type', text: '12345.67' },
  });
  assert.equal(actExcel.isError, undefined);
  assert.equal(executedChannel, 'fast');
  assert.match(actExcel.content[0].text!, /Fast Channel/);
});

test('MCP server rejects unauthorized window switch', async () => {
  const ws = new MultiWindowWorkspace([winWechat]);
  const server = new GhostDeskMcpServer(
    ws,
    new HybridExecutor({ async execute() {} }, { async execute() {} }),
  );

  const res = await server.callTool({
    name: 'ghostdesk_switch_focus',
    arguments: { hwnd: '99999' },
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text!, /Workspace Security Violation/);
});

test('MCP server handles JSON-RPC initialize and ping', async () => {
  const ws = new MultiWindowWorkspace([winWechat]);
  const server = new GhostDeskMcpServer(
    ws,
    new HybridExecutor({ async execute() {} }, { async execute() {} }),
  );

  const initRes = await server.handleJsonRpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' },
  });
  assert.equal(initRes?.id, 1);
  assert.equal((initRes?.result as any)?.protocolVersion, '2024-11-05');
  assert.equal((initRes?.result as any)?.serverInfo?.name, 'ghostdesk-mcp');

  const pingRes = await server.handleJsonRpc({ jsonrpc: '2.0', id: 2, method: 'ping' });
  assert.equal(pingRes?.id, 2);
  assert.deepEqual(pingRes?.result, {});

  // Notification returns null
  const notifRes = await server.handleJsonRpc({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
  assert.equal(notifRes, null);
});

test('MCP server handles JSON-RPC tools/list with inputSchema', async () => {
  const ws = new MultiWindowWorkspace([winWechat]);
  const server = new GhostDeskMcpServer(
    ws,
    new HybridExecutor({ async execute() {} }, { async execute() {} }),
  );

  const listRes = await server.handleJsonRpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  assert.equal(listRes?.id, 3);
  const tools = (listRes?.result as any)?.tools;
  assert.ok(Array.isArray(tools));
  assert.equal(tools.length, 5);
  assert.ok(tools.every((t: any) => t.inputSchema && typeof t.inputSchema === 'object'));
});

test('MCP server clamps coordinates and rejects invalid coordinates', async () => {
  const ws = new MultiWindowWorkspace([winExcel]);
  let capturedAction: any;
  const fastDriver: FastDriver = {
    async execute(action) {
      capturedAction = action;
    },
  };
  const server = new GhostDeskMcpServer(ws, new HybridExecutor({ async execute() {} }, fastDriver));

  // Clamps out of bounds coordinates
  const callRes = await server.handleJsonRpc({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'ghostdesk_act',
      arguments: { kind: 'click', x: 1.5, y: -0.2 },
    },
  });
  assert.equal(callRes?.id, 4);
  assert.equal((callRes?.result as any)?.isError, undefined);
  assert.equal(capturedAction?.x, 1.0);
  assert.equal(capturedAction?.y, 0.0);

  // Rejects NaN coordinates
  const invalidRes = await server.callTool({
    name: 'ghostdesk_act',
    arguments: { kind: 'click', x: 'not-a-number' as any },
  });
  assert.equal(invalidRes.isError, true);
  assert.match(invalidRes.content[0].text!, /must be a valid number/);
});

test('MCP server processes line with proper JSON-RPC error on invalid JSON', async () => {
  const ws = new MultiWindowWorkspace([winExcel]);
  const server = new GhostDeskMcpServer(
    ws,
    new HybridExecutor({ async execute() {} }, { async execute() {} }),
  );

  const errorLine = await server.processLine('{ invalid json here');
  assert.ok(errorLine !== null);
  const parsed = JSON.parse(errorLine!);
  assert.equal(parsed.error.code, -32700);

  const unknownMethod = await server.processLine(JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'unknown_method' }));
  const parsedMethod = JSON.parse(unknownMethod!);
  assert.equal(parsedMethod.error.code, -32601);
});

test('MCP server executes get_hardware_status tool and integrates hardware into security status', async () => {
  const ws = new MultiWindowWorkspace([winExcel]);
  const mockHardwareProvider = () => ({
    connected: true,
    armed: true,
    device: 'CH9329 USB HID / FlowDesk Pico',
    channel: 'ghost',
  });

  const server = new GhostDeskMcpServer(
    ws,
    new HybridExecutor({ async execute() {} }, { async execute() {} }),
    mockHardwareProvider,
  );

  // 1. Dedicated tool call
  const hwRes = await server.callTool({
    name: 'ghostdesk_get_hardware_status',
    arguments: {},
  });
  assert.equal(hwRes.isError, undefined);
  const hwData = JSON.parse(hwRes.content[0].text!);
  assert.equal(hwData.connected, true);
  assert.equal(hwData.armed, true);
  assert.equal(hwData.device, 'CH9329 USB HID / FlowDesk Pico');

  // 2. Security status integration
  const secRes = await server.callTool({
    name: 'ghostdesk_get_security_status',
    arguments: {},
  });
  assert.equal(secRes.isError, undefined);
  const secData = JSON.parse(secRes.content[0].text!);
  assert.equal(secData.hardware.connected, true);
  assert.equal(secData.hardware.channel, 'ghost');
});

