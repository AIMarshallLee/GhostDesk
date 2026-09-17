/**
 * CH9329 Serial-to-HID Dongle Protocol Driver
 *
 * CH9329 is an industrial turnkey USB-HID chip. It receives standard binary frames
 * over a UART/Virtual COM port and automatically translates them into physical
 * USB HID Keyboard and Mouse events on the host OS.
 *
 * Protocol Format:
 * Frame Header: 0x57, 0xAB (Fixed)
 * Address/Reserved: 0x00
 * Command: 0x02 (Key), 0x05 (Mouse), 0x03 (ASCII String), 0x01 (Get Info)
 * Length: byte count of payload
 * Payload: [data...]
 * Checksum: (sum of all preceding bytes from 0x57 to payload end) & 0xFF
 */

export interface Ch9329KeyReport {
  modifier: number; // bit0: LCtrl, bit1: LShift, bit2: LAlt, bit3: LGUI/Win/Cmd, bit4: RCtrl...
  reserved: number; // 0x00
  keys: [number, number, number, number, number, number]; // up to 6 keycodes
}

export interface Ch9329MouseReport {
  buttons: number; // bit0: Left, bit1: Right, bit2: Middle
  deltaX: number;  // -127 to 127
  deltaY: number;  // -127 to 127
  wheel: number;   // -127 to 127
}

export class Ch9329Protocol {
  public static readonly HEAD1 = 0x57;
  public static readonly HEAD2 = 0xAB;

  public static readonly CMD_GET_INFO = 0x01;
  public static readonly CMD_SEND_KEY = 0x02;
  public static readonly CMD_SEND_ASCII = 0x03;
  public static readonly CMD_SEND_REL_MOUSE = 0x05;

  /**
   * Calculates the 8-bit checksum for a CH9329 frame.
   */
  public static calculateChecksum(data: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum = (sum + data[i]) & 0xFF;
    }
    return sum;
  }

  /**
   * Builds a complete CH9329 command frame with header, length, and checksum.
   */
  public static buildFrame(cmd: number, payload: Uint8Array): Uint8Array {
    const frame = new Uint8Array(5 + payload.length + 1);
    frame[0] = Ch9329Protocol.HEAD1;
    frame[1] = Ch9329Protocol.HEAD2;
    frame[2] = 0x00; // Address
    frame[3] = cmd;
    frame[4] = payload.length;
    frame.set(payload, 5);

    const checksumSlice = frame.subarray(0, 5 + payload.length);
    frame[5 + payload.length] = Ch9329Protocol.calculateChecksum(checksumSlice);
    return frame;
  }

  /**
   * Builds an 8-byte HID keyboard packet.
   */
  public static buildKeyFrame(report: Ch9329KeyReport): Uint8Array {
    const payload = new Uint8Array(8);
    payload[0] = report.modifier & 0xFF;
    payload[1] = 0x00;
    for (let i = 0; i < 6; i++) {
      payload[2 + i] = (report.keys[i] ?? 0) & 0xFF;
    }
    return Ch9329Protocol.buildFrame(Ch9329Protocol.CMD_SEND_KEY, payload);
  }

  /**
   * Builds a keyboard release frame (all keys released).
   */
  public static buildReleaseAllKeysFrame(): Uint8Array {
    return Ch9329Protocol.buildKeyFrame({
      modifier: 0,
      reserved: 0,
      keys: [0, 0, 0, 0, 0, 0],
    });
  }

  /**
   * Builds a relative mouse movement / click frame.
   */
  public static buildMouseRelativeFrame(report: Ch9329MouseReport): Uint8Array {
    const payload = new Uint8Array(5);
    payload[0] = 0x01; // Mouse Mode: Relative
    payload[1] = report.buttons & 0x07;
    // Clamp signed bytes to -127 .. 127
    payload[2] = Math.max(-127, Math.min(127, Math.round(report.deltaX))) & 0xFF;
    payload[3] = Math.max(-127, Math.min(127, Math.round(report.deltaY))) & 0xFF;
    payload[4] = Math.max(-127, Math.min(127, Math.round(report.wheel))) & 0xFF;

    return Ch9329Protocol.buildFrame(Ch9329Protocol.CMD_SEND_REL_MOUSE, payload);
  }

  /**
   * Builds an ASCII text string typing packet (CH9329 automatic character keystroke generation).
   */
  public static buildAsciiTextFrame(text: string): Uint8Array {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text.slice(0, 50)); // Max 50 chars per frame
    return Ch9329Protocol.buildFrame(Ch9329Protocol.CMD_SEND_ASCII, bytes);
  }

  /**
   * Builds a mouse release frame (all mouse buttons released).
   */
  public static buildReleaseMouseButtonsFrame(): Uint8Array {
    return Ch9329Protocol.buildMouseRelativeFrame({
      buttons: 0,
      deltaX: 0,
      deltaY: 0,
      wheel: 0,
    });
  }
}
