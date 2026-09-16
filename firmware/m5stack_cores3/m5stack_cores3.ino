#include <Arduino.h>
#include <M5Unified.h>
#include "USB.h"
#include "USBHIDKeyboard.h"
#include "USBHIDMouse.h"

// USB HID 设备实例
USBHIDKeyboard Keyboard;
USBHIDMouse Mouse;

// GhostDesk 协议常量 (完全匹配原版 Pico 固件规范)
#define PROTOCOL_VERSION 4
#define FIRMWARE_VERSION "0.5.0"
#define DEVICE_NAME "FlowDesk USB Bridge"
#define BOARD_NAME "pico" // 兼容桌面端白名单校验
#define LEASE_TIMEOUT_MS 10000

// 会话状态
struct BridgeState {
  bool armed = false;
  String session = "";
  uint32_t leaseExpireAt = 0;
  String lastAction = "IDLE (Standby)";
  uint32_t actionCount = 0;
  bool emergencyStopped = false;
} state;

// 串口接收缓冲
String inputBuffer = "";

// 喇叭声音提示
void playTone(int freq, int durationMs) {
  M5.Speaker.tone(freq, durationMs);
}

// 释放所有按键
void releaseAllKeysAndMouse() {
  Keyboard.releaseAll();
  Mouse.release(MOUSE_LEFT | MOUSE_RIGHT | MOUSE_MIDDLE);
}

// 撤销会话授权
void disarm(const String& reason = "") {
  state.armed = false;
  state.session = "";
  state.leaseExpireAt = 0;
  releaseAllKeysAndMouse();
  if (reason.length() > 0) {
    state.lastAction = "DISARMED: " + reason;
  }
}

// 返回剩余租约时间 (ms)
uint32_t getLeaseMs() {
  if (!state.armed) return 0;
  int32_t remaining = state.leaseExpireAt - millis();
  return remaining > 0 ? (uint32_t)remaining : 0;
}

// 发送标准 JSON 应答
void sendReply(uint32_t id, bool ok, const String& error = "") {
  String json = "{";
  json += "\"id\":" + String(id) + ",";
  json += "\"ok\":" + String(ok ? "true" : "false") + ",";
  json += "\"protocol\":" + String(PROTOCOL_VERSION) + ",";
  json += "\"device\":\"" + String(DEVICE_NAME) + "\",";
  json += "\"firmware\":\"" + String(FIRMWARE_VERSION) + "\",";
  json += "\"board\":\"" + String(BOARD_NAME) + "\",";
  json += "\"armed\":" + String(state.armed ? "true" : "false") + ",";
  json += "\"session\":\"" + state.session + "\",";
  json += "\"leaseMs\":" + String(getLeaseMs());
  if (error.length() > 0) {
    json += ",\"error\":\"" + error + "\"";
  }
  json += "}\n";

  Serial.print(json);
  Serial.flush();
}

// 刷新 UI 界面
void updateScreen() {
  M5.Display.startWrite();

  // 1. 顶部状态栏
  M5.Display.fillRect(0, 0, 320, 32, state.armed ? TFT_DARKGREEN : (state.emergencyStopped ? TFT_MAROON : 0x18E3));
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawString("GhostDesk x M5 CoreS3", 10, 8);
  
  if (state.emergencyStopped) {
    M5.Display.setTextColor(TFT_YELLOW);
    M5.Display.drawString("[ EMERGENCY STOP ]", 170, 8);
  } else if (state.armed) {
    M5.Display.setTextColor(TFT_GREENYELLOW);
    M5.Display.drawString("[ ARMED / RUNNING ]", 170, 8);
  } else {
    M5.Display.setTextColor(TFT_LIGHTGRAY);
    M5.Display.drawString("[ STANDBY ]", 230, 8);
  }

  // 2. 主状态区域
  M5.Display.fillRect(0, 32, 320, 140, TFT_BLACK);
  M5.Display.drawFastHLine(0, 32, 320, TFT_DARKGRAY);

  M5.Display.setTextColor(TFT_LIGHTGRAY);
  M5.Display.drawString("Session ID:", 15, 45);
  M5.Display.setTextColor(state.armed ? TFT_CYAN : TFT_DARKGRAY);
  M5.Display.drawString(state.session.length() > 0 ? state.session : "(None - Idle)", 95, 45);

  M5.Display.setTextColor(TFT_LIGHTGRAY);
  M5.Display.drawString("Actions Done:", 15, 65);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawString(String(state.actionCount), 110, 65);

  M5.Display.setTextColor(TFT_LIGHTGRAY);
  M5.Display.drawString("Heartbeat:", 180, 65);
  uint32_t lease = getLeaseMs();
  M5.Display.setTextColor(lease > 2000 ? TFT_GREEN : (lease > 0 ? TFT_RED : TFT_DARKGRAY));
  M5.Display.drawString(String(lease) + " ms", 250, 65);

  // 最近动作提示框
  M5.Display.drawRoundRect(10, 88, 300, 75, 6, TFT_NAVY);
  M5.Display.fillRect(12, 90, 296, 71, 0x0821);
  M5.Display.setTextColor(TFT_GOLD);
  M5.Display.drawString("Last Action Executed:", 20, 96);
  M5.Display.setTextColor(TFT_WHITE);
  
  // 截断超长文本避免出框
  String displayAction = state.lastAction;
  if (displayAction.length() > 34) {
    displayAction = displayAction.substring(0, 31) + "...";
  }
  M5.Display.drawString(displayAction, 20, 116);
  
  // 电池与电量
  int batteryLevel = M5.Power.getBatteryLevel();
  M5.Display.setTextColor(TFT_DARKGRAY);
  M5.Display.drawString("Battery: " + String(batteryLevel) + "%", 20, 142);

  // 3. 底部大号急停触控按钮
  int btnColor = state.emergencyStopped ? TFT_RED : 0xB800; // 暗红 / 亮红
  M5.Display.fillRoundRect(15, 180, 290, 50, 8, btnColor);
  M5.Display.drawRoundRect(15, 180, 290, 50, 8, TFT_WHITE);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.setTextSize(2);
  M5.Display.drawCenterString("STOP / 物理急停", 160, 195);
  M5.Display.setTextSize(1);

  M5.Display.endWrite();
}

