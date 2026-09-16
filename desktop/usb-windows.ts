import type { ComputerUseTarget } from '../shared/computer-use';
import { createWindowsComputerUseDriver } from './cu-windows';
import { createUsbInputDriver } from './usb-input';
import type { UsbDevice } from './usb-device';
import { typeWithPinyin } from './ime-typing';
import type { ChatImage } from './reply-model';
import type { ImeScene } from '../shared/ime';

export async function createUsbWindowsDriver(target: ComputerUseTarget, scriptPath: string, device: UsbDevice, signal?: AbortSignal, readIme?: (image: ChatImage, signal: AbortSignal) => Promise<ImeScene>) {
  const observer = await createWindowsComputerUseDriver(target, scriptPath, signal, true);
  return createUsbInputDriver({ observer, signal, begin: () => device.begin(signal),
    typeText: async (text, command, check) => {
      if (!readIme) throw new Error('请在设置中配置可识别候选词的普通视觉模型。');
      const inputSignal = signal ?? new AbortController().signal;
      await typeWithPinyin(text, { command, check, signal: inputSignal, read: async () => {
        await check(); const image = await observer.observeInput(); await check();
        const scene = await readIme(image, inputSignal); await check(); return scene;
      } });
    },
  });
}
