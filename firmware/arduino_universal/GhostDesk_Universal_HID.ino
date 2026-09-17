/*
 * GhostDesk Universal HID Firmware (Protocol v4)
 * 
 * Supports:
 *   - ATmega32U4 (Arduino Leonardo, Pro Micro, LilyPad USB)
 *   - SAMD21 (Seeed Studio XIAO SAMD21, Arduino Zero, Adafruit Feather M0)
 *   - Teensy (Teensy 2.0 / 3.x / 4.x with USB Type: "Keyboard + Mouse")
 *   - RP2040 (Raspberry Pi Pico, Waveshare RP2040 using Earle Philhower core)
 *
 * Requirements:
 *   - Arduino IDE 1.8.x or 2.x
 *   - Standard libraries: <Keyboard.h> and <Mouse.h> (Built-in)
 *
 * Protocol: GhostDesk Protocol v4 (TAB-separated ASCII frames over Serial)
 */

#include <Arduino.h>
#include <Keyboard.h>
#include <Mouse.h>

#define PROTOCOL_VERSION 4
#define FIRMWARE_VERSION "0.5.0"
#define DEVICE_NAME "GhostDesk USB Bridge"
#define BOARD_NAME "Arduino-Universal"
#define HEARTBEAT_TIMEOUT_MS 10000

bool isArmed = false;
String currentSession = "";
unsigned long leaseExpireAt = 0;
long lastActionId = 0;

void disarm() {
  isArmed = false;
  currentSession = "";
  Keyboard.releaseAll();
  Mouse.release(MOUSE_LEFT);
  Mouse.release(MOUSE_RIGHT);
  Mouse.release(MOUSE_MIDDLE);
#ifdef LED_BUILTIN
  digitalWrite(LED_BUILTIN, LOW);
#endif
}

void arm(String sessionNonce) {
  isArmed = true;
  currentSession = sessionNonce;
  leaseExpireAt = millis() + HEARTBEAT_TIMEOUT_MS;
#ifdef LED_BUILTIN
  digitalWrite(LED_BUILTIN, HIGH);
#endif
}

void sendAck(long id, bool ok, const char* errorMsg = nullptr) {
  Serial.print(F("{\"id\":"));
  Serial.print(id);
  Serial.print(F(",\"ok\":"));
  Serial.print(ok ? F("true") : F("false"));
  Serial.print(F(",\"protocol\":"));
  Serial.print(PROTOCOL_VERSION);
  Serial.print(F(",\"device\":\""));
  Serial.print(F(DEVICE_NAME));
  Serial.print(F("\",\"firmware\":\""));
  Serial.print(F(FIRMWARE_VERSION));
  Serial.print(F("\",\"board\":\""));
  Serial.print(F(BOARD_NAME));
  Serial.print(F("\",\"armed\":"));
  Serial.print(isArmed ? F("true") : F("false"));
  Serial.print(F(",\"session\":\""));
  Serial.print(currentSession);
  Serial.print(F("\",\"leaseMs\":"));
  
  long remaining = 0;
  if (isArmed) {
    long diff = (long)(leaseExpireAt - millis());
    remaining = (diff > 0) ? diff : 0;
  }
  Serial.print(remaining);

  if (!ok && errorMsg != nullptr) {
    Serial.print(F(",\"error\":\""));
    Serial.print(errorMsg);
    Serial.print(F("\""));
  }
  Serial.println(F("}"));
}

void handleKeyCommand(const String& keyName) {
  if (keyName == F("enter")) {
    Keyboard.write(KEY_RETURN);
  } else if (keyName == F("tab")) {
    Keyboard.write(KEY_TAB);
  } else if (keyName == F("backspace")) {
    Keyboard.write(KEY_BACKSPACE);
  } else if (keyName == F("delete")) {
    Keyboard.write(KEY_DELETE);
  } else if (keyName == F("escape") || keyName == F("esc")) {
    Keyboard.write(KEY_ESC);
  } else if (keyName == F("up")) {
    Keyboard.write(KEY_UP_ARROW);
  } else if (keyName == F("down")) {
    Keyboard.write(KEY_DOWN_ARROW);
  } else if (keyName == F("left")) {
    Keyboard.write(KEY_LEFT_ARROW);
  } else if (keyName == F("right")) {
    Keyboard.write(KEY_RIGHT_ARROW);
  } else if (keyName == F("home")) {
    Keyboard.write(KEY_HOME);
  } else if (keyName == F("end")) {
    Keyboard.write(KEY_END);
  } else if (keyName == F("pagedown")) {
    Keyboard.write(KEY_PAGE_DOWN);
  } else if (keyName == F("pageup")) {
    Keyboard.write(KEY_PAGE_UP);
  } else if (keyName == F("shift")) {
    Keyboard.press(KEY_LEFT_SHIFT);
    delay(5);
    Keyboard.release(KEY_LEFT_SHIFT);
  } else if (keyName == F("ctrl+a")) {
    Keyboard.press(KEY_LEFT_CTRL);
    Keyboard.press('a');
    delay(10);
    Keyboard.releaseAll();
  }
}

