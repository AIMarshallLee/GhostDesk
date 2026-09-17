#include "BleCombo.h"

BleComboClass BleCombo;

static uint8_t asciiToHid(char c, uint8_t &mod) {
  mod = 0;
  if (c >= 'a' && c <= 'z') return 0x04 + (c - 'a');
  if (c >= 'A' && c <= 'Z') {
    mod = KEY_BLE_SHIFT;
    return 0x04 + (c - 'A');
  }
  if (c >= '1' && c <= '9') return 0x1E + (c - '1');
  if (c == '0') return 0x27;
  if (c == '\n' || c == '\r') return HID_KEY_RETURN;
  if (c == '\t') return HID_KEY_TAB;
  if (c == ' ') return HID_KEY_SPACE;

  switch (c) {
    case '-': return 0x2D;
    case '=': return 0x2E;
    case '[': return 0x2F;
    case ']': return 0x30;
    case '\\': return 0x31;
    case ';': return 0x33;
    case '\'': return 0x34;
    case '`': return 0x35;
    case ',': return 0x36;
    case '.': return 0x37;
    case '/': return 0x38;
    case '!': mod = KEY_BLE_SHIFT; return 0x1E;
    case '@': mod = KEY_BLE_SHIFT; return 0x1F;
    case '#': mod = KEY_BLE_SHIFT; return 0x20;
    case '$': mod = KEY_BLE_SHIFT; return 0x21;
    case '%': mod = KEY_BLE_SHIFT; return 0x22;
    case '^': mod = KEY_BLE_SHIFT; return 0x23;
    case '&': mod = KEY_BLE_SHIFT; return 0x24;
    case '*': mod = KEY_BLE_SHIFT; return 0x25;
    case '(': mod = KEY_BLE_SHIFT; return 0x26;
    case ')': mod = KEY_BLE_SHIFT; return 0x27;
    case '_': mod = KEY_BLE_SHIFT; return 0x2D;
    case '+': mod = KEY_BLE_SHIFT; return 0x2E;
    case '{': mod = KEY_BLE_SHIFT; return 0x2F;
    case '}': mod = KEY_BLE_SHIFT; return 0x30;
    case '|': mod = KEY_BLE_SHIFT; return 0x31;
    case ':': mod = KEY_BLE_SHIFT; return 0x33;
    case '"': mod = KEY_BLE_SHIFT; return 0x34;
    case '~': mod = KEY_BLE_SHIFT; return 0x35;
    case '<': mod = KEY_BLE_SHIFT; return 0x36;
    case '>': mod = KEY_BLE_SHIFT; return 0x37;
    case '?': mod = KEY_BLE_SHIFT; return 0x38;
    default: return 0;
  }
}

void BleComboClass::print(const String& s) {
  for (size_t i = 0; i < s.length(); ++i) {
    uint8_t mod = 0;
    uint8_t hid = asciiToHid(s[i], mod);
    if (hid != 0) {
      writeKey(mod, hid);
      delay(12);
    }
  }
}

void BleComboClass::mousePress(uint8_t btn) {
  if (!_connected || !inputMouse) return;
  _mouseButtons |= btn;
  moveMouse(0, 0, 0);
}

void BleComboClass::mouseRelease(uint8_t btn) {
  if (!_connected || !inputMouse) return;
  _mouseButtons &= ~btn;
  moveMouse(0, 0, 0);
}
