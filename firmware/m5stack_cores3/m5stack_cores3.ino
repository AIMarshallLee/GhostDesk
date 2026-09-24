#include <Arduino.h>
#include <M5Unified.h>
#include "USB.h"
#include "USBHIDKeyboard.h"
#include "USBHIDMouse.h"

// USB HID 设备实例
USBHIDKeyboard Keyboard;
USBHIDMouse Mouse;

// 协议常量
#define PROTOCOL_VERSION 4
#define FIRMWARE_VERSION "0.5.0"
#define DEVICE_NAME "FlowDesk USB Bridge"
#define BOARD_NAME "pico"
#define LEASE_TIMEOUT_MS 10000

// 麦克风录音缓冲
#define MIC_SAMPLE_RATE 16000
#define MIC_CHUNK_SAMPLES 256
static int16_t micBuffer[MIC_CHUNK_SAMPLES];

// 运行状态
enum BuddyEmotion {
  EMOTION_IDLE,      // 待命眨眼
  EMOTION_RECORDING, // 🎙️ 对讲机正在录音
  EMOTION_THINKING,  // 思考中
  EMOTION_HAPPY,     // 完成
  EMOTION_WORRIED    // 报错
};

struct SystemState {
  // GhostDesk 模式
  bool armed = false;
  String session = "";
  uint32_t leaseExpireAt = 0;
  String lastAction = "IDLE (Standby)";
  uint32_t actionCount = 0;
  bool emergencyStopped = false;

  // 对讲机 / 搭子模式
  BuddyEmotion emotion = EMOTION_IDLE;
  String buddyStatusMsg = "Antigravity / Claude 待命";
  uint32_t emotionUntil = 0;
  bool isRecordingVoice = false;
  uint32_t recordingStartTime = 0;
  int currentAudioVolume = 0;
} state;

// 眼睛动画变量
int eyeBlinkState = 0;
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
  if (reason.length() > 0) state.lastAction = "DISARMED: " + reason;
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
  if (error.length() > 0) json += ",\"error\":\"" + error + "\"";
  json += "}\n";

  Serial.print(json);
  Serial.flush();
}

// 绘制赛博眼睛
void drawEyes(int centerX, int centerY, BuddyEmotion emotion, int blink) {
  int eyeWidth = 44;
  int eyeHeight = 52;
  int eyeSpacing = 42;

  int leftX = centerX - eyeSpacing - eyeWidth / 2 + eyeLookOffset;
  int rightX = centerX + eyeSpacing - eyeWidth / 2 + eyeLookOffset;

  uint16_t eyeColor = 0x07FF; // 科技青色
  if (emotion == EMOTION_THINKING) eyeColor = 0xFBE0; // 金橙色
  if (emotion == EMOTION_HAPPY)    eyeColor = 0x07E0; // 翠绿
  if (emotion == EMOTION_WORRIED)  eyeColor = 0xF800; // 红色

  if (emotion == EMOTION_HAPPY) {
    M5.Display.fillRoundRect(leftX, centerY - 6, eyeWidth, 12, 6, eyeColor);
    M5.Display.fillRoundRect(rightX, centerY - 6, eyeWidth, 12, 6, eyeColor);
    M5.Display.fillCircle(leftX + eyeWidth / 2, centerY - 12, 13, eyeColor);
    M5.Display.fillCircle(rightX + eyeWidth / 2, centerY - 12, 13, eyeColor);
    M5.Display.fillCircle(leftX + eyeWidth / 2, centerY - 6, 12, TFT_BLACK);
    M5.Display.fillCircle(rightX + eyeWidth / 2, centerY - 6, 12, TFT_BLACK);
    return;
  }

  if (emotion == EMOTION_WORRIED) {
    M5.Display.drawLine(leftX, centerY - 16, leftX + eyeWidth, centerY + 16, eyeColor);
    M5.Display.drawLine(leftX, centerY + 16, leftX + eyeWidth, centerY - 16, eyeColor);
    M5.Display.drawLine(rightX, centerY - 16, rightX + eyeWidth, centerY + 16, eyeColor);
    M5.Display.drawLine(rightX, centerY + 16, rightX + eyeWidth, centerY - 16, eyeColor);
    M5.Display.fillCircle(rightX + eyeWidth + 12, centerY - 16, 5, 0x051F);
    return;
  }

  int currentH = eyeHeight;
  if (blink == 1) currentH = 14;
  if (blink == 2) currentH = 4;

  int drawY = centerY - currentH / 2;
  M5.Display.fillRoundRect(leftX, drawY, eyeWidth, currentH, 16, eyeColor);
  M5.Display.fillRoundRect(rightX, drawY, eyeWidth, currentH, 16, eyeColor);

  if (currentH > 22) {
    M5.Display.fillCircle(leftX + eyeWidth - 12, drawY + 12, 5, TFT_WHITE);
    M5.Display.fillCircle(rightX + eyeWidth - 12, drawY + 12, 5, TFT_WHITE);
  }
}