void processLine(String line) {
  line.trim();
  if (line.length() == 0) return;

  // Split line by TAB '\t'
  int tab1 = line.indexOf('\t');
  if (tab1 == -1) {
    // Single-field command without ID is invalid
    return;
  }

  long id = line.substring(0, tab1).toInt();
  int tab2 = line.indexOf('\t', tab1 + 1);
  String cmd = (tab2 == -1) ? line.substring(tab1 + 1) : line.substring(tab1 + 1, tab2);

  if (cmd == F("hello")) {
    sendAck(id, true);
    return;
  }

  if (cmd == F("disarm")) {
    disarm();
    sendAck(id, true);
    return;
  }

  if (cmd == F("status")) {
    sendAck(id, true);
    return;
  }

  if (cmd == F("begin")) {
    if (tab2 == -1) {
      sendAck(id, false, "missing_session");
      return;
    }
    String session = line.substring(tab2 + 1);
    session.trim();
    arm(session);
    sendAck(id, true);
    return;
  }

  // All commands below require valid armed session
  if (!isArmed) {
    sendAck(id, false, "not_armed");
    return;
  }

  // Check session token
  int tab3 = line.indexOf('\t', tab2 + 1);
  String session = (tab3 == -1) ? line.substring(tab2 + 1) : line.substring(tab2 + 1, tab3);
  session.trim();

  if (session != currentSession) {
    sendAck(id, false, "session_mismatch");
    return;
  }

  // Refresh watchdog lease on any authorized command
  leaseExpireAt = millis() + HEARTBEAT_TIMEOUT_MS;

  if (cmd == F("ping")) {
    sendAck(id, true);
    return;
  }

  if (cmd == F("move")) {
    if (tab3 == -1) { sendAck(id, false, "missing_args"); return; }
    int tab4 = line.indexOf('\t', tab3 + 1);
    if (tab4 == -1) { sendAck(id, false, "missing_args"); return; }
    int dx = line.substring(tab3 + 1, tab4).toInt();
    int dy = line.substring(tab4 + 1).toInt();
    dx = constrain(dx, -127, 127);
    dy = constrain(dy, -127, 127);
    Mouse.move((signed char)dx, (signed char)dy, 0);
    sendAck(id, true);
    return;
  }

  if (cmd == F("click")) {
    if (tab3 == -1) { sendAck(id, false, "missing_args"); return; }
    String btn = line.substring(tab3 + 1);
    btn.trim();
    if (btn == F("left")) {
      Mouse.click(MOUSE_LEFT);
    } else if (btn == F("right")) {
      Mouse.click(MOUSE_RIGHT);
    } else if (btn == F("middle")) {
      Mouse.click(MOUSE_MIDDLE);
    }
    sendAck(id, true);
    return;
  }

  if (cmd == F("wheel")) {
    if (tab3 == -1) { sendAck(id, false, "missing_args"); return; }
    int scroll = line.substring(tab3 + 1).toInt();
    scroll = constrain(scroll, -127, 127);
    Mouse.move(0, 0, (signed char)scroll);
    sendAck(id, true);
    return;
  }

  if (cmd == F("paste")) {
    Keyboard.press(KEY_LEFT_CTRL);
    Keyboard.press('v');
    delay(10);
    Keyboard.releaseAll();
    sendAck(id, true);
    return;
  }

  if (cmd == F("key")) {
    if (tab3 == -1) { sendAck(id, false, "missing_args"); return; }
    String keyName = line.substring(tab3 + 1);
    keyName.trim();
    keyName.toLowerCase();
    handleKeyCommand(keyName);
    sendAck(id, true);
    return;
  }

  if (cmd == F("text")) {
    if (tab3 == -1) { sendAck(id, false, "missing_args"); return; }
    String txt = line.substring(tab3 + 1);
    Keyboard.print(txt);
    sendAck(id, true);
    return;
  }

  sendAck(id, false, "unknown_command");
}

void setup() {
#ifdef LED_BUILTIN
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);
#endif

  Serial.begin(115200);
  Keyboard.begin();
  Mouse.begin();
}

void loop() {
  // Watchdog: auto-disarm on 10s inactivity
  if (isArmed && (long)(millis() - leaseExpireAt) > 0) {
    disarm();
  }

  // Read incoming serial frames
  if (Serial.available() > 0) {
    String line = Serial.readStringUntil('\n');
    processLine(line);
  }
}
