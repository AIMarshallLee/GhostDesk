import { useEffect, useRef, useState } from 'react';
import { Download, MousePointer2, Plug, RefreshCw, ShieldAlert, Terminal, Unplug } from 'lucide-react';
import type { PageProps } from './App';
import type { UsbPort, UsbStatus } from '../shared/types';
import { Button, Empty, Field, PageHead } from './components';
import './hardware.css';
const blank: UsbStatus = { connected: false, armed: false };
export default function HardwarePage({ notify }: PageProps) {
  const usb = window.flowdesk?.usb; const [ports, setPorts] = useState<UsbPort[]>([]), [port, setPort] = useState(''), [status, setStatus] = useState<UsbStatus>(blank), [busy, setBusy] = useState(false), [error, setError] = useState(''), [autoDiscover, setAutoDiscover] = useState(true); const box = useRef<HTMLTextAreaElement>(null);
  const run = async (work: () => Promise<UsbStatus | void>, message?: string) => { setBusy(true); setError(''); try { const value = await work(); if (value) setStatus(value); if (message) notify(message); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } };
  useEffect(() => { if (usb) void usb.status().then(setStatus).catch(() => {}); }, [usb]);
  useEffect(() => {
    if (!usb || !autoDiscover) return;
    let active = true; let scanning = false;
    const scan = async () => {
      if (scanning) return; scanning = true;
      try {
        const result = await usb.discover();
        if (!active) return;
        setPorts(result.matches); if (result.status) setStatus(result.status);
        if (result.autoConnected) notify('已识别并连接 FlowDesk Pico；尚未执行 HID 动作。');
      } catch (cause) { if (active) setError((cause as Error).message); }
      finally { scanning = false; }
    };
    void scan(); const timer = window.setInterval(() => void scan(), 3000);
    return () => { active = false; window.clearInterval(timer); void usb.cancelDiscovery().catch(() => {}); };
  }, [usb, notify, autoDiscover]);
  if (!usb) return <><PageHead title="USB 硬件" description="物理防封硬件（Pico 1 / M5Stack CoreS3）需在桌面客户端使用；浏览器沙箱无法直接连接本地硬件。" /><section className="panel"><Empty title="请在桌面客户端中打开（支持 Windows / macOS）" detail="运行 npm run desktop 启动桌面客户端，即可无缝连接与控制你的物理防封外设。" /></section></>;
  return <div className="hardware-page"><PageHead eyebrow="PICO 1 (RP2040) & M5STACK CORES3 (ESP32-S3)" title="USB 硬件" description="连接设备后由软件开始任务；停止、断线或触屏急停会自动停止。" /><div className="hardware-layout"><main className="hardware-main">
    <section className="panel hardware-doc"><h2>连接防封硬件（Pico / CoreS3）</h2><p>支持 Raspberry Pi Pico 1（RP2040）与 M5Stack CoreS3（ESP32-S3）。软件会自动识别已证明为 FlowDesk 的 USB 元数据；唯一匹配时执行只读握手连接，不会执行误触发动作。多个匹配请手动选择端口。</p><div className="port-picker"><select value={port} aria-label="硬件串口" onChange={e => setPort(e.target.value)} disabled={busy}><option value="">选择端口</option>{ports.map(item => <option key={item.path} value={item.path}>{item.label} · {item.path}</option>)}</select><Button variant="secondary" disabled={busy} onClick={() => void run(async () => { setAutoDiscover(true); await usb.cancelDiscovery(); const result = await usb.discover(); setPorts(result.matches); if (result.status) return result.status; })}><RefreshCw size={15} />一键识别</Button><Button variant="ghost" disabled={busy} onClick={() => void run(async () => { setAutoDiscover(false); await usb.cancelDiscovery(); setPorts(await usb.ports()); })}>查看所有串口</Button><Button disabled={!port || busy || status.connected} onClick={() => void run(() => usb.connect(port), '已连接，尚未执行 HID 动作。')}><Plug size={15} />手动连接</Button></div>{!autoDiscover && <p className="notice">已暂停自动识别。可点击一键识别重新连接，或查看所有串口手动选择。</p>}{ports.length > 1 && !status.connected && autoDiscover && <p className="notice">检测到多个 FlowDesk 兼容设备，请选择需要连接的端口。</p>}{status.connected && <div className="hardware-status"><strong>{status.device || 'FlowDesk USB Bridge'} · 固件 {status.firmware || '0.5.0'}</strong><span>状态：{status.armed ? '软件任务会话活动中' : '已连接，等待软件开始'}</span><div><Button variant="secondary" disabled={busy} onClick={() => void run(() => usb.status())}>刷新状态</Button><Button variant="danger" disabled={busy} onClick={() => void run(() => usb.disarm(), '设备已停止。')}><ShieldAlert size={15} />停止设备会话</Button><Button variant="ghost" disabled={busy} onClick={() => void run(async () => { setAutoDiscover(false); await usb.cancelDiscovery(); await usb.disconnect(); setStatus(blank); }, '设备已断开。')}><Unplug size={15} />断开</Button></div></div>}</section>
    <section className="panel hardware-doc"><h2>M5Stack CoreS3 专属功能与对讲机模式</h2><p>M5Stack CoreS3 搭载 2.0 寸全彩触屏与双麦克风阵列，支持实时状态看板、触屏物理急停（STOP）、赛博眼睛情绪反馈与硬件语音对讲机模式：</p><ul style={{margin: '8px 0 16px 20px', fontSize: '13px', color: 'var(--text-secondary, #94a3b8)', lineHeight: 1.6}}><li><b>网页秒级烧录</b>：访问 <code>firmware/m5stack_cores3/web_flasher.html</code> 使用 Chrome/Edge WebSerial 免编译一键安装固件。</li><li><b>对讲机搭子联动</b>：运行 <code>python scripts/walkie_talkie.py</code>，按住屏幕或空格即可直接对讲并自动唤起 AI 输入。</li><li><b>物理急停按键</b>：屏幕底部的常驻红色 STOP 触控按钮可在毫秒级切断输入，杜绝任何失控风险。</li></ul></section>
    <section className="panel hardware-doc"><h2>软件启动与停止</h2><p>连接设备后，在“电脑操作”或“持续回复”确认并点击开始。停止任务或设备断线会自动停止。</p><p className="notice">模型截图、知识与授权范围仍以电脑操作或持续回复页面的确认流程为准。USB 不会在连接时自行发送。</p></section>
    <section className="panel hardware-doc"><h2>烧录与自建测试</h2><p>先保存 0.5 固件，再按住板上的 BOOTSEL 插入 Pico，将固件拖入 RPI-RP2。只需开发板和数据线，无需外接按钮。实物测试待开发板到货完成。</p><Button variant="secondary" disabled={busy} onClick={() => void run(async () => { const saved = await window.flowdesk!.saveFirmware(); if (!saved.saved) throw new Error('未保存固件文件。'); notify(`固件已保存到 ${saved.path || '所选位置'}`); })}><Download size={15} />保存 0.5 UF2</Button><Field label="自建测试输入区" hint="点击“测试输入”后，设备会在此输入 FlowDesk，完成后自动停止。"><textarea id="hardware-test-input" ref={box} rows={2} aria-label="USB 自建测试输入区" /></Field><div className="hardware-test-actions"><Button disabled={busy || !status.connected} onClick={() => { box.current?.focus(); void run(() => usb.test('type'), '测试完成。'); }}><Terminal size={15} />测试输入</Button><Button variant="secondary" disabled={busy || !status.connected} onClick={() => void run(() => usb.test('move'), '测试完成。')}><MousePointer2 size={15} />测试移动</Button></div></section>
  </main></div>{error && <p className="hardware-error" role="alert"><ShieldAlert size={16} /> {error}</p>}</div>;
}