// 绘制对讲机录音动态波形界面
void drawVoiceRecordingScreen() {
  M5.Display.fillRect(0, 28, 320, 142, TFT_BLACK);

  // 麦克风图标与动画外圈
  int pulseRadius = 26 + (state.currentAudioVolume / 4);
  if (pulseRadius > 45) pulseRadius = 45;
  M5.Display.drawCircle(160, 75, pulseRadius, 0xFD20); // 呼吸橙圈
  M5.Display.fillCircle(160, 75, 22, TFT_RED);

  // 绘制话筒小图标
  M5.Display.fillRoundRect(156, 65, 8, 14, 4, TFT_WHITE);
  M5.Display.drawFastHLine(154, 82, 12, TFT_WHITE);
  M5.Display.drawFastVLine(160, 82, 6, TFT_WHITE);

  // 录音动态波形柱状条
  int bars = 11;
  int startX = 65;
  for (int i = 0; i < bars; ++i) {
    int h = 6 + (state.currentAudioVolume / 3) * sin((i + 1) * 0.6);
    if (h < 4) h = 4;
    if (h > 40) h = 40;
    M5.Display.fillRoundRect(startX + i * 18, 125 - h / 2, 8, h, 3, TFT_YELLOW);
  }

  // 提示文字
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.setTextSize(1);
  uint32_t sec = (millis() - state.recordingStartTime) / 1000;
  M5.Display.drawCenterString("🎙️ 正在倾听 (" + String(sec) + "s)... 松手发送给 AI", 160, 150);
}