// 处理来自电脑端的命令
void handleCommandLine(const String& line) {
  if (line.length() == 0) return;

  // 切割 TAB 分隔字段
  std::vector<String> tokens;
  int start = 0;
  while (start < line.length()) {
    int tabIndex = line.indexOf('\t', start);
    if (tabIndex == -1) {
      tokens.push_back(line.substring(start));
      break;
    }
    tokens.push_back(line.substring(start, tabIndex));
    start = tabIndex + 1;
  }

  if (tokens.empty()) return;

  uint32_t id = tokens[0].toInt();
  String cmd = tokens.size() > 1 ? tokens[1] : "";

  // 1. hello
  if (cmd == "hello") {
    sendReply(id, true);
    return;
  }

  // 2. status
  if (cmd == "status") {
    sendReply(id, true);
    return;
  }

  // 3. disarm
  if (cmd == "disarm") {
    disarm("Host request");
    playTone(600, 100);
    sendReply(id, true);
    updateScreen();
    return;
  }

  // 4. begin <nonce>
  if (cmd == "begin") {
    if (tokens.size() < 3) {
      sendReply(id, false, "syntax");
      return;
    }
    String nonce = tokens[2];
    if (state.armed) {
      sendReply(id, false, "armed");
      return;
    }
    state.armed = true;
    state.session = nonce;
    state.emergencyStopped = false;
    state.leaseExpireAt = millis() + LEASE_TIMEOUT_MS;
    state.lastAction = "Session Started: " + nonce.substring(0, 6);
    playTone(1200, 150);
    sendReply(id, true);
    updateScreen();
    return;
  }

  // 检查会话相关命令
  if (tokens.size() < 3) {
    sendReply(id, false, "syntax");
    return;
  }

  String sessionNonce = tokens[2];
  if (!state.armed || sessionNonce != state.session) {
    sendReply(id, false, "session");
    return;
  }

  // 5. ping <nonce>
  if (cmd == "ping") {
    state.leaseExpireAt = millis() + LEASE_TIMEOUT_MS;
    sendReply(id, true);
    return;
  }

  // 检查租约是否超时
  if (millis() > state.leaseExpireAt) {
    disarm("Lease timeout");
    sendReply(id, false, "timeout");
    updateScreen();
    return;
  }

  // 刷新租约
  state.leaseExpireAt = millis() + LEASE_TIMEOUT_MS;
  state.actionCount++;

  // 6. move <nonce> <x> <y>
  if (cmd == "move") {
    if (tokens.size() < 5) { sendReply(id, false, "syntax"); return; }
    int x = tokens[3].toInt();
    int y = tokens[4].toInt();
    Mouse.move(x, y);
    state.lastAction = "MOVE: dx=" + String(x) + " dy=" + String(y);
    sendReply(id, true);
    return;
  }

  // 7. click <nonce> <left|right>
  if (cmd == "click") {
    if (tokens.size() < 4) { sendReply(id, false, "syntax"); return; }
    String btn = tokens[3];
    uint8_t button = (btn == "right") ? MOUSE_RIGHT : MOUSE_LEFT;
    Mouse.press(button);
    delay(10);
    Mouse.release(button);
    state.lastAction = "CLICK: " + btn;
    sendReply(id, true);
    return;
  }

  // 8. wheel <nonce> <y>
  if (cmd == "wheel") {
    if (tokens.size() < 4) { sendReply(id, false, "syntax"); return; }
    int scrollY = tokens[3].toInt();
    Mouse.move(0, 0, scrollY);
    state.lastAction = "WHEEL: " + String(scrollY);
    sendReply(id, true);
    return;
  }

  // 9. paste <nonce> (Ctrl+V)
  if (cmd == "paste") {
    Keyboard.press(KEY_LEFT_CTRL);
    Keyboard.press('v');
    delay(15);
    Keyboard.releaseAll();
    state.lastAction = "PASTE: [Ctrl+V]";
    sendReply(id, true);
    return;
  }

  // 10. key <nonce> <key_name>
  if (cmd == "key") {
    if (tokens.size() < 4) { sendReply(id, false, "syntax"); return; }
    String keyName = tokens[3];
    keyName.toLowerCase();
    
    if (keyName == "enter") { Keyboard.write(KEY_RETURN); }
    else if (keyName == "tab") { Keyboard.write(KEY_TAB); }
    else if (keyName == "backspace") { Keyboard.write(KEY_BACKSPACE); }
    else if (keyName == "delete") { Keyboard.write(KEY_DELETE); }
    else if (keyName == "left") { Keyboard.write(KEY_LEFT_ARROW); }
    else if (keyName == "right") { Keyboard.write(KEY_RIGHT_ARROW); }
    else if (keyName == "up") { Keyboard.write(KEY_UP_ARROW); }
    else if (keyName == "down") { Keyboard.write(KEY_DOWN_ARROW); }
    else if (keyName == "home") { Keyboard.write(KEY_HOME); }
    else if (keyName == "end") { Keyboard.write(KEY_END); }
    else if (keyName == "escape") { Keyboard.write(KEY_ESC); }
    else if (keyName == "pagedown") { Keyboard.write(KEY_PAGE_DOWN); }
    else if (keyName == "ctrl+a") {
      Keyboard.press(KEY_LEFT_CTRL);
      Keyboard.press('a');
      delay(10);
      Keyboard.releaseAll();
    }
    else if (keyName == "shift") {
      Keyboard.press(KEY_LEFT_SHIFT);
      delay(10);
      Keyboard.release(KEY_LEFT_SHIFT);
    } else {
      sendReply(id, false, "unsupported_key");
      return;
    }

    state.lastAction = "KEY: " + keyName;
    sendReply(id, true);
    return;
  }

  // 11. text <nonce> <content>
  if (cmd == "text") {
    if (tokens.size() < 4) { sendReply(id, false, "syntax"); return; }
    String textToType = tokens[3];
    Keyboard.print(textToType);
    state.lastAction = "TYPE: " + textToType;
    sendReply(id, true);
    return;
  }

  sendReply(id, false, "unknown_cmd");
}

