#include <Arduino.h>
#include <M5Unified.h>
#include "USB.h"
#include "USBHIDKeyboard.h"
#include "USBHIDMouse.h"

// USB HID 设备实例
USBHIDKeyboard Keyboard;
USBHIDMouse Mouse;

// GhostDesk 协议常量
#define PROTOCOL_VERSION 4
#define FIRMWARE_VERSION "0.5.0"
#define DEVICE_NAME "FlowDesk USB Bridge"
#define BOARD_NAME "pico"
#define LEASE_TIMEOUT_MS 10000

// AI 代码搭子情绪状态
enum BuddyEmotion {
  EMOTION_IDLE,      // 待命中 (萌萌眨眼)
  EMOTION_THINKING,  // AI 深度思考中 (眼神左右转动)
  EMOTION_HAPPY,     // 任务完成 / 放行 (笑眼弯弯 ^ ^)
  EMOTION_WORRIED    // 报错 / 驳回 (> < 冒汗)
};

// 系统运行状态
struct SystemState {
  // GhostDesk 模式
  bool armed = false;
  String session = "";
  uint32_t leaseExpireAt = 0;
  String lastAction = "IDLE (Standby)";
  uint32_t actionCount = 0;
  bool emergencyStopped = false;

  // 代码搭子模式
  BuddyEmotion emotion = EMOTION_IDLE;
  String buddyStatusMsg = "Antigravity / Claude 待命";
  uint32_t emotionUntil = 0;
} state;

// 动画变量
int eyeBlinkState = 0; // 0=睁眼, 1=半闭, 2=全闭
uint32_t nextBlinkTime = 0;
int eyeLookOffset = 0;
uint32_t nextLookTime = 0;

String inputBuffer = "";

void playTone(int freq, int durationMs) {
  M5.Speaker.tone(freq, durationMs);
}

void releaseAllKeysAndMouse() {
  Keyboard.releaseAll();
  Mouse.release(MOUSE_LEFT | MOUSE_RIGHT | MOUSE_MIDDLE);
}

void disarm(const String& reason = "") {
  state.armed = false;
  state.session = "";
  state.leaseExpireAt = 0;
  releaseAllKeysAndMouse();
  if (reason.length() > 0) {
    state.lastAction = "DISARMED: " + reason;
  }
}

uint32_t getLeaseMs() {
  if (!state.armed) return 0;
  int32_t remaining = state.leaseExpireAt - millis();
  return remaining > 0 ? (uint32_t)remaining : 0;
}

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

// 绘制赛博眼睛 (小黄鸭/小智动态眼神)
void drawEyes(int centerX, int centerY, BuddyEmotion emotion, int blink) {
  int eyeWidth = 46;
  int eyeHeight = 56;
  int eyeSpacing = 44;

  int leftX = centerX - eyeSpacing - eyeWidth / 2 + eyeLookOffset;
  int rightX = centerX + eyeSpacing - eyeWidth / 2 + eyeLookOffset;

  uint16_t eyeColor = 0x07FF; // 科技青色 (Cyan)
  if (emotion == EMOTION_THINKING) eyeColor = 0xFBE0; // 金橙色
  if (emotion == EMOTION_HAPPY)    eyeColor = 0x07E0; // 翠绿色
  if (emotion == EMOTION_WORRIED)  eyeColor = 0xF800; // 红色

  // 1. HAPPY 开心笑眼 (^ ^)
  if (emotion == EMOTION_HAPPY) {
    M5.Display.fillRoundRect(leftX, centerY - 6, eyeWidth, 12, 6, eyeColor);
    M5.Display.fillRoundRect(rightX, centerY - 6, eyeWidth, 12, 6, eyeColor);
    M5.Display.fillCircle(leftX + eyeWidth / 2, centerY - 12, 14, eyeColor);
    M5.Display.fillCircle(rightX + eyeWidth / 2, centerY - 12, 14, eyeColor);
    M5.Display.fillCircle(leftX + eyeWidth / 2, centerY - 6, 13, TFT_BLACK);
    M5.Display.fillCircle(rightX + eyeWidth / 2, centerY - 6, 13, TFT_BLACK);
    return;
  }

  // 2. WORRIED 抓狂/冒汗 (> <)
  if (emotion == EMOTION_WORRIED) {
    M5.Display.drawLine(leftX, centerY - 18, leftX + eyeWidth, centerY + 18, eyeColor);
    M5.Display.drawLine(leftX, centerY - 17, leftX + eyeWidth, centerY + 19, eyeColor);
    M5.Display.drawLine(leftX, centerY + 18, leftX + eyeWidth, centerY - 18, eyeColor);
    M5.Display.drawLine(leftX, centerY + 19, leftX + eyeWidth, centerY - 17, eyeColor);

    M5.Display.drawLine(rightX, centerY - 18, rightX + eyeWidth, centerY + 18, eyeColor);
    M5.Display.drawLine(rightX, centerY - 17, rightX + eyeWidth, centerY + 19, eyeColor);
    M5.Display.drawLine(rightX, centerY + 18, rightX + eyeWidth, centerY - 18, eyeColor);
    M5.Display.drawLine(rightX, centerY + 19, rightX + eyeWidth, centerY - 17, eyeColor);

    // 额头汗珠
    M5.Display.fillCircle(rightX + eyeWidth + 14, centerY - 20, 5, 0x051F);
    return;
  }

  // 3. 正常 / 眨眼 / 思考
  int currentH = eyeHeight;
  if (blink == 1) currentH = 16;
  if (blink == 2) currentH = 4;

  int drawY = centerY - currentH / 2;
  M5.Display.fillRoundRect(leftX, drawY, eyeWidth, currentH, 18, eyeColor);
  M5.Display.fillRoundRect(rightX, drawY, eyeWidth, currentH, 18, eyeColor);

  // 眼神高光点 (让眼睛有灵魂水灵灵)
  if (currentH > 24) {
    M5.Display.fillCircle(leftX + eyeWidth - 14, drawY + 12, 6, TFT_WHITE);
    M5.Display.fillCircle(rightX + eyeWidth - 14, drawY + 12, 6, TFT_WHITE);
  }
}

