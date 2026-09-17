import { randomBytes } from 'node:crypto';
import { setTimeout, clearTimeout } from 'node:timers';
import type { UsbStatus } from '../shared/types';
import { createUsbChannel, portOk, type UsbReply } from './usb-channel';

export interface UsbSession {
  check(): void;
  command(command: string): Promise<void>;
  stop(): Promise<void>;
}
type Channel = { exchange(command: string): Promise<UsbReply>; close(): void };

export function createUsbDevice(scriptPath: string, dependencies: {
  channel?: (port: string) => Channel;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>; clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
} = {}) {
  let channel: Channel | undefined;
  let state: UsbStatus = { connected: false, armed: false };
  let tail = Promise.resolve();
  let owner: UsbSession | undefined;
  let connecting = false;
  let connectionEpoch = 0;
  const set: NonNullable<typeof dependencies.setTimer> = dependencies.setTimer ?? ((callback, ms) => setTimeout(callback, ms) as ReturnType<typeof setTimeout>);
  const clear = dependencies.clearTimer ?? clearTimeout;
  const serial = <T>(action: () => Promise<T>) => {
    const next = tail.then(action); tail = next.then(() => {}, () => {}); return next;
  };
  const exchange = (command: string) => serial(async () => {
    if (!channel) throw new Error('请先连接 USB 设备。');
    try {
      const reply = await channel.exchange(command);
      state = { ...state, connected: true, device: reply.device, firmware: reply.firmware, board: reply.board,
        protocol: reply.protocol, armed: reply.armed, session: reply.session, leaseMs: reply.leaseMs, message: '' };
      return reply;
    } catch (error) {
      channel.close(); channel = undefined;
      state = { connected: false, armed: false, message: 'USB 通信中断；已停止，不会切换为软件输入。设备最迟在心跳超时后释放。' };
      throw error;
    }
  });
  const stateCopy = () => structuredClone(state);
  const requireHealthy = async () => {
    if (!channel) throw new Error('必须连接匹配的 FlowDesk Pico USB 或 M5Stack CoreS3 设备后才能使用。');
    const reply = await exchange('status');
    const isPico = reply.protocol === 4 && reply.device === 'FlowDesk USB Bridge' && reply.board === 'pico' && reply.firmware === '0.5.0';
    const isCoreS3 = reply.protocol === 4 && (reply.device === 'FlowDesk CyberDeck Pro' || reply.board === 'm5stack-cores3');
    if (!isPico && !isCoreS3) {
      state = { ...state, message: 'USB 设备或固件不匹配；需要 FlowDesk Pico 1 (固件 0.5.0) 或 M5Stack CoreS3 (固件 0.8.0+)。' };
      throw new Error(state.message);
    }
    return stateCopy();
  };
  const device = {
    state: stateCopy,
    requireHealthy,
    busy: () => !!owner || connecting,
    async connect(port: string) {
      if (owner || connecting) throw new Error('请先停止 USB 任务。');
      if (!portOk(port)) throw new Error('请选择有效串口。');
      connecting = true;
      const token = ++connectionEpoch;
      const current = () => { if (token !== connectionEpoch) throw new Error('USB 连接已取消。'); };
      try {
        await tail; current(); channel?.close(); channel = (dependencies.channel ?? (port => createUsbChannel(scriptPath, port)))(port);
        state = { connected: false, armed: false, port };
        const reply = await exchange('hello'); current();
        // A connection never inherits another run's armed session.
        if (reply.session) await exchange('disarm'); current();
        return stateCopy();
      } finally { connecting = false; }
    },
    async status() { if (channel) { try { await exchange('status'); } catch { /* state contains bounded error */ } } return stateCopy(); },
    async disarm() { connectionEpoch++; if (owner) await owner.stop(); else if (channel) await exchange('disarm'); return stateCopy(); },
    async disconnect() {
      try { await device.disarm(); } finally { channel?.close(); channel = undefined; state = { connected: false, armed: false }; }
    },
    async begin(signal?: AbortSignal): Promise<UsbSession> {
      if (owner || connecting) throw new Error('USB 已被另一项任务占用。');
      signal?.throwIfAborted();
      let stopped = false; let failed = false; let timer: ReturnType<typeof setTimeout> | undefined;
      let stopping: Promise<void> | undefined;
      const nonce = randomBytes(8).toString('hex');
      const check = () => {
        signal?.throwIfAborted();
        if (stopped || failed || !channel || !state.connected || !state.armed || state.session !== nonce) throw new Error('USB 已停止或连接失效，请在软件中重新启动。');
      };
      const verify = (reply: UsbReply) => { if (!reply.armed || reply.session !== nonce || reply.leaseMs <= 0) throw new Error('USB 会话授权已失效。'); };
      const abort = () => { void session.stop().catch(() => {}); };
      const keepAlive = () => {
        if (stopped || failed) return;
        timer = set(() => {
          timer = undefined;
          void (async () => { check(); verify(await exchange(`ping\t${nonce}`)); check(); })()
            .then(keepAlive, () => { failed = true; void session.stop().catch(() => {}); });
        }, 2000);
      };
      const session: UsbSession = {
        check,
        async command(command) {
          check();
          const fields = command.split('\t');
          if (!['move', 'click', 'wheel', 'paste', 'key', 'text'].includes(fields[0])) throw new Error('USB 动作无效。');
          // Recheck inside the shared queue so pause also cancels actions waiting behind a heartbeat.
          await serial(async () => {
            check();
            const bound = channel!;
            try {
              const reply = await bound.exchange([fields[0], nonce, ...fields.slice(1)].join('\t'));
              verify(reply); check();
            } catch (error) { failed = true; void session.stop().catch(() => {}); throw error; }
          });
        },
        stop() {
          if (stopping) return stopping;
          stopped = true; if (timer) clear(timer); signal?.removeEventListener('abort', abort);
          stopping = (async () => {
            try { if (channel) { const reply = await exchange('disarm'); if (reply.armed || reply.session) throw new Error('USB 未确认停止。'); } }
            finally { if (owner === session) owner = undefined; }
          })();
          return stopping;
        },
      };
      owner = session; signal?.addEventListener('abort', abort, { once: true });
      try {
        const ready = await exchange('status'); signal?.throwIfAborted();
        if (stopped || ready.armed || ready.session) throw new Error('USB 未处于待机状态，请先停止再重新启动。');
        verify(await exchange(`begin\t${nonce}`)); check(); keepAlive(); return session;
      } catch (error) { await session.stop().catch(() => {}); throw error; }
    },
  };
  return device;
}
export type UsbDevice = ReturnType<typeof createUsbDevice>;
