#include <Arduino.h>
#include <M5Unified.h>
#include "USB.h"
#include "USBHIDKeyboard.h"
#include "USBHIDMouse.h"
#include "USBHIDConsumerControl.h"
#include "BleCombo.h"
#include "SmartWiFi.h"

// USB HID 复合设备实例 (全平台通用免驱)
USBHIDKeyboard Keyboard;
USBHIDMouse Mouse;
USBHIDConsumerControl ConsumerControl;

// 协议与固件常量
#define PROTOCOL_VERSION 4
#define FIRMWARE_VERSION "0.8.0"
#define DEVICE_NAME "FlowDesk CyberDeck Pro"
#define BOARD_NAME "m5stack-cores3"
#define LEASE_TIMEOUT_MS 10000

// 麦克风录音采样 (16kHz 16bit)
#define MIC_SAMPLE_RATE 16000
#define MIC_CHUNK_SAMPLES 256
static int16_t micBuffer[MIC_CHUNK_SAMPLES];

// 分页模式 (5 大核心空间)
enum AppTab {
  TAB_REMOTE = 0,     // 🎮 超级遥控器 / 环形飞鼠 (小米遥控器布局: 方向盘/OK/音量/主页/返回/播放)
  TAB_WORKSPACE = 1,  // ⚡ 生产力工作台 (跨平台应用切换/会话切换/大号发送/剪贴板宏)
  TAB_TRACKPAD = 2,   // 🖱️ 丝滑触控板 (滑动移动鼠标/单击/双指/滚轮)
  TAB_AI_BUDDY = 3,   // 🤖 AI 赛博对讲与搭子 (灵动表情/按住说/放行/中断)
  TAB_SETTINGS = 4    // 📶 设置与系统切换 (Windows / Mac 模式切换/亮度/电量)
};

enum BuddyEmotion {
  EMOTION_IDLE,
  EMOTION_RECORDING,
  EMOTION_THINKING,
  EMOTION_HAPPY,
  EMOTION_WORRIED
};

// 操作系统模式 (跨平台支持 Windows & macOS / iPadOS)
enum OSMode {
  OS_WINDOWS = 0,
  OS_MACOS = 1
};

struct SystemState {
  AppTab currentTab = TAB_REMOTE; // 默认进入体验极佳的超级遥控器
  AppTab lastTab = (AppTab)-1;
  OSMode osMode = OS_WINDOWS;
  bool needFullRedraw = true;

  // GhostDesk 自动化控制状态
  bool armed = false;
  String session = "";
  uint32_t leaseExpireAt = 0;
  String lastAction = "IDLE (Standby)";
  uint32_t actionCount = 0;
  bool emergencyStopped = false;

  // AI 搭子与录音
  BuddyEmotion emotion = EMOTION_IDLE;
  String buddyStatusMsg = "Antigravity 待命";
  uint32_t emotionUntil = 0;
  bool isRecordingVoice = false;
  uint32_t recordingStartTime = 0;
  int currentAudioVolume = 0;

  // 触控板高精度弹道动力学与亚像素累加器
  bool isDragging = false;
  int lastTouchX = 0;
  int lastTouchY = 0;
  float subpixelX = 0.0f;
  float subpixelY = 0.0f;
  uint32_t touchStartTime = 0;
  int touchStartOriginX = 0;
  int touchStartOriginY = 0;
  bool rightClickTriggered = false;

  // 硬件与参数
  int brightness = 120;
  int lastBatteryPercent = -1;
  bool lastBleConnected = false;
  bool lastWifiConnected = false;
  uint32_t lastStatusCheckTime = 0;
} state;

// 赛博眼眸动画局部刷新变量
int eyeBlinkState = 0;
uint32_t nextBlinkTime = 0;
int eyeLookOffset = 0;
uint32_t nextLookTime = 0;
uint32_t lastEyeUpdateTime = 0;

String inputBuffer = "";

void playTone(int freq, int durationMs) {
  M5.Speaker.tone(freq, durationMs);
}

void releaseAll() {
  Keyboard.releaseAll();
  Mouse.release(MOUSE_LEFT | MOUSE_RIGHT | MOUSE_MIDDLE);
  if (BleCombo.isConnected()) {
    BleCombo.releaseAllKeys();
  }
}