// 刷新屏幕
void updateScreen() {
  M5.Display.startWrite();

  // ================= 模式一：GhostDesk 物理防封控制模式 =================
  if (state.armed) {
    M5.Display.fillRect(0, 0, 320, 32, TFT_DARKGREEN);
    M5.Display.setTextSize(1);
    M5.Display.setTextColor(TFT_WHITE);
    M5.Display.drawString("GhostDesk x M5 CoreS3", 10, 8);
    M5.Display.setTextColor(TFT_GREENYELLOW);
    M5.Display.drawString("[ ARMED / RUNNING ]", 170, 8);

    M5.Display.fillRect(0, 32, 320, 140, TFT_BLACK);
    M5.Display.setTextColor(TFT_LIGHTGRAY);
    M5.Display.drawString("Session ID:", 15, 45);
    M5.Display.setTextColor(TFT_CYAN);
    M5.Display.drawString(state.session, 95, 45);

    M5.Display.setTextColor(TFT_LIGHTGRAY);
    M5.Display.drawString("Actions Done:", 15, 65);
    M5.Display.setTextColor(TFT_WHITE);
    M5.Display.drawString(String(state.actionCount), 110, 65);

    M5.Display.drawRoundRect(10, 88, 300, 75, 6, TFT_NAVY);
    M5.Display.fillRect(12, 90, 296, 71, 0x0821);
    M5.Display.setTextColor(TFT_GOLD);
    M5.Display.drawString("Last Action Executed:", 20, 96);
    M5.Display.setTextColor(TFT_WHITE);
    String displayAction = state.lastAction;
    if (displayAction.length() > 34) displayAction = displayAction.substring(0, 31) + "...";
    M5.Display.drawString(displayAction, 20, 116);

    M5.Display.fillRoundRect(15, 180, 290, 50, 8, 0xB800);
    M5.Display.drawRoundRect(15, 180, 290, 50, 8, TFT_WHITE);
    M5.Display.setTextColor(TFT_WHITE);
    M5.Display.setTextSize(2);
    M5.Display.drawCenterString("STOP / 物理急停", 160, 195);
    M5.Display.setTextSize(1);
    M5.Display.endWrite();
    return;
  }

  // ================= 模式二：AI 编程对讲机 / 监工模式 =================
  // 1. 顶部状态栏
  M5.Display.fillRect(0, 0, 320, 28, 0x10A2);
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawString("AI Walkie-Talkie • 对讲机", 10, 7);
  int batteryLevel = M5.Power.getBatteryLevel();
  M5.Display.setTextColor(TFT_LIGHTGRAY);
  M5.Display.drawString(String(batteryLevel) + "%", 285, 7);

  // 2. 中间区域：录音状态 OR 赛博眼睛
  if (state.isRecordingVoice) {
    drawVoiceRecordingScreen();
  } else {
    M5.Display.fillRect(0, 28, 320, 142, TFT_BLACK);
    drawEyes(160, 82, state.emotion, eyeBlinkState);
    M5.Display.setTextSize(1);
    M5.Display.setTextColor(state.emotion == EMOTION_HAPPY ? TFT_GREENYELLOW : (state.emotion == EMOTION_WORRIED ? TFT_RED : TFT_CYAN));
    M5.Display.drawCenterString(state.buddyStatusMsg, 160, 148);
  }

  // 3. 底部三段式触控底座 (手持大拇指盲操布局)
  // [左键: ✅ APPROVE (y+Enter)]
  M5.Display.fillRoundRect(8, 175, 88, 55, 8, 0x1C64);
  M5.Display.drawRoundRect(8, 175, 88, 55, 8, TFT_GREEN);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.setTextSize(1);
  M5.Display.drawCenterString("APPROVE", 52, 185);
  M5.Display.setTextSize(2);
  M5.Display.drawCenterString("Y", 52, 202);

  // [中键: 🎙️ 按住说话 (PTT 对讲机)]
  int pttColor = state.isRecordingVoice ? TFT_RED : 0xD2C0; // 录音亮红 / 平常暖橙
  M5.Display.fillRoundRect(102, 175, 116, 55, 8, pttColor);
  M5.Display.drawRoundRect(102, 175, 116, 55, 8, TFT_WHITE);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.setTextSize(1);
  M5.Display.drawCenterString("PUSH TO TALK", 160, 185);
  M5.Display.setTextSize(2);
  M5.Display.drawCenterString("🎙️ 按住说", 160, 202);

  // [右键: ❌ REJECT (Esc/Ctrl+C)]
  M5.Display.fillRoundRect(224, 175, 88, 55, 8, 0x8000);
  M5.Display.drawRoundRect(224, 175, 88, 55, 8, TFT_RED);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.setTextSize(1);
  M5.Display.drawCenterString("REJECT", 268, 185);
  M5.Display.setTextSize(2);
  M5.Display.drawCenterString("ESC", 268, 202);

  M5.Display.setTextSize(1);
  M5.Display.endWrite();
}

void setEmotion(BuddyEmotion emo, const String& msg, uint32_t durationMs = 3000) {
  state.emotion = emo;
  state.buddyStatusMsg = msg;
  state.emotionUntil = millis() + durationMs;
}

