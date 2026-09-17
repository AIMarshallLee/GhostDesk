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
  const [webConnected, setWebConnected] = useState(false);
  const [webPortInfo, setWebPortInfo] = useState('');
  const hasWebSerial = typeof navigator !== 'undefined' && 'serial' in navigator;

  const handleWebSerialConnect = async () => {
    try {
      const nav = navigator as any;
      if (!nav.serial) throw new Error('当前浏览器不支持 WebSerial API');
      const p = await nav.serial.requestPort();
      await p.open({ baudRate: 115200 });
      setWebConnected(true);
      const info = p.getInfo ? p.getInfo() : {};
      setWebPortInfo(`VID: ${info.usbVendorId?.toString(16) || 'N/A'} PID: ${info.usbProductId?.toString(16) || 'N/A'}`);
      notify('WebSerial 串口连接成功！物理防封硬件已握手就绪。');
    } catch (cause) {
      notify(`WebSerial 连接取消或失败: ${(cause as Error).message}`);
    }
  };

  if (!usb) {
    return (
      <div className="hardware-page">
        <PageHead
          eyebrow="WEB & LEGACY OS MODE"
          title="USB 硬件与跨平台直驱"
          description="GhostDesk 支持桌面客户端全自动连接，亦支持 Windows 7 / 老旧 macOS 浏览器 WebSerial 原生直驱与 Python 轻量桥接。"
        />
        <div className="hardware-layout">
          <main className="hardware-main">
            {hasWebSerial ? (
              <section className="panel hardware-doc">
                <h2>⚡ 浏览器 WebSerial 原生直驱（已检测到支持）</h2>
                <p>你的浏览器（Chrome / Edge / Opera / Supermium）支持 WebSerial API，可直接在网页沙箱中直连 CH9329、Pico 1 或 Arduino 串口！</p>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '14px', flexWrap: 'wrap' }}>
                  <Button disabled={webConnected} onClick={() => void handleWebSerialConnect()}>
                    <Plug size={15} /> {webConnected ? '已通过 WebSerial 连接' : '选择并连接串口外设 (WebSerial)'}
                  </Button>
                  {webConnected && (
                    <Button variant="ghost" onClick={() => { setWebConnected(false); setWebPortInfo(''); notify('WebSerial 串口已断开。'); }}>
                      <Unplug size={15} /> 断开
                    </Button>
                  )}
                  {webPortInfo && <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: 600 }}>{webPortInfo} · 状态就绪</span>}
                </div>
              </section>
            ) : null}

            <section className="panel hardware-doc">
              <h2>老旧系统兼容指南（Windows 7 / macOS 10.13+）</h2>
              <p>为了让老旧工作站、极客旧机与矩阵机房也能毫无阻碍地使用 GhostDesk，我们提供三大兼容路径：</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', marginTop: '16px' }}>
                <article style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px', background: '#fafafa' }}>
                  <b style={{ color: '#0284c7' }}>1. 免客户端 · WebSerial 直连</b>
                  <p style={{ fontSize: '13px', margin: '6px 0 0', lineHeight: 1.5, color: '#475569' }}>
                    在 Windows 7 上安装 <b>Supermium</b> 或 <b>Chrome 109</b>，打开网页直接使用上方 WebSerial 连接硬件，免装 Electron 客户端。
                  </p>
                </article>
                <article style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px', background: '#fafafa' }}>
                  <b style={{ color: '#0284c7' }}>2. 极轻量 · Headless Python 桥接</b>
                  <p style={{ fontSize: '13px', margin: '6px 0 0', lineHeight: 1.5, color: '#475569' }}>
                    仅需 Python 3.8+（Win7 官方最终支持版），运行 <code>pip install ghostdesk</code>，内存占用 &lt;20MB，稳定常驻。
                  </p>
                </article>
                <article style={{ border: '1px solid #059669', borderRadius: '8px', padding: '14px', background: '#f0fdf4' }}>
                  <b style={{ color: '#059669' }}>3. 纯硬件 · CH9329 狗</b>
                  <p style={{ fontSize: '13px', margin: '6px 0 0', lineHeight: 1.5, color: '#166534' }}>
                    淘宝 15 元免刷机防封狗，买来插上任何系统均免驱动模拟物理键鼠，GhostDesk 串口帧开箱即驱。
                  </p>
                </article>
              </div>
            </section>

            <section className="panel hardware-doc">
              <h2>四大硬件形态矩阵 (Hardware Archetypes)</h2>
              <div className="guide-grid" style={{ marginTop: '16px' }}>
                <article style={{ border: '2px solid #a6d654', background: '#f6faf4' }}>
                  <b style={{ color: '#568019' }}>⭐ 极力推荐 · 零门槛免刷机</b>
                  <h3>1. CH9329 纯硬件防封狗</h3>
                  <p><strong>价格</strong>：约 ￥15（淘宝 / 拼多多 / AliExpress）<br />
                  买来插上电脑直接模拟成物理键鼠，GhostDesk 工业级二进制协议帧直驱，零门槛！</p>
                </article>
                <article>
                  <b>性价比标杆 · 固件方案</b>
                  <h3>2. Raspberry Pi Pico 1 (RP2040)</h3>
                  <p><strong>价格</strong>：约 ￥18<br />
                  按住 BOOTSEL 拖入 UF2 固件即完成烧录。双核高速响应，硬件看门狗 10 秒安全断开。</p>
                </article>
                <article>
                  <b>旗舰彩屏 · 对讲机搭子</b>
                  <h3>3. M5Stack CoreS3 (ESP32-S3)</h3>
                  <p><strong>价格</strong>：约 ￥290<br />
                  2.0 寸全彩触屏显示赛博情绪眼睛，常驻物理急停按钮，双麦克风阵列语音对讲。</p>
                </article>
                <article>
                  <b>开源极客 · 零依赖单文件</b>
                  <h3>4. 通用 Arduino 开发板</h3>
                  <p><strong>支持</strong>：Leonardo / Pro Micro / SAMD21 / Teensy<br />
                  源码 <code>firmware/arduino_universal/GhostDesk_Universal_HID.ino</code>，一键 Upload 即可！</p>
                </article>
              </div>
            </section>
          </main>
        </div>
      </div>
    );
  }
  return <div className="hardware-page"><PageHead eyebrow="CH9329 · PICO 1 (RP2040) · M5STACK CORES3 · ARDUINO UNIVERSAL" title="USB 硬件" description="连接物理防封设备后由软件开始任务；停止、断线、超时或急停会自动断开。" /><div className="hardware-layout"><main className="hardware-main">
    <section className="panel hardware-doc"><h2>连接防封硬件</h2><p>支持 CH9329 免烧录防封狗、Raspberry Pi Pico 1（RP2040）、M5Stack CoreS3（ESP32-S3）与通用 Arduino HID 开发板。软件支持自动识别或手动指定串口，握手成功前不会执行误触发动作。</p><div className="port-picker"><select value={port} aria-label="硬件串口" onChange={e => setPort(e.target.value)} disabled={busy}><option value="">选择端口</option>{ports.map(item => <option key={item.path} value={item.path}>{item.label} · {item.path}</option>)}</select><Button variant="secondary" disabled={busy} onClick={() => void run(async () => { setAutoDiscover(true); await usb.cancelDiscovery(); const result = await usb.discover(); setPorts(result.matches); if (result.status) return result.status; })}><RefreshCw size={15} />一键识别</Button><Button variant="ghost" disabled={busy} onClick={() => void run(async () => { setAutoDiscover(false); await usb.cancelDiscovery(); setPorts(await usb.ports()); })}>查看所有串口</Button><Button disabled={!port || busy || status.connected} onClick={() => void run(() => usb.connect(port), '已连接，尚未执行 HID 动作。')}><Plug size={15} />手动连接</Button></div>{!autoDiscover && <p className="notice">已暂停自动识别。可点击一键识别重新连接，或查看所有串口手动选择。</p>}{ports.length > 1 && !status.connected && autoDiscover && <p className="notice">检测到多个 FlowDesk 兼容设备，请选择需要连接的端口。</p>}{status.connected && <div className="hardware-status"><strong>{status.device || 'FlowDesk USB Bridge'} · 固件 {status.firmware || '0.5.0'}</strong><span>状态：{status.armed ? '软件任务会话活动中' : '已连接，等待软件开始'}</span><div><Button variant="secondary" disabled={busy} onClick={() => void run(() => usb.status())}>刷新状态</Button><Button variant="danger" disabled={busy} onClick={() => void run(() => usb.disarm(), '设备已停止。')}><ShieldAlert size={15} />停止设备会话</Button><Button variant="ghost" disabled={busy} onClick={() => void run(async () => { setAutoDiscover(false); await usb.cancelDiscovery(); await usb.disconnect(); setStatus(blank); }, '设备已断开。')}><Unplug size={15} />断开</Button></div></div>}</section>
    <section className="panel hardware-doc">
      <h2>四大硬件形态矩阵 (Hardware Archetypes)</h2>
      <p>GhostDesk 支持从 15 元零门槛“免刷机”防封狗，到极客自制开发板、双核 Pico，再到带彩屏与对讲机的赛博搭子：</p>
      <div className="guide-grid" style={{ marginTop: '20px' }}>
        <article style={{ border: '2px solid #a6d654', background: '#f6faf4' }}>
          <b style={{ color: '#568019' }}>⭐ 极力推荐 · 零门槛免刷机</b>
          <h3>1. CH9329 纯硬件防封狗</h3>
          <p><strong>价格</strong>：约 ￥15（淘宝 / 拼多多 / AliExpress）<br />
          <strong>免编译、免刷机、免 Python 环境</strong>。买来插上电脑直接模拟成物理键鼠，GhostDesk 通过工业级二进制协议帧直驱，对普通用户完全零门槛！</p>
        </article>
        <article>
          <b>性价比标杆 · 固件方案</b>
          <h3>2. Raspberry Pi Pico 1 (RP2040)</h3>
          <p><strong>价格</strong>：约 ￥18<br />
          按住 BOOTSEL 插入电脑，将 UF2 固件拖入磁盘即完成烧录。双核高速响应，硬件看门狗 10 秒自动安全断开。</p>
        </article>
        <article>
          <b>旗舰彩屏 · 对讲机搭子</b>
          <h3>3. M5Stack CoreS3 (ESP32-S3)</h3>
          <p><strong>价格</strong>：约 ￥290<br />
          2.0 寸全彩触屏显示赛博情绪眼睛，屏幕常驻物理急停按钮（毫秒级切断），搭载双麦克风阵列，支持语音对讲机交互。</p>
        </article>
        <article>
          <b>开源极客 · 零依赖单文件</b>
          <h3>4. 通用 Arduino 开发板</h3>
          <p><strong>支持</strong>：Leonardo / Pro Micro / SAMD21 / Teensy<br />
          单文件开源固件 <code>firmware/arduino_universal/GhostDesk_Universal_HID.ino</code>，Arduino IDE 官方库一键 Upload 即可变身！</p>
        </article>
      </div>
    </section>

    <section className="panel hardware-doc">
      <h2>M5Stack CoreS3 专属功能与对讲机模式</h2>
      <p>M5Stack CoreS3 搭载 2.0 寸全彩触屏与双麦克风阵列，支持实时状态看板、触屏物理急停（STOP）、赛博眼睛情绪反馈与硬件语音对讲机模式：</p>
      <ul style={{margin: '8px 0 16px 20px', fontSize: '13px', color: 'var(--text-secondary, #94a3b8)', lineHeight: 1.6}}>
        <li><b>网页秒级烧录</b>：访问 <code>firmware/m5stack_cores3/web_flasher.html</code> 使用 Chrome/Edge WebSerial 免编译一键安装固件。</li>
        <li><b>对讲机搭子联动</b>：运行 <code>python scripts/walkie_talkie.py</code>，按住屏幕或空格即可直接对讲并自动唤起 AI 输入。</li>
        <li><b>物理急停按键</b>：屏幕底部的常驻红色 STOP 触控按钮可在毫秒级切断输入，杜绝任何失控风险。</li>
      </ul>
    </section>
    <section className="panel hardware-doc">
      <h2>软件启动与停止</h2>
      <p>连接设备后，在“电脑操作”或“持续回复”确认并点击开始。停止任务或设备断线会自动停止。</p>
      <p className="notice">模型截图、知识与授权范围仍以电脑操作或持续回复页面的确认流程为准。USB 不会在连接时自行发送。</p>
    </section>
    <section className="panel hardware-doc">
      <h2>烧录与自建测试</h2>
      <p>先保存 0.5 固件，再按住板上的 BOOTSEL 插入 Pico，将固件拖入 RPI-RP2。若使用通用 Arduino，请直接打开 <code>firmware/arduino_universal/GhostDesk_Universal_HID.ino</code> 上传；若使用 CH9329，则直接插上免刷机！</p>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <Button variant="secondary" disabled={busy} onClick={() => void run(async () => { const saved = await window.flowdesk!.saveFirmware(); if (!saved.saved) throw new Error('未保存固件文件。'); notify(`固件已保存到 ${saved.path || '所选位置'}`); })}><Download size={15} />保存 0.5 UF2</Button>
      </div>
      <Field label="自建测试输入区" hint="点击“测试输入”后，设备会在此输入 FlowDesk，完成后自动停止。"><textarea id="hardware-test-input" ref={box} rows={2} aria-label="USB 自建测试输入区" /></Field>
      <div className="hardware-test-actions">
        <Button disabled={busy || !status.connected} onClick={() => { box.current?.focus(); void run(() => usb.test('type'), '测试完成。'); }}><Terminal size={15} />测试输入</Button>
        <Button variant="secondary" disabled={busy || !status.connected} onClick={() => void run(() => usb.test('move'), '测试完成。')}><MousePointer2 size={15} />测试移动</Button>
      </div>
    </section>
  </main></div>{error && <p className="hardware-error" role="alert"><ShieldAlert size={16} /> {error}</p>}</div>;
}