void setup() {
  // 1. 初始化 M5Stack CoreS3 硬件 (屏幕、触控、电源、扬声器)
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  M5.Display.setBrightness(120);
  M5.Speaker.setVolume(160);

  // 2. 配置 USB 为 GhostDesk 标准描述符
  // GhostDesk 识别白名单: VID=0xCAFE, PID=0x4001, Product="FlowDesk USB Bridge"
  USB.VID(0xCAFE);
  USB.PID(0x4001);
  USB.productName("FlowDesk USB Bridge");
  USB.manufacturerName("FlowDesk");
  USB.serialNumber("M5-CORES3-001");

  Keyboard.begin();
  Mouse.begin();
  USB.begin();

  Serial.begin(115200);

  // 开机音效与初始化画面
  playTone(880, 100);
  delay(120);
  playTone(1760, 150);

  updateScreen();
}

uint32_t lastScreenUpdate = 0;

void loop() {
  M5.update();

  // 1. 检查触控屏急停按钮
  auto touch = M5.Touch.getDetail();
  if (touch.wasPressed()) {
    // 判断是否按在底部的红色急停按钮区域 (Y: 175 ~ 235)
    if (touch.y >= 170 && touch.y <= 235) {
      state.emergencyStopped = true;
      disarm("EMERGENCY STOP PRESSED");
      // 警报声
      playTone(400, 300);
      updateScreen();
    }
  }

  // 2. 检查会话心跳超时 (10秒未收到 ping 则自愈释放)
  if (state.armed && millis() > state.leaseExpireAt) {
    disarm("Heartbeat Timeout");
    updateScreen();
  }

  // 3. 读取并解析 USB CDC 串口数据
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      inputBuffer.trim();
      if (inputBuffer.length() > 0) {
        handleCommandLine(inputBuffer);
      }
      inputBuffer = "";
    } else if (c != '\r') {
      inputBuffer += c;
      // 溢出防护
      if (inputBuffer.length() > 256) {
        inputBuffer = "";
      }
    }
  }

  // 4. 定时刷新屏幕状态 (约每 200ms 刷新一次)
  if (millis() - lastScreenUpdate > 200) {
    lastScreenUpdate = millis();
    updateScreen();
  }
}