void disarm(const String& reason = "") {
  state.armed = false;
  state.session = "";
  state.leaseExpireAt = 0;
  releaseAll();
  if (reason.length() > 0) state.lastAction = "DISARMED: " + reason;
  state.needFullRedraw = true;
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

// ---------------- 统一多端输入派发 (USB 有线 + BLE 蓝牙无线双发) ----------------
void sendKeyCombo(uint8_t usbMod, uint8_t usbKey, uint8_t bleMod, uint8_t bleKey) {
  if (usbMod) Keyboard.press(usbMod);
  if (usbKey) Keyboard.press(usbKey);
  delay(25);
  Keyboard.releaseAll();

  if (BleCombo.isConnected()) {
    BleCombo.writeKey(bleMod, bleKey);
  }
}

void sendMediaCombo(uint16_t usbMedia, uint16_t bleMedia) {
  ConsumerControl.press(usbMedia);
  delay(25);
  ConsumerControl.release();

  if (BleCombo.isConnected()) {
    BleCombo.sendMedia(bleMedia);
  }
}

void sendMouseClickCombo(uint8_t usbBtn, uint8_t bleBtn) {
  Mouse.click(usbBtn);
  if (BleCombo.isConnected()) {
    BleCombo.mouseClick(bleBtn);
  }
}

void sendMouseMoveCombo(int8_t x, int8_t y, int8_t wheel = 0) {
  Mouse.move(x, y, wheel);
  if (BleCombo.isConnected()) {
    BleCombo.moveMouse(x, y, wheel);
  }
}

// ---------------- 跨平台生产力快捷键与多媒体 ----------------
uint8_t getModKey() {
  return (state.osMode == OS_MACOS) ? KEY_LEFT_GUI : KEY_LEFT_CTRL;
}

uint8_t getBleModKey() {
  return (state.osMode == OS_MACOS) ? KEY_BLE_GUI : KEY_BLE_CTRL;
}

void doAppSwitch() {
  // Win: Alt+Tab; Mac: Cmd+Tab
  if (state.osMode == OS_MACOS) {
    sendKeyCombo(KEY_LEFT_GUI, KEY_TAB, KEY_BLE_GUI, HID_KEY_TAB);
  } else {
    sendKeyCombo(KEY_LEFT_ALT, KEY_TAB, KEY_BLE_ALT, HID_KEY_TAB);
  }
  playTone(900, 30);
}

void doTaskView() {
  // Win: Win+Tab; Mac: Control+Up (Mission Control)
  if (state.osMode == OS_MACOS) {
    sendKeyCombo(KEY_LEFT_CTRL, KEY_UP_ARROW, KEY_BLE_CTRL, HID_KEY_UP_ARROW);
  } else {
    sendKeyCombo(KEY_LEFT_GUI, KEY_TAB, KEY_BLE_GUI, HID_KEY_TAB);
  }
  playTone(1000, 35);
}

void doPrevTab() {
  // 切换上一个会话/标签
  if (state.osMode == OS_MACOS) {
    Keyboard.press(KEY_LEFT_GUI); Keyboard.press(KEY_LEFT_ALT); Keyboard.press(KEY_LEFT_ARROW); delay(25); Keyboard.releaseAll();
    if (BleCombo.isConnected()) BleCombo.writeKey(KEY_BLE_GUI | KEY_BLE_ALT, HID_KEY_LEFT_ARROW);
  } else {
    Keyboard.press(KEY_LEFT_CTRL); Keyboard.press(KEY_LEFT_SHIFT); Keyboard.press(KEY_TAB); delay(25); Keyboard.releaseAll();
    if (BleCombo.isConnected()) BleCombo.writeKey(KEY_BLE_CTRL | KEY_BLE_SHIFT, HID_KEY_TAB);
  }
  playTone(850, 30);
}

void doNextTab() {
  // 切换下一个会话/标签
  if (state.osMode == OS_MACOS) {
    Keyboard.press(KEY_LEFT_GUI); Keyboard.press(KEY_LEFT_ALT); Keyboard.press(KEY_RIGHT_ARROW); delay(25); Keyboard.releaseAll();
    if (BleCombo.isConnected()) BleCombo.writeKey(KEY_BLE_GUI | KEY_BLE_ALT, HID_KEY_RIGHT_ARROW);
  } else {
    Keyboard.press(KEY_LEFT_CTRL); Keyboard.press(KEY_TAB); delay(25); Keyboard.releaseAll();
    if (BleCombo.isConnected()) BleCombo.writeKey(KEY_BLE_CTRL, HID_KEY_TAB);
  }
  playTone(950, 30);
}

void doCloseTab() {
  // 关闭当前会话/标签 (Ctrl+W 或 Cmd+W)
  sendKeyCombo(getModKey(), 'w', getBleModKey(), 0x1A);
  playTone(600, 40);
}

void doSendEnter() {
  sendKeyCombo(0, KEY_RETURN, 0, HID_KEY_RETURN);
  playTone(1500, 60);
}

void doSendCtrlEnter() {
  // 强力发送 (Ctrl+Enter 或 Cmd+Enter)
  sendKeyCombo(getModKey(), KEY_RETURN, getBleModKey(), HID_KEY_RETURN);
  playTone(1800, 70);
}

void doShiftEnter() {
  sendKeyCombo(KEY_LEFT_SHIFT, KEY_RETURN, KEY_BLE_SHIFT, HID_KEY_RETURN);
  playTone(1100, 30);
}

void doCopy() {
  sendKeyCombo(getModKey(), 'c', getBleModKey(), 0x06);
  playTone(1200, 30);
}

void doPaste() {
  sendKeyCombo(getModKey(), 'v', getBleModKey(), 0x19);
  playTone(1300, 35);
}

// 多媒体与遥控器按键 (全平台免驱)
void doVolumeUp() {
  sendMediaCombo(CONSUMER_CONTROL_VOLUME_INCREMENT, BLE_MEDIA_VOLUME_UP);
  playTone(1400, 25);
}

void doVolumeDown() {
  sendMediaCombo(CONSUMER_CONTROL_VOLUME_DECREMENT, BLE_MEDIA_VOLUME_DOWN);
  playTone(900, 25);
}

void doMute() {
  sendMediaCombo(CONSUMER_CONTROL_MUTE, BLE_MEDIA_MUTE);
  playTone(700, 35);
}

void doPlayPause() {
  sendMediaCombo(CONSUMER_CONTROL_PLAY_PAUSE, BLE_MEDIA_PLAY_PAUSE);
  playTone(1200, 40);
}

void doHome() {
  sendMediaCombo(CONSUMER_CONTROL_HOME, BLE_MEDIA_HOME);
  playTone(1100, 35);
}

void doBack() {
  sendKeyCombo(0, KEY_ESC, 0, HID_KEY_ESCAPE);
  playTone(750, 30);
}

void doKeyDirection(uint8_t key) {
  uint8_t bKey = 0;
  if (key == KEY_UP_ARROW) bKey = HID_KEY_UP_ARROW;
  else if (key == KEY_DOWN_ARROW) bKey = HID_KEY_DOWN_ARROW;
  else if (key == KEY_LEFT_ARROW) bKey = HID_KEY_LEFT_ARROW;
  else if (key == KEY_RIGHT_ARROW) bKey = HID_KEY_RIGHT_ARROW;
  sendKeyCombo(0, key, 0, bKey);
  playTone(1000, 25);
}

// ---------------- 界面绘制 (零闪烁架构) ----------------
void drawTopBar() {
  M5.Display.fillRect(0, 0, 320, 26, 0x10A2); // 仅在整页刷新或变化时绘制
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_WHITE);

  if (state.currentTab == TAB_REMOTE) M5.Display.drawString("遥控器", 6, 6);
  else if (state.currentTab == TAB_WORKSPACE) M5.Display.drawString("工作台", 6, 6);
  else if (state.currentTab == TAB_TRACKPAD) M5.Display.drawString("触控板", 6, 6);
  else if (state.currentTab == TAB_AI_BUDDY) M5.Display.drawString("语音输入", 6, 6);
  else if (state.currentTab == TAB_SETTINGS) M5.Display.drawString("系统设置", 6, 6);

  // 跨平台模式指示
  M5.Display.setTextColor(state.osMode == OS_MACOS ? 0x7DFF : TFT_GREENYELLOW);
  M5.Display.drawString(state.osMode == OS_MACOS ? "[Mac]" : "[Win]", 72, 6);

  // BLE 蓝牙状态 (实机状态)
  bool bleConn = BleCombo.isConnected();
  M5.Display.setTextColor(bleConn ? 0x07FF : 0x8410);
  M5.Display.drawString(bleConn ? "蓝牙已连" : "蓝牙未连", 116, 6);

  // Wi-Fi 状态与网络时间
  bool wifiConn = SmartWiFi.isConnected();
  if (wifiConn) {
    M5.Display.setTextColor(0x07E0);
    String tStr = SmartWiFi.getTimeStr();
    M5.Display.drawString(tStr.length() > 0 ? ("WIFI " + tStr) : "WIFI在线", 188, 6);
  } else {
    M5.Display.setTextColor(0x7BEF);
    M5.Display.drawString("WIFI休眠", 188, 6);
  }

  // 电池百分比
  int battery = M5.Power.getBatteryLevel();
  if (battery > 100) battery = 100;
  state.lastBatteryPercent = battery;
  M5.Display.setTextColor(battery < 20 ? TFT_RED : TFT_LIGHTGRAY);
  M5.Display.drawString(String(battery) + "%", 276, 6);
}