void doApprove() {
  Keyboard.write('y');
  delay(15);
  Keyboard.write(KEY_RETURN);
  setEmotion(EMOTION_HAPPY, "Approved! 顺利放行 (y + Enter)", 3500);
  playTone(1046, 80); delay(90); playTone(1318, 120);
}

void doReject() {
  Keyboard.write(KEY_ESC);
  delay(10);
  Keyboard.press(KEY_LEFT_CTRL); Keyboard.press('c'); delay(15); Keyboard.releaseAll();
  setEmotion(EMOTION_WORRIED, "Rejected! 已中断 (Esc/Ctrl+C)", 3500);
  playTone(392, 150); delay(160); playTone(261, 200);
}

// 开始录音
void startVoiceRecording() {
  if (state.isRecordingVoice) return;
  state.isRecordingVoice = true;
  state.recordingStartTime = millis();
  state.emotion = EMOTION_RECORDING;
  playTone(1320, 60); delay(70); playTone(1760, 80); // 对讲机开麦清脆滴声
  Serial.println("VOICE_START");
  Serial.flush();
}

// 结束录音
void stopVoiceRecording() {
  if (!state.isRecordingVoice) return;
  state.isRecordingVoice = false;
  playTone(880, 80); // 对讲机闭麦提示音
  Serial.println("VOICE_END");
  Serial.flush();
  setEmotion(EMOTION_THINKING, "语音已发送，AI 正在生成...", 8000);
}

// 采样麦克风并推送给串口
void processMicrophone() {
  if (!state.isRecordingVoice) return;

  if (M5.Mic.record(micBuffer, MIC_CHUNK_SAMPLES, MIC_SAMPLE_RATE)) {
    // 计算瞬时 RMS 音量
    int32_t sum = 0;
    for (int i = 0; i < MIC_CHUNK_SAMPLES; ++i) {
      int16_t sample = micBuffer[i];
      sum += (int32_t)abs(sample);
    }
    state.currentAudioVolume = (int)(sum / MIC_CHUNK_SAMPLES / 200);
    if (state.currentAudioVolume > 80) state.currentAudioVolume = 80;

    // 发送十六进制音频块给宿主机 (CDC 协议传输，保持 Little-Endian 与标准 WAV 对齐)
    Serial.print("V:");
    const uint8_t* rawBytes = (const uint8_t*)micBuffer;
    size_t byteCount = MIC_CHUNK_SAMPLES * sizeof(int16_t);
    for (size_t i = 0; i < byteCount; ++i) {
      uint8_t b = rawBytes[i];
      if (b < 0x10) Serial.print('0');
      Serial.print(b, HEX);
    }
    Serial.println();
  }
}

