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
  assert.equal(tools.length, 4);
  assert.ok(tools.some((t) => t.name === 'ghostdesk_list_workspace_windows'));
  assert.ok(tools.some((t) => t.name === 'ghostdesk_switch_focus'));
  assert.ok(tools.some((t) => t.name === 'ghostdesk_act'));
  assert.ok(tools.some((t) => t.name === 'ghostdesk_get_security_status'));
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