void drawBottomDock() {
  M5.Display.fillRect(0, 202, 320, 38, 0x0841);
  M5.Display.drawFastHLine(0, 202, 320, 0x31A6);

  const char* titles[5] = {"遥控", "工作台", "触控板", "语音输入", "设置"};

  for (int i = 0; i < 5; ++i) {
    int x = 2 + i * 64;
    bool isCur = (state.currentTab == (AppTab)i);
    uint16_t bg = isCur ? 0x03E0 : 0x18E3;
    uint16_t border = isCur ? TFT_GREENYELLOW : 0x2965;

    M5.Display.fillRoundRect(x + 2, 205, 58, 32, 6, bg);
    M5.Display.drawRoundRect(x + 2, 205, 58, 32, 6, border);

    M5.Display.setTextColor(isCur ? TFT_WHITE : TFT_LIGHTGRAY);
    M5.Display.setTextSize(1);
    M5.Display.drawCenterString(titles[i], x + 31, 214);
  }
}

// 分页 0：【超级遥控器 / 大屏与全电脑操作】
void drawTabRemote() {
  M5.Display.fillRect(0, 26, 320, 176, TFT_BLACK);

  // 1. 左侧：环形十字方向导航盘 (中心 95, 112, 半径 68)
  int cx = 95, cy = 112;
  // 外环底色
  M5.Display.fillCircle(cx, cy, 68, 0x18E3);
  M5.Display.drawCircle(cx, cy, 68, 0x4A69);

  // 中心 确定 键
  M5.Display.fillCircle(cx, cy, 26, 0x03E0);
  M5.Display.drawCircle(cx, cy, 26, TFT_WHITE);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("确定", cx, cy - 6);

  // 四个方向
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("上", cx, cy - 54);
  M5.Display.drawCenterString("下", cx, cy + 42);
  M5.Display.drawCenterString("左", cx - 48, cy - 6);
  M5.Display.drawCenterString("右", cx + 48, cy - 6);

  // 2. 右侧功能按键矩阵 (X: 180 ~ 312)
  // 行 1：返回与桌面 (Y: 34 ~ 74)
  M5.Display.fillRoundRect(182, 34, 60, 40, 6, 0x31A6);
  M5.Display.drawRoundRect(182, 34, 60, 40, 6, 0x62B5);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("返回", 212, 48);

  M5.Display.fillRoundRect(248, 34, 64, 40, 6, 0x31A6);
  M5.Display.drawRoundRect(248, 34, 64, 40, 6, 0x62B5);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("回桌面", 280, 48);

  // 行 2：实体级鼠标左键与鼠标右键 (Y: 80 ~ 120)
  M5.Display.fillRoundRect(182, 80, 60, 40, 6, 0x1A64);
  M5.Display.drawRoundRect(182, 80, 60, 40, 6, TFT_GREEN);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("左键", 212, 94);

  M5.Display.fillRoundRect(248, 80, 64, 40, 6, 0x4A00);
  M5.Display.drawRoundRect(248, 80, 64, 40, 6, TFT_GOLD);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("右键", 280, 94);

  // 行 3：音量与多媒体控制条 (Y: 126 ~ 170)
  M5.Display.fillRoundRect(182, 126, 40, 44, 6, 0x2124);
  M5.Display.drawRoundRect(182, 126, 40, 44, 6, 0x4A69);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("音量-", 202, 142);

  M5.Display.fillRoundRect(226, 126, 44, 44, 6, 0x31A6);
  M5.Display.drawRoundRect(226, 126, 44, 44, 6, 0x62B5);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("播/停", 248, 142);

  M5.Display.fillRoundRect(274, 126, 38, 44, 6, 0x2124);
  M5.Display.drawRoundRect(274, 126, 38, 44, 6, 0x4A69);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("音量+", 293, 142);
}

// 分页 1：【跨平台生产力工作台】
void drawTabWorkspace() {
  M5.Display.fillRect(0, 26, 320, 176, TFT_BLACK);

  // 行 1：窗口与应用轮转 (Y: 30 ~ 72)
  M5.Display.fillRoundRect(6, 30, 72, 42, 6, 0x2124);
  M5.Display.drawRoundRect(6, 30, 72, 42, 6, 0x4A69);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("切应用", 42, 36);
  M5.Display.setTextColor(TFT_CYAN);
  M5.Display.drawCenterString("切窗口", 42, 52);

  M5.Display.fillRoundRect(84, 30, 72, 42, 6, 0x2124);
  M5.Display.drawRoundRect(84, 30, 72, 42, 6, 0x4A69);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("全部窗口", 120, 36);
  M5.Display.setTextColor(TFT_CYAN);
  M5.Display.drawCenterString("多任务", 120, 52);

  M5.Display.fillRoundRect(162, 30, 72, 42, 6, 0x1A64);
  M5.Display.drawRoundRect(162, 30, 72, 42, 6, TFT_GREEN);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("微信呼出", 198, 36);
  M5.Display.setTextColor(TFT_GREENYELLOW);
  M5.Display.drawCenterString("前置窗口", 198, 52);

  M5.Display.fillRoundRect(240, 30, 74, 42, 6, 0x194B);
  M5.Display.drawRoundRect(240, 30, 74, 42, 6, 0x3B3F);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("代码窗口", 277, 36);
  M5.Display.setTextColor(0x7DFF);
  M5.Display.drawCenterString("前置代码", 277, 52);

  // 行 2：会话与项目轮转 (Y: 78 ~ 120)
  M5.Display.fillRoundRect(6, 78, 72, 42, 6, 0x2945);
  M5.Display.drawRoundRect(6, 78, 72, 42, 6, 0x52AA);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("上标签", 42, 84);
  M5.Display.setTextColor(TFT_LIGHTGRAY);
  M5.Display.drawCenterString("向前会话", 42, 100);

  M5.Display.fillRoundRect(84, 78, 72, 42, 6, 0x2945);
  M5.Display.drawRoundRect(84, 78, 72, 42, 6, 0x52AA);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("下标签", 120, 84);
  M5.Display.setTextColor(TFT_LIGHTGRAY);
  M5.Display.drawCenterString("向后会话", 120, 100);

  M5.Display.fillRoundRect(162, 78, 72, 42, 6, 0x6144);
  M5.Display.drawRoundRect(162, 78, 72, 42, 6, TFT_RED);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("关闭标签", 198, 84);
  M5.Display.setTextColor(0xFDA0);
  M5.Display.drawCenterString("关闭当前", 198, 100);

  M5.Display.fillRoundRect(240, 78, 74, 42, 6, 0x2945);
  M5.Display.drawRoundRect(240, 78, 74, 42, 6, 0x52AA);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("新建标签", 277, 84);
  M5.Display.setTextColor(TFT_LIGHTGRAY);
  M5.Display.drawCenterString("新建页面", 277, 100);

  // 行 3：大号专属发送中枢与宏 (Y: 126 ~ 196)
  M5.Display.fillRoundRect(6, 126, 104, 68, 8, 0x05E0);
  M5.Display.drawRoundRect(6, 126, 104, 68, 8, TFT_WHITE);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("发 送", 58, 142);
  M5.Display.setTextColor(TFT_GREENYELLOW);
  M5.Display.drawCenterString("直接发送", 58, 168);

  M5.Display.fillRoundRect(116, 126, 94, 32, 6, 0x0B80);
  M5.Display.drawRoundRect(116, 126, 94, 32, 6, TFT_GREEN);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("强制发送", 163, 136);

  M5.Display.fillRoundRect(116, 162, 94, 32, 6, 0x2124);
  M5.Display.drawRoundRect(116, 162, 94, 32, 6, 0x4A69);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("换行不发送", 163, 172);

  M5.Display.fillRoundRect(216, 126, 46, 68, 6, 0x31A6);
  M5.Display.drawRoundRect(216, 126, 46, 68, 6, TFT_CYAN);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("粘贴", 239, 154);

  M5.Display.fillRoundRect(268, 126, 46, 68, 6, 0x31A6);
  M5.Display.drawRoundRect(268, 126, 46, 68, 6, TFT_GOLD);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("复制", 291, 154);
}