// 刷新 UI 界面 (根据模式自动切换)
void updateScreen() {
  M5.Display.startWrite();

  // ================= 模式一：GhostDesk 物理防封控制模式 =================
  if (state.armed) {
    // 1. 顶部状态栏
    M5.Display.fillRect(0, 0, 320, 32, TFT_DARKGREEN);
    M5.Display.setTextSize(1);
    M5.Display.setTextColor(TFT_WHITE);
    M5.Display.drawString("GhostDesk x M5 CoreS3", 10, 8);
    M5.Display.setTextColor(TFT_GREENYELLOW);
    M5.Display.drawString("[ ARMED / RUNNING ]", 170, 8);

    // 2. 主状态区域
    M5.Display.fillRect(0, 32, 320, 140, TFT_BLACK);
    M5.Display.setTextColor(TFT_LIGHTGRAY);
    M5.Display.drawString("Session ID:", 15, 45);
    M5.Display.setTextColor(TFT_CYAN);
    M5.Display.drawString(state.session, 95, 45);

    M5.Display.setTextColor(TFT_LIGHTGRAY);
    M5.Display.drawString("Actions Done:", 15, 65);
    M5.Display.setTextColor(TFT_WHITE);
    M5.Display.drawString(String(state.actionCount), 110, 65);

    M5.Display.setTextColor(TFT_LIGHTGRAY);
    M5.Display.drawString("Heartbeat:", 180, 65);
    uint32_t lease = getLeaseMs();
    M5.Display.setTextColor(lease > 2000 ? TFT_GREEN : TFT_RED);
    M5.Display.drawString(String(lease) + " ms", 250, 65);

    // 最近动作提示框
    M5.Display.drawRoundRect(10, 88, 300, 75, 6, TFT_NAVY);
    M5.Display.fillRect(12, 90, 296, 71, 0x0821);
    M5.Display.setTextColor(TFT_GOLD);
    M5.Display.drawString("Last Action Executed:", 20, 96);
    M5.Display.setTextColor(TFT_WHITE);
    String displayAction = state.lastAction;
    if (displayAction.length() > 34) displayAction = displayAction.substring(0, 31) + "...";
    M5.Display.drawString(displayAction, 20, 116);

    // 3. 底部大号急停触控按钮
    M5.Display.fillRoundRect(15, 180, 290, 50, 8, 0xB800);
    M5.Display.drawRoundRect(15, 180, 290, 50, 8, TFT_WHITE);
    M5.Display.setTextColor(TFT_WHITE);
    M5.Display.setTextSize(2);
    M5.Display.drawCenterString("STOP / 物理急停", 160, 195);
    M5.Display.setTextSize(1);
    M5.Display.endWrite();
    return;
  }

  // ================= 模式二：AI 代码搭子 / 赛博监工模式 =================
  // 1. 顶部状态栏
  M5.Display.fillRect(0, 0, 320, 28, 0x10A2);
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawString("AI Buddy • Antigravity / Claude", 10, 7);
  int batteryLevel = M5.Power.getBatteryLevel();
  M5.Display.setTextColor(TFT_LIGHTGRAY);
  M5.Display.drawString(String(batteryLevel) + "%", 285, 7);

  // 2. 中间动态赛博眼睛与状态
  M5.Display.fillRect(0, 28, 320, 142, TFT_BLACK);
  drawEyes(160, 86, state.emotion, eyeBlinkState);

  // 状态提示文字
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(state.emotion == EMOTION_HAPPY ? TFT_GREENYELLOW : (state.emotion == EMOTION_WORRIED ? TFT_RED : TFT_CYAN));
  M5.Display.drawCenterString(state.buddyStatusMsg, 160, 148);

  // 3. 底部物理级宏按键 (一键放行 / 驳回)
  // 左侧绿色: [ ✅ Approve 放行 ]
  M5.Display.fillRoundRect(10, 175, 145, 55, 8, 0x1C64);
  M5.Display.drawRoundRect(10, 175, 145, 55, 8, TFT_GREEN);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.setTextSize(1);
  M5.Display.drawString("APPROVE", 32, 185);
  M5.Display.setTextSize(2);
  M5.Display.drawString("Y / 回车", 32, 202);

  // 右侧红色: [ ❌ Reject 驳回 ]
  M5.Display.fillRoundRect(165, 175, 145, 55, 8, 0x8000);
  M5.Display.drawRoundRect(165, 175, 145, 55, 8, TFT_RED);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.setTextSize(1);
  M5.Display.drawString("REJECT", 195, 185);
  M5.Display.setTextSize(2);
  M5.Display.drawString("ESC/中断", 185, 202);

  M5.Display.setTextSize(1);
  M5.Display.endWrite();
}