// 命令解析
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

  if (tokens[0] == "buddy") {
    String subCmd = tokens.size() > 1 ? tokens[1] : "idle";
    String msg = tokens.size() > 2 ? tokens[2] : "";

    if (subCmd == "thinking") {
      setEmotion(EMOTION_THINKING, msg.length() ? msg : "AI 正在思考中...", 10000);
      playTone(880, 50);
    } else if (subCmd == "done" || subCmd == "success") {
      setEmotion(EMOTION_HAPPY, msg.length() ? msg : "任务完成！", 6000);
      playTone(1318, 100); delay(110); playTone(1760, 180);
    } else if (subCmd == "error" || subCmd == "fail") {
      setEmotion(EMOTION_WORRIED, msg.length() ? msg : "单测失败 / 遇到报错", 6000);
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

  if (cmd == "hello" || cmd == "status") { sendReply(id, true); return; }
  if (cmd == "disarm") {
    disarm("Host request");
    setEmotion(EMOTION_IDLE, "GhostDesk 断开，进入对讲机模式", 2000);
    playTone(600, 100);
    sendReply(id, true);
    updateScreen();
    return;
  }
  if (cmd == "begin") {
    if (tokens.size() < 3) { sendReply(id, false, "syntax"); return; }
    if (state.armed) { sendReply(id, false, "armed"); return; }
    state.armed = true;
    state.session = tokens[2];
    state.emergencyStopped = false;
    state.leaseExpireAt = millis() + LEASE_TIMEOUT_MS;
    state.lastAction = "Session Started: " + tokens[2].substring(0, 6);
    playTone(1200, 150);
    sendReply(id, true);
    updateScreen();
    return;
  }

  if (tokens.size() < 3) { sendReply(id, false, "syntax"); return; }
  if (!state.armed || tokens[2] != state.session) { sendReply(id, false, "session"); return; }

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

  if (cmd == "move") {
    if (tokens.size() < 5) { sendReply(id, false, "syntax"); return; }
    Mouse.move(tokens[3].toInt(), tokens[4].toInt());
    state.lastAction = "MOVE: dx=" + tokens[3] + " dy=" + tokens[4];
    sendReply(id, true);
    return;
  }
  if (cmd == "click") {
    if (tokens.size() < 4) { sendReply(id, false, "syntax"); return; }
    uint8_t b = (tokens[3] == "right") ? MOUSE_RIGHT : MOUSE_LEFT;
    Mouse.press(b); delay(10); Mouse.release(b);
    state.lastAction = "CLICK: " + tokens[3];
    sendReply(id, true);
    return;
  }
  if (cmd == "wheel") {
    if (tokens.size() < 4) { sendReply(id, false, "syntax"); return; }
    Mouse.move(0, 0, tokens[3].toInt());
    state.lastAction = "WHEEL: " + tokens[3];
    sendReply(id, true);
    return;
  }
  if (cmd == "paste") {
    Keyboard.press(KEY_LEFT_CTRL); Keyboard.press('v'); delay(15); Keyboard.releaseAll();
    state.lastAction = "PASTE: [Ctrl+V]";
    sendReply(id, true);
    return;
  }
  if (cmd == "key") {
    if (tokens.size() < 4) { sendReply(id, false, "syntax"); return; }
    String k = tokens[3]; k.toLowerCase();
    if (k == "enter") Keyboard.write(KEY_RETURN);
    else if (k == "tab") Keyboard.write(KEY_TAB);
    else if (k == "backspace") Keyboard.write(KEY_BACKSPACE);
    else if (k == "delete") Keyboard.write(KEY_DELETE);
    else if (k == "left") Keyboard.write(KEY_LEFT_ARROW);
    else if (k == "right") Keyboard.write(KEY_RIGHT_ARROW);
    else if (k == "up") Keyboard.write(KEY_UP_ARROW);
    else if (k == "down") Keyboard.write(KEY_DOWN_ARROW);
    else if (k == "home") Keyboard.write(KEY_HOME);
    else if (k == "end") Keyboard.write(KEY_END);
    else if (k == "escape") Keyboard.write(KEY_ESC);
    else if (k == "pagedown") Keyboard.write(KEY_PAGE_DOWN);
    else if (k == "ctrl+a") {
      Keyboard.press(KEY_LEFT_CTRL); Keyboard.press('a'); delay(10); Keyboard.releaseAll();
    } else if (k == "shift") {
      Keyboard.press(KEY_LEFT_SHIFT); delay(10); Keyboard.release(KEY_LEFT_SHIFT);
    } else {
      sendReply(id, false, "unsupported_key");
      return;
    }
    state.lastAction = "KEY: " + k;
    sendReply(id, true);
    return;
  }
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

  // 初始化双麦克风 (ES7210 16kHz 16bit)
  auto mic_cfg = M5.Mic.config();
  mic_cfg.sample_rate = MIC_SAMPLE_RATE;
  mic_cfg.stereo = false;
  M5.Mic.config(mic_cfg);
  M5.Mic.begin();

  USB.VID(0xCAFE);
  USB.PID(0x4001);
  USB.productName("FlowDesk USB Bridge");
  USB.manufacturerName("FlowDesk");
  USB.serialNumber("M5-CORES3-WALKIE-TALKIE");

  Keyboard.begin();
  Mouse.begin();
  USB.begin();
  Serial.begin(115200);

  playTone(880, 80); delay(100); playTone(1320, 120); delay(130); playTone(1760, 160);
  nextBlinkTime = millis() + 2000;
  nextLookTime = millis() + 4000;
  updateScreen();
}

uint32_t lastScreenUpdate = 0;

void loop() {
  M5.update();
  uint32_t now = millis();

  // 1. 触屏状态检测 (支持持续按住 PTT)
  auto touch = M5.Touch.getDetail();
  
  if (state.armed) {
    if (touch.wasPressed() && touch.y >= 170 && touch.y <= 235) {
      state.emergencyStopped = true;
      disarm("EMERGENCY STOP PRESSED");
      playTone(400, 300);
      updateScreen();
    }
  } else {
    // 检查中间【🎙️ 按住说话】按钮区域 (X: 100 ~ 220, Y: 170 ~ 235)
    bool touchingPTT = touch.isPressed() && (touch.x >= 95 && touch.x <= 225) && (touch.y >= 165 && touch.y <= 235);
    
    if (touchingPTT) {
      if (!state.isRecordingVoice) {
        startVoiceRecording();
      }
    } else {
      if (state.isRecordingVoice) {
        stopVoiceRecording();
      }
    }

    // 左键和右键单击判定
    if (touch.wasClicked()) {
      if (touch.y >= 170 && touch.y <= 235) {
        if (touch.x >= 8 && touch.x <= 95) {
          doApprove();
        } else if (touch.x >= 224 && touch.x <= 312) {
          doReject();
        }
      } else if (touch.y < 160) {
        setEmotion(EMOTION_HAPPY, "主人，随时按住中间按钮对我说话！", 2500);
        playTone(1500, 80); delay(90); playTone(2000, 120);
      }
    }
  }

  // 2. 录音采样处理
  if (state.isRecordingVoice) {
    processMicrophone();
  }

  // 3. 表情与动画更新
  if (!state.armed && !state.isRecordingVoice) {
    if (state.emotion != EMOTION_IDLE && state.emotionUntil > 0 && now > state.emotionUntil) {
      state.emotion = EMOTION_IDLE;
      state.buddyStatusMsg = "Antigravity / Claude 待命";
      state.emotionUntil = 0;
    }

    if (state.emotion == EMOTION_IDLE) {
      if (now > nextBlinkTime) {
        eyeBlinkState = (eyeBlinkState + 1) % 3;
        nextBlinkTime = (eyeBlinkState == 0) ? now + random(2500, 5000) : now + 60;
      }
      if (now > nextLookTime) {
        eyeLookOffset = random(-14, 15);
        nextLookTime = now + random(3000, 6000);
      }
    } else if (state.emotion == EMOTION_THINKING) {
      eyeBlinkState = 0;
      eyeLookOffset = (int)(sin(now / 150.0) * 16.0);
    }
  }

  // 4. GhostDesk 租约检查
  if (state.armed && now > state.leaseExpireAt) {
    disarm("Heartbeat Timeout");
  }

  // 5. 读取电脑串口命令
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      inputBuffer.trim();
      if (inputBuffer.length() > 0) handleCommandLine(inputBuffer);
      inputBuffer = "";
    } else if (c != '\r') {
      inputBuffer += c;
      if (inputBuffer.length() > 256) inputBuffer = "";
    }
  }

  // 6. 定时刷新屏幕 (录音时以 50ms 高帧率渲染声波，平常 80ms)
  uint32_t refreshInterval = state.isRecordingVoice ? 50 : 80;
  if (now - lastScreenUpdate > refreshInterval) {
    lastScreenUpdate = now;
    updateScreen();
  }
}