// 分页 2：【高精度触控板 - 指哪儿打哪儿】
void drawTabTrackpad() {
  M5.Display.fillRect(0, 26, 320, 176, TFT_BLACK);

  // 1. 左侧主触控板感应区 (X: 8 ~ 254, Y: 30 ~ 148)
  M5.Display.fillRoundRect(8, 30, 246, 118, 8, 0x1082);
  M5.Display.drawRoundRect(8, 30, 246, 118, 8, 0x31A6);

  M5.Display.setTextColor(TFT_LIGHTGRAY);
  M5.Display.setTextSize(1);
  M5.Display.drawCenterString("--- 高精度弹道触控感应区 ---", 131, 46);
  M5.Display.drawCenterString("慢移像素级微调  快甩飞越全屏", 131, 68);
  M5.Display.setTextColor(TFT_GREENYELLOW);
  M5.Display.drawCenterString("轻按单击左键  原地长按触发右键", 131, 90);
  M5.Display.setTextColor(0x7DFF);
  M5.Display.drawCenterString("指哪打哪  瞬时零延迟响应", 131, 112);

  // 2. 右侧垂直平滑滚轮专属滑道 (X: 260 ~ 312, Y: 30 ~ 148)
  M5.Display.fillRoundRect(260, 30, 52, 118, 8, 0x0841);
  M5.Display.drawRoundRect(260, 30, 52, 118, 8, TFT_CYAN);
  M5.Display.setTextColor(TFT_CYAN);
  M5.Display.drawCenterString("上", 286, 38);
  M5.Display.drawCenterString("滚", 286, 62);
  M5.Display.drawCenterString("轮", 286, 82);
  M5.Display.drawCenterString("下", 286, 126);

  // 3. 底部两大实体级按键 (Y: 152 ~ 198)
  // 鼠标左键 (X: 8 ~ 156)
  M5.Display.fillRoundRect(8, 152, 148, 46, 8, 0x1A64);
  M5.Display.drawRoundRect(8, 152, 148, 46, 8, TFT_GREEN);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.setTextSize(1);
  M5.Display.drawCenterString("鼠标左键", 82, 168);

  // 鼠标右键 (X: 164 ~ 312)
  M5.Display.fillRoundRect(164, 152, 148, 46, 8, 0x4A00);
  M5.Display.drawRoundRect(164, 152, 148, 46, 8, TFT_GOLD);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("鼠标右键", 238, 168);
}