// 切换表情并定时恢复
void setEmotion(BuddyEmotion emo, const String& msg, uint32_t durationMs = 3000) {
  state.emotion = emo;
  state.buddyStatusMsg = msg;
  state.emotionUntil = millis() + durationMs;
}

// 模拟敲击 [y + Enter] (一键 Approve 放行)
void doApprove() {
  Keyboard.write('y');
  delay(15);
  Keyboard.write(KEY_RETURN);
  setEmotion(EMOTION_HAPPY, "Approved! 顺利放行 (y + Enter)", 3500);
  playTone(1046, 80); // C6
  delay(90);
  playTone(1318, 120); // E6
}

// 模拟敲击 [Ctrl+C] 或 [Esc] (一键 Reject 驳回/中断)
void doReject() {
  Keyboard.write(KEY_ESC);
  delay(10);
  Keyboard.press(KEY_LEFT_CTRL);
  Keyboard.press('c');
  delay(15);
  Keyboard.releaseAll();
  setEmotion(EMOTION_WORRIED, "Rejected! 已中断 (Esc/Ctrl+C)", 3500);
  playTone(392, 150); // G4
  delay(160);
  playTone(261, 200); // C4
}

// 解析电脑端指令
void handleCommandLine(const String& line) {
  if (line.length() == 0) return;

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

  // 代码搭子扩展指令: buddy <cmd> <msg>
  if (tokens[0] == "buddy") {
    String subCmd = tokens.size() > 1 ? tokens[1] : "idle";
    String msg = tokens.size() > 2 ? tokens[2] : "";

    if (subCmd == "thinking") {
      setEmotion(EMOTION_THINKING, msg.length() ? msg : "AI 正在深度思考中...", 10000);
      playTone(880, 50);
    } else if (subCmd == "done" || subCmd == "success") {
      setEmotion(EMOTION_HAPPY, msg.length() ? msg : "代码修改完成，请检查！", 6000);
      playTone(1318, 100); delay(110); playTone(1760, 180);
    } else if (subCmd == "error" || subCmd == "fail") {
      setEmotion(EMOTION_WORRIED, msg.length() ? msg : "单测未通过 / 遇到报错", 6000);
      playTone(440, 300);
    } else if (subCmd == "idle") {
      setEmotion(EMOTION_IDLE, msg.length() ? msg : "Antigravity / Claude 待命", 0);
    }
    Serial.println("{\"ok\":true,\"buddy\":true}");
    updateScreen();
    return;
  }

  uint32_t id = tokens[0].toInt();
  String cmd = tokens.size() > 1 ? tokens[1] : "";

  // 1. hello
  if (cmd == "hello") { sendReply(id, true); return; }

  // 2. status
  if (cmd == "status") { sendReply(id, true); return; }

  // 3. disarm
  if (cmd == "disarm") {
    disarm("Host request");
    setEmotion(EMOTION_IDLE, "GhostDesk 会话断开，回到搭子模式", 2000);
    playTone(600, 100);
    sendReply(id, true);
    updateScreen();
    return;
  }

  // 4. begin <nonce>
  if (cmd == "begin") {
    if (tokens.size() < 3) { sendReply(id, false, "syntax"); return; }
    String nonce = tokens[2];
    if (state.armed) { sendReply(id, false, "armed"); return; }
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

  if (tokens.size() < 3) { sendReply(id, false, "syntax"); return; }
  String sessionNonce = tokens[2];
  if (!state.armed || sessionNonce != state.session) { sendReply(id, false, "session"); return; }

  // 5. ping
  if (cmd == "ping") {
    state.leaseExpireAt = millis() + LEASE_TIMEOUT_MS;
    sendReply(id, true);
    return;
  }

  if (millis() > state.leaseExpireAt) {
    disarm("Lease timeout");
    sendReply(id, false, "timeout");
    updateScreen();
    return;
  }

  state.leaseExpireAt = millis() + LEASE_TIMEOUT_MS;
  state.actionCount++;

  // 6. move
  if (cmd == "move") {
    if (tokens.size() < 5) { sendReply(id, false, "syntax"); return; }
    Mouse.move(tokens[3].toInt(), tokens[4].toInt());
    state.lastAction = "MOVE: dx=" + tokens[3] + " dy=" + tokens[4];
    sendReply(id, true);
    return;
  }

  // 7. click
  if (cmd == "click") {
    if (tokens.size() < 4) { sendReply(id, false, "syntax"); return; }
    uint8_t button = (tokens[3] == "right") ? MOUSE_RIGHT : MOUSE_LEFT;
    Mouse.press(button); delay(10); Mouse.release(button);
    state.lastAction = "CLICK: " + tokens[3];
    sendReply(id, true);
    return;
  }

  // 8. wheel
  if (cmd == "wheel") {
    if (tokens.size() < 4) { sendReply(id, false, "syntax"); return; }
    Mouse.move(0, 0, tokens[3].toInt());
    state.lastAction = "WHEEL: " + tokens[3];
    sendReply(id, true);
    return;
  }

  // 9. paste
  if (cmd == "paste") {
    Keyboard.press(KEY_LEFT_CTRL); Keyboard.press('v'); delay(15); Keyboard.releaseAll();
    state.lastAction = "PASTE: [Ctrl+V]";
    sendReply(id, true);
    return;
  }

  // 10. key
  if (cmd == "key") {
    if (tokens.size() < 4) { sendReply(id, false, "syntax"); return; }
    String keyName = tokens[3]; keyName.toLowerCase();
    if (keyName == "enter") Keyboard.write(KEY_RETURN);
    else if (keyName == "tab") Keyboard.write(KEY_TAB);
    else if (keyName == "backspace") Keyboard.write(KEY_BACKSPACE);
    else if (keyName == "delete") Keyboard.write(KEY_DELETE);
    else if (keyName == "left") Keyboard.write(KEY_LEFT_ARROW);
    else if (keyName == "right") Keyboard.write(KEY_RIGHT_ARROW);
    else if (keyName == "up") Keyboard.write(KEY_UP_ARROW);
    else if (keyName == "down") Keyboard.write(KEY_DOWN_ARROW);
    else if (keyName == "home") Keyboard.write(KEY_HOME);
    else if (keyName == "end") Keyboard.write(KEY_END);
    else if (keyName == "escape") Keyboard.write(KEY_ESC);
    else if (keyName == "pagedown") Keyboard.write(KEY_PAGE_DOWN);
    else if (keyName == "ctrl+a") {
      Keyboard.press(KEY_LEFT_CTRL); Keyboard.press('a'); delay(10); Keyboard.releaseAll();
    } else if (keyName == "shift") {
      Keyboard.press(KEY_LEFT_SHIFT); delay(10); Keyboard.release(KEY_LEFT_SHIFT);
    } else {
      sendReply(id, false, "unsupported_key");
      return;
    }
    state.lastAction = "KEY: " + keyName;
    sendReply(id, true);
    return;
  }

  // 11. text
  if (cmd == "text") {
    if (tokens.size() < 4) { sendReply(id, false, "syntax"); return; }
    Keyboard.print(tokens[3]);
    state.lastAction = "TYPE: " + tokens[3];
    sendReply(id, true);
    return;
  }

  sendReply(id, false, "unknown_cmd");
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  M5.Display.setBrightness(120);
  M5.Speaker.setVolume(160);

  USB.VID(0xCAFE);
  USB.PID(0x4001);
  USB.productName("FlowDesk USB Bridge");
  USB.manufacturerName("FlowDesk");
  USB.serialNumber("M5-CORES3-AI-BUDDY");

  Keyboard.begin();
  Mouse.begin();
  USB.begin();
  Serial.begin(115200);

  // 启动音效
  playTone(880, 80); delay(100); playTone(1320, 120); delay(130); playTone(1760, 160);

  nextBlinkTime = millis() + 2000;
  nextLookTime = millis() + 4000;

  updateScreen();
}

uint32_t lastScreenUpdate = 0;

void loop() {
  M5.update();
  uint32_t now = millis();

  // 1. 触屏交互
  auto touch = M5.Touch.getDetail();
  if (touch.wasPressed()) {
    if (state.armed) {
      // GhostDesk 模式下的急停大红钮
      if (touch.y >= 170 && touch.y <= 235) {
        state.emergencyStopped = true;
        disarm("EMERGENCY STOP PRESSED");
        playTone(400, 300);
        updateScreen();
      }
    } else {
      // 代码搭子模式下的触控按键
      if (touch.y >= 170 && touch.y <= 235) {
        if (touch.x >= 10 && touch.x <= 155) {
          // 左侧：一键 Approve 放行
          doApprove();
          updateScreen();
        } else if (touch.x >= 165 && touch.x <= 310) {
          // 右侧：一键 Reject 驳回/中断
          doReject();
          updateScreen();
        }
      } else if (touch.y < 160) {
        // 点击脸部/眼睛：互动卖萌音效
        setEmotion(EMOTION_HAPPY, "主人，代码写累了就喝杯水吧！", 2500);
        playTone(1500, 80); delay(90); playTone(2000, 120);
        updateScreen();
      }
    }
  }

  // 2. 状态恢复检查 (情绪持续时间结束自动回 IDLE)
  if (!state.armed && state.emotion != EMOTION_IDLE && state.emotionUntil > 0 && now > state.emotionUntil) {
    state.emotion = EMOTION_IDLE;
    state.buddyStatusMsg = "Antigravity / Claude 待命";
    state.emotionUntil = 0;
  }

  // 3. 动态眼睛自然眨眼与视线动画
  if (!state.armed && state.emotion == EMOTION_IDLE) {
    if (now > nextBlinkTime) {
      eyeBlinkState = (eyeBlinkState + 1) % 3;
      if (eyeBlinkState == 0) {
        nextBlinkTime = now + random(2500, 5000);
      } else {
        nextBlinkTime = now + 60; // 眨眼帧率
      }
    }
    if (now > nextLookTime) {
      eyeLookOffset = random(-14, 15);
      nextLookTime = now + random(3000, 6000);
    }
  } else if (!state.armed && state.emotion == EMOTION_THINKING) {
    // 思考时眼神快速左右晃动
    eyeBlinkState = 0;
    eyeLookOffset = (int)(sin(now / 150.0) * 16.0);
  } else {
    eyeBlinkState = 0;
    eyeLookOffset = 0;
  }

  // 4. GhostDesk 心跳检查
  if (state.armed && now > state.leaseExpireAt) {
    disarm("Heartbeat Timeout");
    updateScreen();
  }

  // 5. 读取串口命令
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
      if (inputBuffer.length() > 256) inputBuffer = "";
    }
  }

  // 6. 定时刷新屏幕
  if (now - lastScreenUpdate > 80) {
    lastScreenUpdate = now;
    updateScreen();
  }
}
