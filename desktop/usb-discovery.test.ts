import assert from 'node:assert/strict';
import test from 'node:test';
import { createUsbDevice } from './usb-device';
import { createUsbDiscovery, parseFlowDeskUsbRecords, windowsFlowDeskMetadataScript } from './usb-discovery';
import type { UsbReply } from './usb-channel';

const reply = (): UsbReply => ({ id: 1, ok: true, protocol: 4, device: 'FlowDesk USB Bridge', firmware: '0.5.0', board: 'pico', armed: false, session: '', leaseMs: 0 });
const matching = (path = 'COM12') => ({ path, label: `USB Serial Device (${path})`, instanceId: 'USB\\VID_CAFE&PID_4001&MI_00\\FLOWDESK', product: 'FlowDesk USB Bridge', manufacturer: 'FlowDesk' });

test('只接受 VID/PID 与父设备 FlowDesk 产品元数据匹配的串口，制造商仅展示', () => {
  const ports = parseFlowDeskUsbRecords([matching(), { ...matching('COM13'), product: 'USB Serial Device' }, { ...matching('COM14'), manufacturer: 'Other' }, { ...matching('COM15'), instanceId: 'USB\\VID_1234&PID_4001' }, { ...matching('COM16'), path: 'COM0' }]);
  assert.deepEqual(ports, [{ path: 'COM12', label: 'USB Serial Device (COM12)', product: 'FlowDesk USB Bridge', manufacturer: 'FlowDesk' }, { path: 'COM14', label: 'USB Serial Device (COM14)', product: 'FlowDesk USB Bridge', manufacturer: 'Other' }]);
  assert.match(windowsFlowDeskMetadataScript, /DEVPKEY_Device_BusReportedDeviceDesc/);
  assert.match(windowsFlowDeskMetadataScript, /DEVPKEY_Device_Parent/);
  assert.match(windowsFlowDeskMetadataScript, /\$depth -lt 4/);
  assert.match(windowsFlowDeskMetadataScript, /\$flowDeskMatches/);
});

test('无设备或多设备只返回候选，唯一匹配只读握手且绝不 begin HID', async () => {
  const commands: string[] = [];
  const device = createUsbDevice('fake', { channel: () => ({ exchange: async command => { commands.push(command); return reply(); }, close() {} }) });
  let ports = [] as ReturnType<typeof parseFlowDeskUsbRecords>;
  const discovery = createUsbDiscovery({ device, list: async () => ports });
  assert.deepEqual(await discovery.refresh(), { matches: [], autoConnected: false });
  ports = [parseFlowDeskUsbRecords(matching())[0], parseFlowDeskUsbRecords(matching('COM13'))[0]];
  assert.equal((await discovery.refresh()).autoConnected, false);
  assert.deepEqual(commands, []);
  ports = [parseFlowDeskUsbRecords(matching())[0]];
  const result = await discovery.refresh();
  assert.equal(result.autoConnected, true); assert.equal(result.status?.connected, true);
  assert.deepEqual(commands, ['hello', 'status']);
  assert.equal(commands.some((command: string) => command.startsWith('begin\t')), false);
  await device.disconnect();
});

test('不兼容协议会断开自动识别连接，且不启动 HID', async () => {
  const commands: string[] = [];
  const device = createUsbDevice('fake', { channel: () => ({ exchange: async command => { commands.push(command); return { ...reply(), protocol: 3 } as unknown as UsbReply; }, close() {} }) });
  const discovery = createUsbDiscovery({ device, list: async () => [parseFlowDeskUsbRecords(matching())[0]] });
  await assert.rejects(discovery.refresh(), /不匹配/);
  assert.equal(device.state().connected, false);
  assert.equal(commands.some((command: string) => command.startsWith('begin\t')), false);
});

test('取消唯一匹配的并发识别会断开旧连接且不重放 HID', async () => {
  let release!: (value: UsbReply) => void; const commands: string[] = [];
  const device = createUsbDevice('fake', { channel: () => ({ exchange: async command => {
    commands.push(command); if (command === 'hello') return new Promise(resolve => { release = resolve; }); return reply();
  }, close() {} }) });
  const discovery = createUsbDiscovery({ device, list: async () => [parseFlowDeskUsbRecords(matching())[0]] });
  const pending = discovery.refresh(); await new Promise(resolve => setImmediate(resolve));
  const cancelling = discovery.cancel(); release(reply());
  await assert.rejects(pending, /取消/); await cancelling;
  assert.equal(device.state().connected, false);
  assert.equal(commands.some((command: string) => command.startsWith('begin\t')), false);
});

test('并发刷新复用同一识别，取消等待迟到连接清理后仍可手动连接', async () => {
  let release!: (value: UsbReply) => void; let first = true; const commands: string[] = [];
  const device = createUsbDevice('fake', { channel: () => ({ exchange: async command => {
    commands.push(command); if (command === 'hello' && first) { first = false; return new Promise(resolve => { release = resolve; }); } return reply();
  }, close() {} }) });
  const discovery = createUsbDiscovery({ device, list: async () => [parseFlowDeskUsbRecords(matching())[0]] });
  const one = discovery.refresh(), two = discovery.refresh(); assert.equal(one, two);
  await new Promise(resolve => setImmediate(resolve)); const cancelling = discovery.cancel(); release(reply());
  await assert.rejects(one, /取消/); await cancelling;
  await device.connect('COM12'); await device.requireHealthy();
  assert.equal(device.state().connected, true);
  assert.equal(commands.filter(command => command === 'hello').length, 2);
  assert.equal(commands.some((command: string) => command.startsWith('begin\t')), false);
});

test('活动任务时发现仅返回元数据，不执行连接', async () => {
  const commands: string[] = [];
  const device = createUsbDevice('fake', { channel: () => ({ exchange: async command => { commands.push(command); return reply(); }, close() {} }) });
  const discovery = createUsbDiscovery({ device, list: async () => [parseFlowDeskUsbRecords(matching())[0]], canConnect: () => false });
  const result = await discovery.refresh();
  assert.equal(result.autoConnected, false); assert.deepEqual(commands, []);
});

test('已连接设备拔出后发现只读状态会返回离线，不按缺失元数据盲目重连', async () => {
  let unplugged = false; const commands: string[] = [];
  const device = createUsbDevice('fake', { channel: () => ({ exchange: async command => {
    commands.push(command); if (unplugged && command === 'status') throw new Error('fictional unplug'); return reply();
  }, close() {} }) });
  await device.connect('COM12');
  const discovery = createUsbDiscovery({ device, list: async () => [] });
  unplugged = true;
  const result = await discovery.refresh();
  assert.deepEqual(result.matches, []); assert.equal(result.autoConnected, false); assert.equal(result.status?.connected, false);
  assert.equal(commands.some((command: string) => command.startsWith('begin\t')), false);
});
