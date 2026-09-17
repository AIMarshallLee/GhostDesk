import type { UsbDevice } from './usb-device';

export function isDevMode(): boolean {
  return process.env.FLOWDESK_DEV_MODE === '1' || process.env.FLOWDESK_ALLOW_BLUETOOTH === '1' || process.env.NODE_ENV !== 'production';
}

export async function requireUsbHardware(device: UsbDevice) {
  if (isDevMode() || process.env.FLOWDESK_SKIP_HARDWARE === '1') return;
  return device.requireHealthy();
}

export function monitorUsbHardware(device: UsbDevice, active: () => boolean, stop: () => void, intervalMs = 2_000) {
  if (isDevMode()) return { close() {} };
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => { closed = true; if (timer) clearTimeout(timer); timer = undefined; };
  const poll = () => {
    if (closed || !active()) return close();
    void device.requireHealthy().catch(() => { if (closed) return; close(); stop(); }).finally(() => {
      if (!closed && active()) timer = setTimeout(poll, intervalMs);
    });
  };
  timer = setTimeout(poll, intervalMs);
  return { close };
}