// 赛博眼睛 (仅在眼睛区域局部重绘，绝不闪烁)
void drawEyesLocal(int centerX, int centerY, BuddyEmotion emotion, int blink) {
  // 局部清除眼睛区域
  M5.Display.fillRect(centerX - 80, centerY - 35, 160, 70, TFT_BLACK);

  int eyeWidth = 44;
  int eyeHeight = 52;
  int eyeSpacing = 42;
  int leftX = centerX - eyeSpacing - eyeWidth / 2 + eyeLookOffset;
  int rightX = centerX + eyeSpacing - eyeWidth / 2 + eyeLookOffset;

  uint16_t eyeColor = 0x07FF;
  if (emotion == EMOTION_THINKING) eyeColor = 0xFBE0;
  if (emotion == EMOTION_HAPPY)    eyeColor = 0x07E0;
  if (emotion == EMOTION_WORRIED)  eyeColor = 0xF800;

  if (emotion == EMOTION_HAPPY) {
    M5.Display.fillRoundRect(leftX, centerY - 6, eyeWidth, 12, 6, eyeColor);
    M5.Display.fillRoundRect(rightX, centerY - 6, eyeWidth, 12, 6, eyeColor);
    M5.Display.fillCircle(leftX + eyeWidth / 2, centerY - 12, 13, eyeColor);
    M5.Display.fillCircle(rightX + eyeWidth / 2, centerY - 12, 13, eyeColor);
    M5.Display.fillCircle(leftX + eyeWidth / 2, centerY - 6, 12, TFT_BLACK);
    M5.Display.fillCircle(rightX + eyeWidth / 2, centerY - 6, 12, TFT_BLACK);
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

// 分页 3：【AI 对讲与灵动搭子】
void drawTabAIBuddyFull() {
  M5.Display.fillRect(0, 26, 320, 176, TFT_BLACK);
  drawEyesLocal(160, 75, state.emotion, eyeBlinkState);

  M5.Display.setTextColor(state.isRecordingVoice ? TFT_RED : (state.emotion == EMOTION_HAPPY ? TFT_GREENYELLOW : (state.emotion == EMOTION_WORRIED ? TFT_RED : TFT_CYAN)));
  if (state.isRecordingVoice) {
    uint32_t secs = (millis() - state.recordingStartTime) / 1000;
    M5.Display.drawCenterString("正在录音中 (" + String(secs) + "秒) 点击完成发送", 160, 132);
  } else {
    M5.Display.drawCenterString(state.buddyStatusMsg, 160, 132);
  }

  // 底部控制键
  M5.Display.fillRoundRect(8, 152, 88, 46, 6, 0x1C64);
  M5.Display.drawRoundRect(8, 152, 88, 46, 6, TFT_GREEN);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("放行 Y", 52, 168);

  // 中间点击说话键：未录音时为醒目绿/青色，正在录音时变为大红按键
  uint16_t pttColor = state.isRecordingVoice ? 0xB800 : 0x03E0;
  uint16_t pttBorder = state.isRecordingVoice ? TFT_RED : TFT_GREENYELLOW;
  M5.Display.fillRoundRect(102, 152, 116, 46, 6, pttColor);
  M5.Display.drawRoundRect(102, 152, 116, 46, 6, pttBorder);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString(state.isRecordingVoice ? "点击完成" : "点击说话", 160, 168);

  M5.Display.fillRoundRect(224, 152, 88, 46, 6, 0x8000);
  M5.Display.drawRoundRect(224, 152, 88, 46, 6, TFT_RED);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("中断 ESC", 268, 168);
}

// 分页 4：【设置与跨平台配置】
void drawTabSettings() {
  M5.Display.fillRect(0, 26, 320, 176, TFT_BLACK);

  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_GOLD);
  M5.Display.drawString("系统设置与硬件状态", 15, 32);

  // 跨平台切换开关按键 (Y: 50 ~ 86)
  M5.Display.setTextColor(TFT_LIGHTGRAY);
  M5.Display.drawString("电脑模式:", 15, 62);

  bool isWin = (state.osMode == OS_WINDOWS);
  M5.Display.fillRoundRect(85, 50, 105, 34, 6, isWin ? 0x03E0 : 0x2124);
  M5.Display.drawRoundRect(85, 50, 105, 34, 6, isWin ? TFT_GREENYELLOW : 0x4A69);
  M5.Display.setTextColor(isWin ? TFT_WHITE : TFT_LIGHTGRAY);
  M5.Display.drawCenterString("微软 Win", 137, 60);

  M5.Display.fillRoundRect(200, 50, 105, 34, 6, !isWin ? 0x001F : 0x2124);
  M5.Display.drawRoundRect(200, 50, 105, 34, 6, !isWin ? 0x7DFF : 0x4A69);
  M5.Display.setTextColor(!isWin ? TFT_WHITE : TFT_LIGHTGRAY);
  M5.Display.drawCenterString("苹果 Mac", 252, 60);

  // 网络与蓝牙状态 (Y: 92 ~ 136)
  bool bleOk = BleCombo.isConnected();
  bool wifiOk = SmartWiFi.isConnected();

  M5.Display.setTextColor(TFT_LIGHTGRAY);
  M5.Display.drawString("蓝牙无线:", 15, 96);
  M5.Display.setTextColor(bleOk ? TFT_GREENYELLOW : 0x07FF);
  M5.Display.drawString(bleOk ? "已连接(就绪)" : "广播中(可配对)", 75, 96);

  M5.Display.setTextColor(TFT_LIGHTGRAY);
  M5.Display.drawString("无线网络:", 15, 116);
  M5.Display.setTextColor(wifiOk ? TFT_GREENYELLOW : TFT_LIGHTGRAY);
  M5.Display.drawString(wifiOk ? ("IP: " + SmartWiFi.getIP()) : "休眠断开(极省电)", 75, 116);

  // Wi-Fi 手动连接/重试按键 (X: 200..305, Y: 92..132)
  M5.Display.fillRoundRect(200, 92, 105, 40, 6, wifiOk ? 0x1A64 : 0x10A2);
  M5.Display.drawRoundRect(200, 92, 105, 40, 6, wifiOk ? TFT_GREEN : TFT_CYAN);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString(wifiOk ? "重连网络" : "开启网络", 252, 104);

  // 亮度调节按键 (Y: 144 ~ 186)
  M5.Display.fillRoundRect(15, 144, 135, 42, 6, 0x2124);
  M5.Display.drawRoundRect(15, 144, 135, 42, 6, 0x4A69);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("调亮屏幕", 82, 158);

  M5.Display.fillRoundRect(170, 144, 135, 42, 6, 0x2124);
  M5.Display.drawRoundRect(170, 144, 135, 42, 6, 0x4A69);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("调暗屏幕", 237, 158);
}

// 绘制 Armed 物理急停看板
void drawArmedScreen() {
  M5.Display.fillRect(0, 0, 320, 32, TFT_DARKGREEN);
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawString("FlowDesk 自动化运行中", 10, 8);
  M5.Display.setTextColor(TFT_GREENYELLOW);
  M5.Display.drawString("[ 运行中 ]", 210, 8);

  M5.Display.fillRect(0, 32, 320, 140, TFT_BLACK);
  M5.Display.setTextColor(TFT_LIGHTGRAY);
  M5.Display.drawString("任务会话:", 15, 45);
  M5.Display.setTextColor(TFT_CYAN);
  M5.Display.drawString(state.session, 85, 45);

  M5.Display.drawString("执行动作:", 15, 65);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawString(String(state.actionCount) + " 次", 85, 65);

  M5.Display.drawRoundRect(10, 88, 300, 75, 6, TFT_NAVY);
  M5.Display.fillRect(12, 90, 296, 71, 0x0821);
  M5.Display.setTextColor(TFT_GOLD);
  M5.Display.drawString("当前动作:", 20, 96);
  M5.Display.setTextColor(TFT_WHITE);
  String displayAction = state.lastAction;
  if (displayAction.length() > 34) displayAction = displayAction.substring(0, 31) + "...";
  M5.Display.drawString(displayAction, 20, 116);

  M5.Display.fillRoundRect(15, 180, 290, 50, 8, 0xB800);
  M5.Display.drawRoundRect(15, 180, 290, 50, 8, TFT_WHITE);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.drawCenterString("紧急停止 (点击立即终止)", 160, 196);
}

// 核心渲染调度函数 (彻底杜绝不必要的整屏擦除，零闪烁！)
void renderDisplay() {
  if (state.armed) {
    if (state.needFullRedraw) {
      M5.Display.startWrite();
      drawArmedScreen();
      M5.Display.endWrite();
      state.needFullRedraw = false;
    }
    return;
  }

  // 只有在页面发生切换或需要全刷时才重绘主背景与 Dock 栏
  if (state.needFullRedraw || state.currentTab != state.lastTab) {
    M5.Display.startWrite();
    drawTopBar();
    if (state.currentTab == TAB_REMOTE) drawTabRemote();
    else if (state.currentTab == TAB_WORKSPACE) drawTabWorkspace();
    else if (state.currentTab == TAB_TRACKPAD) drawTabTrackpad();
    else if (state.currentTab == TAB_AI_BUDDY) drawTabAIBuddyFull();
    else if (state.currentTab == TAB_SETTINGS) drawTabSettings();
    drawBottomDock();
    M5.Display.endWrite();

    state.lastTab = state.currentTab;
    state.needFullRedraw = false;
  }
}

// ---------------- 录音控制 ----------------
void startVoiceRecording() {
  if (state.isRecordingVoice) return;
  state.isRecordingVoice = true;
  state.recordingStartTime = millis();
  state.emotion = EMOTION_RECORDING;
  playTone(1320, 60); delay(70); playTone(1760, 80);
  Serial.println("VOICE_START");
  Serial.flush();
  state.needFullRedraw = true;
}

void stopVoiceRecording() {
  if (!state.isRecordingVoice) return;
  state.isRecordingVoice = false;
  playTone(880, 80);
  Serial.println("VOICE_END");
  Serial.flush();
  state.emotion = EMOTION_THINKING;
  state.buddyStatusMsg = "语音已传输，AI 分析中...";
  state.emotionUntil = millis() + 8000;
  state.needFullRedraw = true;
}

void processMicrophone() {
  if (!state.isRecordingVoice) return;
  if (M5.Mic.record(micBuffer, MIC_CHUNK_SAMPLES, MIC_SAMPLE_RATE)) {
    int32_t sum = 0;
    for (int i = 0; i < MIC_CHUNK_SAMPLES; ++i) sum += (int32_t)abs(micBuffer[i]);
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

// ---------------- 串口协议处理 ----------------
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
      state.emotion = EMOTION_THINKING;
      state.buddyStatusMsg = msg.length() ? msg : "AI 正在思考中...";
      state.emotionUntil = millis() + 10000;
      playTone(880, 50);
    } else if (subCmd == "done" || subCmd == "success") {
      state.emotion = EMOTION_HAPPY;
      state.buddyStatusMsg = msg.length() ? msg : "任务完成！";
      state.emotionUntil = millis() + 6000;
      playTone(1318, 100); delay(110); playTone(1760, 180);
    } else if (subCmd == "error" || subCmd == "fail") {
      state.emotion = EMOTION_WORRIED;
      state.buddyStatusMsg = msg.length() ? msg : "遇到报错";
      state.emotionUntil = millis() + 6000;
      playTone(440, 300);
    } else if (subCmd == "idle") {
      state.emotion = EMOTION_IDLE;
      state.buddyStatusMsg = msg.length() ? msg : "Antigravity 待命";
      state.emotionUntil = 0;
    }
    Serial.println("{\"ok\":true,\"buddy\":true}");
    state.needFullRedraw = true;
    return;
  }

  uint32_t id = tokens[0].toInt();
  String cmd = tokens.size() > 1 ? tokens[1] : "";

  if (cmd == "hello" || cmd == "status") { sendReply(id, true); return; }
  if (cmd == "reboot" || cmd == "reset") {
    sendReply(id, true);
    delay(100);
    esp_restart();
    return;
  }
  if (cmd == "disarm") {
    disarm("Host request");
    playTone(600, 100);
    sendReply(id, true);
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
    state.needFullRedraw = true;
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
    return;
  }

  state.leaseExpireAt = millis() + LEASE_TIMEOUT_MS;
  state.actionCount++;

  if (cmd == "move") {
    if (tokens.size() < 5) { sendReply(id, false, "syntax"); return; }
    sendMouseMoveCombo(tokens[3].toInt(), tokens[4].toInt(), 0);
    state.lastAction = "MOVE: dx=" + tokens[3] + " dy=" + tokens[4];
    sendReply(id, true);
    return;
  }
  if (cmd == "click") {
    if (tokens.size() < 4) { sendReply(id, false, "syntax"); return; }
    bool isRight = (tokens[3] == "right");
    sendMouseClickCombo(isRight ? MOUSE_RIGHT : MOUSE_LEFT, isRight ? 0x02 : 0x01);
    state.lastAction = "CLICK: " + tokens[3];
    sendReply(id, true);
    return;
  }
  if (cmd == "wheel") {
    if (tokens.size() < 4) { sendReply(id, false, "syntax"); return; }
    sendMouseMoveCombo(0, 0, tokens[3].toInt());
    state.lastAction = "WHEEL: " + tokens[3];
    sendReply(id, true);
    return;
  }
  if (cmd == "paste") {
    doPaste();
    state.lastAction = "PASTE";
    sendReply(id, true);
    return;
  }
  if (cmd == "key") {
    if (tokens.size() < 4) { sendReply(id, false, "syntax"); return; }
    String k = tokens[3]; k.toLowerCase();
    if (k == "enter") sendKeyCombo(0, KEY_RETURN, 0, HID_KEY_RETURN);
    else if (k == "tab") sendKeyCombo(0, KEY_TAB, 0, HID_KEY_TAB);
    else if (k == "backspace") sendKeyCombo(0, KEY_BACKSPACE, 0, HID_KEY_BACKSPACE);
    else if (k == "delete") sendKeyCombo(0, KEY_DELETE, 0, HID_KEY_DELETE);
    else if (k == "left") sendKeyCombo(0, KEY_LEFT_ARROW, 0, HID_KEY_LEFT_ARROW);
    else if (k == "right") sendKeyCombo(0, KEY_RIGHT_ARROW, 0, HID_KEY_RIGHT_ARROW);
    else if (k == "up") sendKeyCombo(0, KEY_UP_ARROW, 0, HID_KEY_UP_ARROW);
    else if (k == "down") sendKeyCombo(0, KEY_DOWN_ARROW, 0, HID_KEY_DOWN_ARROW);
    else if (k == "escape") sendKeyCombo(0, KEY_ESC, 0, HID_KEY_ESCAPE);
    else {
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
    if (BleCombo.isConnected()) BleCombo.print(tokens[3]);
    state.lastAction = "TYPE: " + tokens[3];
    sendReply(id, true);
    return;
  }
  if (cmd == "wifi") {
    if (tokens.size() >= 4) {
      SmartWiFi.setCredentials(tokens[2], tokens[3]);
      bool ok = SmartWiFi.connect(5000);
      sendReply(id, ok, ok ? "" : "connect_failed");
      state.needFullRedraw = true;
      return;
    }
  }
  sendReply(id, false, "unknown_cmd");
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  M5.Display.setBrightness(state.brightness);
  M5.Display.setFont(&fonts::efontCN_14);
  M5.Display.setTextWrap(false);
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextColor(TFT_CYAN, TFT_BLACK);
  M5.Display.setTextDatum(MC_DATUM);
  M5.Display.drawString("FlowDesk v0.8.0 开机中", 160, 110);
  M5.Speaker.setVolume(160);

  auto mic_cfg = M5.Mic.config();
  mic_cfg.sample_rate = MIC_SAMPLE_RATE;
  mic_cfg.stereo = false;
  M5.Mic.config(mic_cfg);
  M5.Mic.begin();

  // 复合 USB 描述符
  USB.VID(0xCAFE);
  USB.PID(0x4001);
  USB.productName("FlowDesk CyberDeck Pro");
  USB.manufacturerName("FlowDesk");
  USB.serialNumber("M5-CORES3-PRO-080");

  Keyboard.begin();
  Mouse.begin();
  ConsumerControl.begin();
  USB.begin();
  Serial.begin(115200);

  // 启动 BLE 蓝牙无线键盘/鼠标 (对电脑广播 FlowDesk CyberDeck)
  BleCombo.begin("FlowDesk CyberDeck");

  // 启动智能低功耗 Wi-Fi (开机检测一次，5秒超时失败自动切断射频彻底省电)
  SmartWiFi.begin();

  playTone(880, 80); delay(90); playTone(1320, 100); delay(100); playTone(1760, 140);
  nextBlinkTime = millis() + 2000;
  nextLookTime = millis() + 4000;

  state.needFullRedraw = true;
  renderDisplay();
}

void loop() {
  M5.update();
  uint32_t now = millis();

  auto touch = M5.Touch.getDetail();

  // 1. Armed 状态急停检测
  if (state.armed) {
    if (touch.wasPressed() && touch.y >= 170 && touch.y <= 235) {
      state.emergencyStopped = true;
      disarm("EMERGENCY STOP PRESSED");
      playTone(400, 300);
    }
  } else {
    // 2. 底部 Dock 切换分页 (Y: 195 ~ 240, 扩大热区覆盖所有角落)
    if (touch.wasPressed() && touch.y >= 195) {
      int clickedTab = touch.x / 64;
      if (clickedTab >= 0 && clickedTab < 5 && (AppTab)clickedTab != state.currentTab) {
        state.currentTab = (AppTab)clickedTab;
        playTone(1400 + clickedTab * 120, 30);
        state.needFullRedraw = true;
      }
    }

    // 3. 各分页触控事件处理
    // ============ Tab 0: 🎮 超级遥控器 (瞬发高灵敏触控) ============
    if (state.currentTab == TAB_REMOTE && touch.wasPressed() && touch.y >= 26 && touch.y < 195) {
      int x = touch.x;
      int y = touch.y;
      int cx = 95, cy = 112;
      int distSq = (x - cx) * (x - cx) + (y - cy) * (y - cy);

      // 左侧方向环与中心 OK 键 (外半径 72，内半径 28)
      if (distSq <= 28 * 28) {
        Keyboard.write(KEY_RETURN);
        playTone(1500, 40);
      } else if (distSq <= 72 * 72) {
        int dx = x - cx;
        int dy = y - cy;
        if (abs(dx) > abs(dy)) {
          if (dx > 0) doKeyDirection(KEY_RIGHT_ARROW);
          else        doKeyDirection(KEY_LEFT_ARROW);
        } else {
          if (dy > 0) doKeyDirection(KEY_DOWN_ARROW);
          else        doKeyDirection(KEY_UP_ARROW);
        }
      }
      // 右侧功能键区
      else if (x >= 175) {
        if (y >= 30 && y <= 75) {
          if (x <= 244) doBack();
          else          doHome();
        }
        else if (y >= 76 && y <= 122) {
          if (x <= 244) {
            sendMouseClickCombo(MOUSE_LEFT, 0x01);
            playTone(1200, 25);
          } else {
            sendMouseClickCombo(MOUSE_RIGHT, 0x02);
            playTone(1600, 30);
          }
        }
        else if (y >= 123 && y <= 195) {
          if (x <= 224)      doVolumeDown();
          else if (x <= 270) doPlayPause();
          else               doVolumeUp();
        }
      }
    }

    // ============ Tab 1: ⚡ 生产力工作台 (零死角大热区判定) ============
    else if (state.currentTab == TAB_WORKSPACE && touch.wasPressed() && touch.y >= 26 && touch.y < 195) {
      int x = touch.x;
      int y = touch.y;

      // 行 1 (Y: 26 ~ 74)
      if (y >= 26 && y <= 74) {
        if (x <= 80)        doAppSwitch();
        else if (x <= 158)  doTaskView();
        else if (x <= 236) {
          if (state.osMode == OS_MACOS) {
            sendKeyCombo(KEY_LEFT_GUI, ' ', KEY_BLE_GUI, HID_KEY_SPACE);
          } else {
            sendKeyCombo(KEY_LEFT_GUI, '1', KEY_BLE_GUI, 0x1E);
          }
          playTone(1200, 35);
        }
        else {
          if (state.osMode == OS_MACOS) doAppSwitch();
          else {
            sendKeyCombo(KEY_LEFT_GUI, '2', KEY_BLE_GUI, 0x1F);
          }
          playTone(1300, 35);
        }
      }
      // 行 2 (Y: 75 ~ 122)
      else if (y >= 75 && y <= 122) {
        if (x <= 80)        doPrevTab();
        else if (x <= 158)  doNextTab();
        else if (x <= 236)  doCloseTab();
        else {
          sendKeyCombo(getModKey(), 't', getBleModKey(), 0x17);
          playTone(1100, 35);
        }
      }
      // 行 3 (Y: 123 ~ 195, 左下角大号 SEND 键占宽 X: 0 ~ 114)
      else if (y >= 123 && y <= 195) {
        if (x <= 114)  doSendEnter(); // 左下角整个区域无论是碰左侧边缘还是中间，100% 触发发送
        else if (x <= 212) {
          if (y <= 158) doSendCtrlEnter();
          else          doShiftEnter();
        }
        else if (x <= 264) doPaste();
        else               doCopy();
      }
    }

    // ============ Tab 2: 🖱️ 丝滑触控板 (指哪儿打哪儿 + 左右键无死角) ============
    else if (state.currentTab == TAB_TRACKPAD) {
      // 1. 底部两大实体级按键 (X: 8..156 为左键, X: 164..312 为右键, Y: 150..198)
      if (touch.wasPressed() && touch.y >= 150 && touch.y <= 200) {
        if (touch.x <= 160) {
          sendMouseClickCombo(MOUSE_LEFT, 0x01);
          playTone(1200, 25);
        } else {
          sendMouseClickCombo(MOUSE_RIGHT, 0x02);
          playTone(1600, 30);
        }
      }
      // 2. 右侧垂直平滑滚轮专属滑道 (X: 258 ~ 316, Y: 28 ~ 150)
      else if (touch.x >= 258 && touch.y >= 28 && touch.y <= 150) {
        if (touch.wasPressed()) {
          state.lastTouchY = touch.y;
        } else if (touch.isPressed()) {
          int dy = touch.y - state.lastTouchY;
          if (abs(dy) >= 4) {
            int wheelDelta = (dy > 0) ? -1 : 1;
            sendMouseMoveCombo(0, 0, wheelDelta);
            playTone(dy > 0 ? 1000 : 1400, 15);
            state.lastTouchY = touch.y;
          }
        }
      }
      // 3. 高精度弹道触控感应区 (X: 0 ~ 257, Y: 28 ~ 150)
      else if (touch.y >= 28 && touch.y <= 150) {
        if (touch.wasPressed()) {
          state.isDragging = true;
          state.lastTouchX = touch.x;
          state.lastTouchY = touch.y;
          state.subpixelX = 0.0f;
          state.subpixelY = 0.0f;
          state.touchStartTime = now;
          state.touchStartOriginX = touch.x;
          state.touchStartOriginY = touch.y;
          state.rightClickTriggered = false;
        } else if (touch.isPressed() && state.isDragging) {
          // 原地长按 (> 450ms 且位移小于 6px) 触发右键菜单
          int totalShift = abs(touch.x - state.touchStartOriginX) + abs(touch.y - state.touchStartOriginY);
          if (!state.rightClickTriggered && totalShift < 6 && (now - state.touchStartTime > 450)) {
            sendMouseClickCombo(MOUSE_RIGHT, 0x02);
            playTone(1700, 40);
            state.rightClickTriggered = true;
          }

          // 瞬时零延迟弹道动力学移动 (指哪儿打哪儿)
          float rawDx = (float)(touch.x - state.lastTouchX);
          float rawDy = (float)(touch.y - state.lastTouchY);

          if (rawDx != 0.0f || rawDy != 0.0f) {
            float speed = sqrtf(rawDx * rawDx + rawDy * rawDy);

            // 智能弹道加速度曲线：慢速 1.0x 像素微操，高速 2.6x 甩屏
            float accel = 1.0f;
            if (speed >= 10.0f) accel = 2.6f;
            else if (speed >= 3.0f) accel = 1.0f + (speed - 3.0f) * 0.22f;

            state.subpixelX += rawDx * accel;
            state.subpixelY += rawDy * accel;

            int moveX = (int)state.subpixelX;
            int moveY = (int)state.subpixelY;
            state.subpixelX -= (float)moveX;
            state.subpixelY -= (float)moveY;

            if (moveX != 0 || moveY != 0) {
              sendMouseMoveCombo(moveX, moveY, 0);
              state.lastTouchX = touch.x;
              state.lastTouchY = touch.y;
            }
          }
        }

        if (touch.wasReleased()) {
          state.isDragging = false;
          int totalDist = abs(touch.x - state.touchStartOriginX) + abs(touch.y - state.touchStartOriginY);
          if (!state.rightClickTriggered && (now - state.touchStartTime < 220) && totalDist < 8) {
            sendMouseClickCombo(MOUSE_LEFT, 0x01);
            playTone(1100, 20);
          }
        }
      }
    }

    // ============ Tab 3: 语音输入 ============
    else if (state.currentTab == TAB_AI_BUDDY) {
      if (touch.wasClicked() && touch.y >= 150 && touch.y <= 200) {
        // 中间大按键：点击开启录音 / 再次点击完成发送
        if (touch.x >= 98 && touch.x <= 222) {
          if (!state.isRecordingVoice) {
            startVoiceRecording();
          } else {
            stopVoiceRecording();
          }
        } else if (touch.x >= 8 && touch.x <= 96) {
          if (state.isRecordingVoice) stopVoiceRecording();
          sendKeyCombo(0, 'y', 0, 0x1C); delay(15);
          sendKeyCombo(0, KEY_RETURN, 0, HID_KEY_RETURN);
          playTone(1200, 80);
        } else if (touch.x >= 224 && touch.x <= 312) {
          if (state.isRecordingVoice) stopVoiceRecording();
          sendKeyCombo(0, KEY_ESC, 0, HID_KEY_ESCAPE); delay(10);
          sendKeyCombo(KEY_LEFT_CTRL, 'c', KEY_BLE_CTRL, 0x06);
          playTone(400, 150);
        }
      }
    }

    // ============ Tab 4: 📶 设置与跨平台模式切换 ============
    else if (state.currentTab == TAB_SETTINGS && touch.wasClicked()) {
      if (touch.y >= 50 && touch.y <= 88) {
        if (touch.x >= 85 && touch.x <= 190) {
          state.osMode = OS_WINDOWS;
          playTone(1100, 30);
          state.needFullRedraw = true;
        } else if (touch.x >= 200 && touch.x <= 305) {
          state.osMode = OS_MACOS;
          playTone(1400, 30);
          state.needFullRedraw = true;
        }
      }
      else if (touch.y >= 92 && touch.y <= 134 && touch.x >= 200 && touch.x <= 305) {
        playTone(1200, 40);
        SmartWiFi.connect(5000);
        state.needFullRedraw = true;
      }
      else if (touch.y >= 144 && touch.y <= 190) {
        if (touch.x >= 15 && touch.x <= 150) {
          state.brightness = min(255, state.brightness + 30);
          M5.Display.setBrightness(state.brightness);
          playTone(1400, 30);
        } else if (touch.x >= 170 && touch.x <= 305) {
          state.brightness = max(30, state.brightness - 30);
          M5.Display.setBrightness(state.brightness);
          playTone(800, 30);
        }
      }
    }
  }

  // 4. 定期检查电量、蓝牙与网络状态变动 (按需局部刷新顶栏)
  if (now - state.lastStatusCheckTime > 2000) {
    state.lastStatusCheckTime = now;
    bool curBle = BleCombo.isConnected();
    bool curWifi = SmartWiFi.isConnected();
    int curBat = M5.Power.getBatteryLevel();
    if (curBat > 100) curBat = 100;

    if (curBle != state.lastBleConnected || curWifi != state.lastWifiConnected || abs(curBat - state.lastBatteryPercent) >= 5) {
      state.lastBleConnected = curBle;
      state.lastWifiConnected = curWifi;
      state.lastBatteryPercent = curBat;
      if (!state.armed) {
        M5.Display.startWrite();
        drawTopBar();
        M5.Display.endWrite();
      }
    }
  }

  // 5. 录音处理与 60 秒防遗忘自动停止
  if (state.isRecordingVoice) {
    processMicrophone();
    if (now - state.recordingStartTime > 60000) {
      stopVoiceRecording();
    }
  }

  // 5. 眼睛动画 (仅在 TAB_AI_BUDDY 局部更新眼睛，绝不重刷全屏)
  if (!state.armed && state.currentTab == TAB_AI_BUDDY && !state.isRecordingVoice) {
    if (now - lastEyeUpdateTime > 80) {
      lastEyeUpdateTime = now;
      if (state.emotion == EMOTION_IDLE) {
        if (now > nextBlinkTime) {
          eyeBlinkState = (eyeBlinkState + 1) % 3;
          nextBlinkTime = (eyeBlinkState == 0) ? now + random(2500, 5000) : now + 60;
          M5.Display.startWrite();
          drawEyesLocal(160, 75, state.emotion, eyeBlinkState);
          M5.Display.endWrite();
        }
        if (now > nextLookTime) {
          eyeLookOffset = random(-14, 15);
          nextLookTime = now + random(3000, 6000);
          M5.Display.startWrite();
          drawEyesLocal(160, 75, state.emotion, eyeBlinkState);
          M5.Display.endWrite();
        }
      }
    }
  }

  // 6. 租约检查
  if (state.armed && now > state.leaseExpireAt) {
    disarm("Heartbeat Timeout");
  }

  // 7. 串口指令接收
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

  // 8. 零闪烁按需屏幕刷新
  renderDisplay();
}
