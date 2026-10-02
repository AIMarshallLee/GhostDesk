#include <Arduino.h>
#include <M5Unified.h>
#include <Preferences.h>
#include <esp_mac.h>
#include "BleCombo.h"

// 协议与固件常量
#define PROTOCOL_VERSION 4
#define FIRMWARE_VERSION "1.3.0"
#define BOARD_NAME "m5stack-cores3"

// 多设备切换枚举 (Marshall, AiMarshall, MacMini, MacPro)
enum BleDeviceChannel {
  DEVICE_MARSHALL   = 0, // Marshall: 当前电脑 (Win 1)
  DEVICE_AIMARSHALL = 1, // AiMarshall: 备用电脑 (Win 2)
  DEVICE_MACMINI    = 2, // MacMini: Mac Mini (Mac 1)
  DEVICE_MACPRO     = 3  // MacPro: MacBook Pro 2015 (Mac 2)
};
#define TOTAL_DEVICES 4
uint8_t currentDevice = 0;

static const char* devLabels[] = {"Marshall", "AiMarshall", "MacMini", "MacPro"};
static const char* bleNames[]  = {"FlowDesk Marshall", "FlowDesk AiMarshall", "FlowDesk MacMini", "FlowDesk MacPro"};
static const char* devToastNames[] = {
  "切换设备: Marshall (当前电脑)",
  "切换设备: AiMarshall (备用电脑)",
  "切换设备: MacMini",
  "切换设备: MacPro (MacBook Pro)"
};
static const char* devGreetingNames[] = {
  "已就绪: Marshall (当前电脑)",
  "已就绪: AiMarshall (备用电脑)",
  "已就绪: MacMini",
  "已就绪: MacPro (MacBook Pro)"
};

inline bool isMacDevice(uint8_t dev) {
  return (dev == DEVICE_MACMINI || dev == DEVICE_MACPRO);
}

// PSRAM 双缓冲画布 (320x240，零闪烁高帧率)
static M5Canvas canvas(&M5.Display);

// UI 风格枚举 (用户随时双击屏幕切换)
enum UIStyle {
  STYLE_APPLE_SIRI = 0,   // 苹果极简 Siri 灵动光晕风
  STYLE_APPLE_PET = 1,    // 苹果 Memoji 灵动萌宠风
  TOTAL_STYLES = 2
};
UIStyle currentStyle = STYLE_APPLE_SIRI;

// 设备工作模式 (三大独立 Tab 选项卡)
enum DeviceMode {
  MODE_CORES3_MIC = 0,  // Tab 1: 云端语音 (CoreS3 硬件双麦 + 豆包 ASR)
  MODE_BLE_REMOTE = 1,  // Tab 2: 电脑遥控 (右Alt 触发电脑输入法 + 回车)
  MODE_PAGE_FLIP  = 2   // Tab 3: 翻页遥控 (PPT / 文档 上下翻页演讲遥控器)
};
DeviceMode currentMode = MODE_CORES3_MIC;

// 运行状态
enum BuddyEmotion {
  EMOTION_IDLE,
  EMOTION_RECORDING,
  EMOTION_THINKING,
  EMOTION_HAPPY,
  EMOTION_WORRIED
};

struct SystemState {
  BuddyEmotion emotion = EMOTION_IDLE;
  String statusMsg = "";
  uint32_t emotionUntil = 0;
  bool isRecordingVoice = false;
  uint32_t recordingStartTime = 0;
  bool isBleVoiceActive = false;     // 模式2：输入法语音是否已开启
  uint32_t bleVoiceStartTime = 0;    // 模式2：语音开启时间戳
  uint32_t pendingReturnTime = 0;    // 延时回车计时器 (豆包 AI 整理转写专用延时)
  uint8_t sentNoticeState = 0;       // 0=无, 1=成功(绿), 2=失败(红)
  uint32_t sentNoticeUntil = 0;      // 提示框显示倒计时
  uint32_t cmdEnterSentTime = 0;     // 发送指令时间戳
  uint32_t btnCancelHighlightUntil = 0; // 取消按钮瞬时高亮时间戳
  uint32_t btnSendHighlightUntil = 0;   // 发送按钮瞬时高亮时间戳
  uint32_t btnPageUpHighlightUntil = 0; // 上一页按键瞬时高亮时间戳
  uint32_t btnPageDownHighlightUntil = 0; // 下一页按键瞬时高亮时间戳
  uint32_t lastUserActionTime = 0;      // 最后一次用户触控操作时间
  bool isDimmed = false;                // 是否处于低功耗微暗屏状态
  bool isSelectingDevice = false;       // 是否正在显示「4台设备选择菜单」弹窗
  int brightness = 190;
  volatile int liveVoiceLevel = 0; // 实时声学反馈 0~40
  
  // 触控手势跟踪
  int touchStartX = 0;
  int touchStartY = 0;
  uint32_t lastTouchReleaseTime = 0;
  bool swipeHandled = false;
  bool wasTouching = false;

  // 滑动提示浮窗
  String toastMsg = "";
  uint32_t toastUntil = 0;

  // 电池电量非阻塞缓存 (避免频繁访问 I2C 锁死触控总线)
  int cachedBattery = 100;
  uint32_t lastBatteryCheck = 0;
} state;

// 萌宠动画变量
int eyeBlinkState = 0;
uint32_t nextBlinkTime = 0;
int eyeLookOffsetX = 0;
int eyeLookOffsetY = 0;
uint32_t nextLookTime = 0;
String inputBuffer = "";

void showToast(const String& msg, uint32_t durationMs = 1500) {
  state.toastMsg = msg;
  state.toastUntil = millis() + durationMs;
}

void setEmotion(BuddyEmotion emo, const String& msg, uint32_t durationMs = 3000) {
  state.emotion = emo;
  state.statusMsg = msg;
  state.emotionUntil = (durationMs > 0) ? millis() + durationMs : 0;
}

void renderScreen();

void switchDeviceChannel(uint8_t targetDevice) {
  targetDevice = targetDevice % TOTAL_DEVICES;
  Preferences p;
  p.begin("flowdesk", false);
  p.putUChar("device", targetDevice);
  p.end();

  showToast(devToastNames[targetDevice], 2500);
  renderScreen();
  delay(500);
  esp_restart();
}

// ==========================================
// 风格 1：Apple 极简水波涟漪 (根据实时声波动态跳动)
// ==========================================
static float rippleR[3] = {16.0f, 42.0f, 68.0f};

void drawAppleWaterRipples(int cx, int cy, uint32_t now) {
  bool isActive = state.isRecordingVoice || state.isBleVoiceActive;
  if (isActive) {
    int voiceBoost = state.liveVoiceLevel;
    if (voiceBoost > 35) voiceBoost = 35;
    if (state.isBleVoiceActive && voiceBoost < 14) voiceBoost = 14;

    // 1. 录音状态：极光天青动态纯净水波，随说话音量向外律动扩散
    for (int i = 0; i < 3; ++i) {
      rippleR[i] += 1.8f + (voiceBoost * 0.12f);
      if (rippleR[i] > 92.0f) rippleR[i] = 16.0f;

      float r = rippleR[i];
      float fade = (92.0f - r) / (92.0f - 16.0f);
      uint16_t rippleColor = (fade > 0.60f) ? 0x07FF : ((fade > 0.30f) ? 0x04DF : 0x0256);

      canvas.drawCircle(cx, cy, (int)r, rippleColor);
      if (r > 26.0f) {
        canvas.drawCircle(cx, cy, (int)r + 1, rippleColor);
      }
    }

    // 中央晶莹水滴：呼吸脉动 + 随说话声音真实物理震颤！
    int coreR = 15 + (voiceBoost / 2);
    int pulse = (int)(sin(now * 0.018f) * 4.0f + 4.0f);
    coreR += pulse;

    canvas.fillCircle(cx, cy, coreR + 5, 0x0317);
    canvas.fillCircle(cx, cy, coreR + 2, 0x05BF);
    canvas.fillCircle(cx, cy, coreR, 0x07FF);
    canvas.fillCircle(cx, cy, coreR - 6, TFT_WHITE);
  } else if (state.pendingReturnTime > 0) {
    // 3. 倒计时状态：静美暖金色水滴 + 倒计时文字
    uint32_t remainMs = (state.pendingReturnTime > now) ? (state.pendingReturnTime - now) : 0;
    float remainSec = (float)remainMs / 1000.0f;

    canvas.drawCircle(cx, cy, 34, 0x62A0);
    canvas.drawCircle(cx, cy, 66, 0x3180);

    int coreR = 15;
    canvas.fillCircle(cx, cy, coreR + 4, 0x4200);
    canvas.fillCircle(cx, cy, coreR, 0xFD20);
    canvas.fillCircle(cx, cy, coreR - 5, TFT_WHITE);

    // 水滴下方精致文字
    canvas.setTextColor(0xFD20);
    canvas.drawCenterString("倒计时 " + String(remainSec, 1) + "s 自动发送", cx, cy + 38);
  } else {
    // 2. 待命/停止状态：完全平静的镜面湖水水滴 (用户赞赏的优美水纹)
    canvas.drawCircle(cx, cy, 34, 0x0256);
    canvas.drawCircle(cx, cy, 66, 0x018F);

    int coreR = 15;
    canvas.fillCircle(cx, cy, coreR + 4, 0x01EF);
    canvas.fillCircle(cx, cy, coreR, 0x04DF);
    canvas.fillCircle(cx, cy, coreR - 5, 0xDEFF);
  }
}

// ==========================================
// 经典黑白麦克风 + 向外发放射频声波 (极简、灵动、高对比度，统一云端与遥控)
// ==========================================
static float micWaveR[3] = {32.0f, 52.0f, 72.0f};

void drawClassicMicrophone(int cx, int cy, uint32_t now) {
  // cy 约为 110 (上方 Tab 高 54，下方按钮在 155 之后，中心点在 110-112)
  bool isActive = (currentMode == MODE_CORES3_MIC) ? state.isRecordingVoice : state.isBleVoiceActive;

  // 1. 如果正在语音输入，绘制向外辐射扩散的声波弧线 ((( 🎙️ )))
  if (isActive) {
    for (int i = 0; i < 3; ++i) {
      micWaveR[i] += 1.8f;
      if (micWaveR[i] > 84.0f) micWaveR[i] = 30.0f;

      float r = micWaveR[i];
      // 计算左右声波弧线 (平滑向外扩散)
      uint16_t waveColor = TFT_WHITE;
      if (r > 68.0f) waveColor = 0x9CD3; // 边缘轻微淡出灰白
      else if (r > 50.0f) waveColor = 0xC618;

      canvas.drawArc(cx, cy, (int)r, (int)r - 2, 135, 225, waveColor);
      canvas.drawArc(cx, cy, (int)r, (int)r - 2, 315, 45, waveColor);
    }
  }

  // 2. 绘制麦克风核心主体 (经典复古胶囊广播麦)
  int micW = 26;
  int micH = 38;
  int micY = cy - 20;

  // 麦克风胶囊外壳 (纯白)
  canvas.fillRoundRect(cx - micW / 2, micY, micW, micH, 13, TFT_WHITE);

  // 麦克风顶部进音孔网格 (纯黑水平条纹)
  int grillStartY = micY + 6;
  for (int g = 0; g < 4; ++g) {
    canvas.drawFastHLine(cx - 8, grillStartY + g * 5, 17, TFT_BLACK);
  }

  // 胶囊中间金属腰线 (纯黑)
  canvas.drawFastHLine(cx - 11, micY + 23, 23, TFT_BLACK);

  // 3. 麦克风 U 型环绕支架与底座 (纯白线条)
  // U 型托架：围绕麦克风下方
  canvas.drawArc(cx, micY + 22, 20, 18, 90, 270, TFT_WHITE);

  // 垂直支柱
  canvas.fillRect(cx - 2, micY + 42, 5, 12, TFT_WHITE);

  // 稳固底座横条
  canvas.fillRoundRect(cx - 18, micY + 54, 37, 4, 2, TFT_WHITE);

  // 4. 下方状态文字提示
  canvas.setTextSize(1);
  if (isActive) {
    canvas.setTextColor(TFT_WHITE);
    if (currentMode == MODE_CORES3_MIC) {
      uint32_t sec = (now - state.recordingStartTime) / 1000;
      canvas.drawCenterString("云端录音中 " + String(sec) + "s", cx, cy + 38);
    } else {
      canvas.drawCenterString("正在录音 - 点击停止", cx, cy + 38);
    }
  } else if (state.pendingReturnTime > 0) {
    uint32_t remainMs = (state.pendingReturnTime > now) ? (state.pendingReturnTime - now) : 0;
    float remainSec = (float)remainMs / 1000.0f;
    canvas.setTextColor(0xFFE0); // 暖金倒计时提示
    canvas.drawCenterString("整理中 " + String(remainSec, 1) + "s - 点击发送", cx, cy + 38);
  } else {
    canvas.setTextColor(0x9CD3); // 柔和灰白
    if (currentMode == MODE_CORES3_MIC) {
      canvas.drawCenterString("轻触中间开启云端识别", cx, cy + 38);
    } else {
      canvas.drawCenterString("轻触中间开启输入", cx, cy + 38);
    }
  }
}

// ==========================================
// 风格 2：Apple Memoji 灵动卡哇伊萌宠
// ==========================================
void drawAppleCutePet(int cx, int cy, BuddyEmotion emotion, int blink) {
  int eyeW = 44;
  int eyeH = 52;
  int spacing = 46;

  int leftX = cx - spacing - eyeW / 2 + eyeLookOffsetX;
  int rightX = cx + spacing - eyeW / 2 + eyeLookOffsetX;
  int curY = cy + eyeLookOffsetY;

  uint16_t eyeColor = 0x07FF; // 科技明青
  if (emotion == EMOTION_THINKING) eyeColor = 0xFDE0; // 暖金
  if (emotion == EMOTION_HAPPY)    eyeColor = 0x07E0; // 翠绿
  if (emotion == EMOTION_WORRIED)  eyeColor = 0xF880; // 警戒红

  if (emotion == EMOTION_HAPPY) {
    canvas.fillRoundRect(leftX, curY - 6, eyeW, 14, 7, eyeColor);
    canvas.fillRoundRect(rightX, curY - 6, eyeW, 14, 7, eyeColor);
    canvas.fillCircle(leftX + eyeW / 2, curY - 14, 15, eyeColor);
    canvas.fillCircle(rightX + eyeW / 2, curY - 14, 15, eyeColor);
    canvas.fillCircle(leftX + eyeW / 2, curY - 7, 14, TFT_BLACK);
    canvas.fillCircle(rightX + eyeW / 2, curY - 7, 14, TFT_BLACK);
    return;
  }

  int currentH = eyeH;
  if (blink == 1) currentH = 14;
  if (blink == 2) currentH = 4;

  int drawY = curY - currentH / 2;
  canvas.fillRoundRect(leftX, drawY, eyeW, currentH, 16, eyeColor);
  canvas.fillRoundRect(rightX, drawY, eyeW, currentH, 16, eyeColor);

  if (currentH > 24) {
    canvas.fillCircle(leftX + eyeW - 13, drawY + 13, 6, TFT_WHITE);
    canvas.fillCircle(rightX + eyeW - 13, drawY + 13, 6, TFT_WHITE);
    canvas.fillCircle(leftX + 14, drawY + currentH - 14, 3, TFT_WHITE);
    canvas.fillCircle(rightX + 14, drawY + currentH - 14, 3, TFT_WHITE);
  }
}

// ==========================================
// 顶栏：两大功能主 Tab [云端语音 / 电脑遥控] [翻页] + 设备名徽标 + 苹果风竖直微电量柱
// ==========================================
void drawDynamicIsland() {
  // ── Tab 1: 语音/遥控功能主 Tab (X: 8, Y: 6, 宽 112, 高 38, R: 8) ──
  // 支持 450ms 内双击直接在「云端语音」和「电脑遥控」之间平滑切换！
  if (currentMode == MODE_CORES3_MIC) {
    canvas.fillRoundRect(8, 6, 112, 38, 8, 0x0317);
    canvas.drawRoundRect(8, 6, 112, 38, 8, 0x07FF);
    canvas.setTextColor(TFT_WHITE);
    canvas.setTextSize(1);
    canvas.drawCenterString("云端语音", 64, 18);
  } else if (currentMode == MODE_BLE_REMOTE) {
    canvas.fillRoundRect(8, 6, 112, 38, 8, 0x39C0);
    canvas.drawRoundRect(8, 6, 112, 38, 8, 0xFFE0);
    canvas.setTextColor(TFT_WHITE);
    canvas.setTextSize(1);
    canvas.drawCenterString("电脑遥控", 64, 18);
  } else {
    // 当前处于翻页模式：显示未选中样式
    canvas.fillRoundRect(8, 6, 112, 38, 8, 0x18C3);
    canvas.drawRoundRect(8, 6, 112, 38, 8, 0x3186);
    canvas.setTextColor(0x7BEF);
    canvas.setTextSize(1);
    canvas.drawCenterString("云端语音", 64, 18);
  }

  // ── Tab 2: 翻页功能主 Tab (X: 126, Y: 6, 宽 76, 高 38, R: 8) ──
  if (currentMode == MODE_PAGE_FLIP) {
    canvas.fillRoundRect(126, 6, 76, 38, 8, 0x0320);
    canvas.drawRoundRect(126, 6, 76, 38, 8, 0x07E0);
    canvas.setTextColor(TFT_WHITE);
  } else {
    canvas.fillRoundRect(126, 6, 76, 38, 8, 0x18C3);
    canvas.drawRoundRect(126, 6, 76, 38, 8, 0x3186);
    canvas.setTextColor(0x7BEF);
  }
  canvas.setTextSize(1);
  canvas.drawCenterString("翻页", 164, 18);

  // ── 状态区：设备名精致徽标胶囊 (X: 208, Y: 10, 宽 82, 高 30, R: 6) ──
  // 独立显示当前连接设备名（如 Marshall），且用户轻触直接弹出设备选择菜单
  bool bleConnected = BleCombo.isConnected();
  canvas.fillRoundRect(208, 10, 82, 30, 6, 0x10A3);
  canvas.drawRoundRect(208, 10, 82, 30, 6, bleConnected ? 0x07FF : 0x52AA);
  canvas.setTextColor(bleConnected ? 0x07FF : 0xD69A);
  canvas.setTextSize(1);
  canvas.drawCenterString(devLabels[currentDevice], 249, 18);

  // 蓝牙状态极简微指示点 (X: 297, Y: 25, 直径 4px)
  if (bleConnected) {
    canvas.fillCircle(297, 25, 2, 0x07FF); // 已连接：稳定常亮纯净科技青
  } else {
    // 未连接：微弱柔和呼吸闪烁 (周期 1000ms)
    uint32_t phase = millis() % 1000;
    if (phase < 500) {
      canvas.fillCircle(297, 25, 2, 0x0256); // 柔和深蓝
    }
  }

  // 右侧边缘：苹果风竖直微电量柱 (X: 305 ~ 316, 宽 11, 高 36)
  int bat = state.cachedBattery;
  if (bat < 0) bat = 0;
  if (bat > 100) bat = 100;
  int fillH = (bat * 30) / 100;
  if (fillH < 2 && bat > 0) fillH = 2;

  uint16_t batColor = 0x07E0; // >= 80% 纯正绿色
  if (bat < 40) {
    batColor = 0xF800;        // < 40% 红色预警
  } else if (bat < 80) {
    batColor = 0xFFE0;        // 40% ~ 79% 苹果标准暖黄
  }
  if (M5.Power.isCharging()) batColor = 0x07E0;

  // 电池正极小凸起
  canvas.fillRect(308, 5, 5, 2, 0x52AA);
  // 电池外壳
  canvas.drawRoundRect(305, 7, 11, 36, 3, 0x52AA);
  // 内部电量柱 (由底往上填充)
  if (fillH > 0) {
    canvas.fillRect(307, 40 - fillH, 7, fillH, batColor);
  }
}

// ==========================================
// 底栏：极简状态与功能按钮
// ==========================================
void drawBottomActionBar() {
  uint32_t now = millis();

  // 1. 左侧发送成功/失败指示框 (严谨机制：仅在 PC 回执确切送达时提示，绝无虚假提示)
  if (now < state.sentNoticeUntil) {
    if (state.sentNoticeState == 1) {
      // 成功：翠绿长方形「✓ 已发送」
      canvas.fillRoundRect(8, 178, 112, 50, 8, 0x0320); // 墨绿色卡片背景
      canvas.drawRoundRect(8, 178, 112, 50, 8, 0x07E0); // 翠绿醒目边框
      canvas.setTextColor(0x07E0);
      canvas.setTextSize(1);
      canvas.drawCenterString("✓ 已发送", 64, 195);
    } else if (state.sentNoticeState == 2) {
      // 失败：朱红长方形「✕ 未发送」
      canvas.fillRoundRect(8, 178, 112, 50, 8, 0x4000); // 暗红底
      canvas.drawRoundRect(8, 178, 112, 50, 8, 0xF800); // 亮红边框
      canvas.setTextColor(0xF800);
      canvas.setTextSize(1);
      canvas.drawCenterString("✕ 未发送", 64, 195);
    }
  }

  // 2. 模式专属底栏 (常态为极简纯粹的高级深灰，与未选中的顶栏一致；点击瞬间高亮变色反馈！)
  bool isCancelPressed = (now < state.btnCancelHighlightUntil);
  bool isSendPressed   = (now < state.btnSendHighlightUntil);

  // 取消按键颜色：平时高级暗灰 0x18C3 + 灰边 0x3186；点击瞬间高亮暖红 0x3800 + 亮红框 0xF980
  uint16_t cancelBgColor   = isCancelPressed ? 0x3800 : 0x18C3;
  uint16_t cancelBorderColor = isCancelPressed ? 0xF980 : 0x3186;
  uint16_t cancelTextColor = isCancelPressed ? TFT_WHITE : 0x7BEF;

  // 发送按键颜色：平时高级暗灰 0x18C3 + 灰边 0x3186；点击瞬间高亮翠绿 0x0320 + 亮绿框 0x07E0
  uint16_t sendBgColor     = isSendPressed ? 0x0320 : 0x18C3;
  uint16_t sendBorderColor = isSendPressed ? 0x07E0 : 0x3186;
  uint16_t sendTextColor   = isSendPressed ? TFT_WHITE : 0x7BEF;

  if (currentMode == MODE_CORES3_MIC) {
    // ── Tab 1: 云端语音底栏 ──
    // 左下角：【取消】按钮 (与上方左侧 Tab 严格对齐：X: 8, Y: 195, 宽 112, 高 40)
    canvas.fillRoundRect(8, 195, 112, 40, 8, cancelBgColor);
    canvas.drawRoundRect(8, 195, 112, 40, 8, cancelBorderColor);
    canvas.setTextColor(cancelTextColor);
    canvas.setTextSize(1);
    canvas.drawCenterString("取消", 64, 208);

    // 右下角：【完成】发送按钮 (与左侧对称：X: 200, Y: 195, 宽 112, 高 40)
    canvas.fillRoundRect(200, 195, 112, 40, 8, sendBgColor);
    canvas.drawRoundRect(200, 195, 112, 40, 8, sendBorderColor);
    canvas.setTextColor(sendTextColor);
    canvas.setTextSize(1);
    if (state.isRecordingVoice) {
      uint32_t sec = (millis() - state.recordingStartTime) / 1000;
      canvas.drawCenterString("完成 " + String(sec) + "s", 256, 208);
    } else {
      canvas.drawCenterString("完成", 256, 208);
    }
  } else if (currentMode == MODE_BLE_REMOTE) {
    // ── Tab 2: 电脑遥控模式底栏 ──
    // 左下角：【取消】按钮 (X: 8, Y: 195, 宽 112, 高 40)
    canvas.fillRoundRect(8, 195, 112, 40, 8, cancelBgColor);
    canvas.drawRoundRect(8, 195, 112, 40, 8, cancelBorderColor);
    canvas.setTextColor(cancelTextColor);
    canvas.setTextSize(1);
    canvas.drawCenterString("取消", 64, 208);

    // 右下角：【发送】按钮 (X: 200, Y: 195, 宽 112, 高 40)
    canvas.fillRoundRect(200, 195, 112, 40, 8, sendBgColor);
    canvas.drawRoundRect(200, 195, 112, 40, 8, sendBorderColor);
    canvas.setTextColor(sendTextColor);
    canvas.setTextSize(1);
    canvas.drawCenterString("发送", 256, 208);
  }
}

// ==========================================
// 4 台设备选择菜单 (卡片式触摸面板)
// ==========================================
void drawDeviceSelectorModal() {
  canvas.fillScreen(TFT_BLACK);

  // 1. 顶部标题栏 (Y: 6 ~ 34)
  canvas.setTextColor(TFT_WHITE);
  canvas.setTextSize(1);
  canvas.drawString("请选择要连接的设备", 14, 12);

  // 右上角【返回】按钮 (X: 248, Y: 6, W: 58, H: 26, R: 6)
  canvas.fillRoundRect(248, 6, 58, 26, 6, 0x18C3);
  canvas.drawRoundRect(248, 6, 58, 26, 6, 0x52AA);
  canvas.setTextColor(0xD69A);
  canvas.drawCenterString("返回", 277, 12);

  // 2. 4 个设备大卡片 (2x2 布局，超大触控面积，手指秒点)
  const int cardX[4] = {14, 166, 14, 166};
  const int cardY[4] = {38, 38, 134, 134};
  const int cardW = 140;
  const int cardH = 88;

  const char* descs[4] = {"当前电脑", "备用电脑", "Mac Mini", "MacBook Pro"};

  for (int i = 0; i < TOTAL_DEVICES; ++i) {
    bool isCurrent = (currentDevice == i);
    uint16_t bgColor     = isCurrent ? 0x0270 : 0x18C3;
    uint16_t borderColor = isCurrent ? 0x07FF : 0x3186;
    uint16_t titleColor   = isCurrent ? 0x07FF : TFT_WHITE;
    uint16_t descColor    = isCurrent ? TFT_WHITE : 0x9CD3;

    canvas.fillRoundRect(cardX[i], cardY[i], cardW, cardH, 10, bgColor);
    canvas.drawRoundRect(cardX[i], cardY[i], cardW, cardH, 10, borderColor);

    // 主标题 (如 "Marshall", "AiMarshall", "MacMini", "MacPro")
    canvas.setTextColor(titleColor);
    if (strlen(devLabels[i]) >= 9) {
      canvas.setTextSize(1);
      canvas.drawString(devLabels[i], cardX[i] + 12, cardY[i] + 16);
    } else {
      canvas.setTextSize(2);
      canvas.drawString(devLabels[i], cardX[i] + 12, cardY[i] + 12);
    }

    // 描述 (如 "当前电脑", "Mac Mini")
    canvas.setTextColor(descColor);
    canvas.setTextSize(1);
    canvas.drawString(descs[i], cardX[i] + 12, cardY[i] + 40);

    // 状态小徽标
    if (isCurrent) {
      canvas.fillRoundRect(cardX[i] + 12, cardY[i] + 62, 70, 18, 4, 0x0320);
      canvas.setTextColor(0x07E0);
      canvas.drawString("已连接", cardX[i] + 22, cardY[i] + 65);
    } else {
      canvas.setTextColor(0x7BEF);
      canvas.drawString("轻触切换", cardX[i] + 12, cardY[i] + 65);
    }
  }

  // 3. 浮层 Toast (若有提示)
  uint32_t now = millis();
  if (now < state.toastUntil && state.toastMsg.length() > 0) {
    int tw = canvas.textWidth(state.toastMsg) + 24;
    int tx = (320 - tw) / 2;
    canvas.fillRoundRect(tx, 96, tw, 36, 18, 0x18C3);
    canvas.drawRoundRect(tx, 96, tw, 36, 18, 0x07FF);
    canvas.setTextColor(0x07FF);
    canvas.setTextSize(1);
    canvas.drawCenterString(state.toastMsg, 160, 108);
  }
}

// 刷新整屏 (通过 PSRAM 双缓冲渲染)
void renderScreen() {
  uint32_t now = millis();

  // 如果处于设备选择菜单弹窗，优先推画选择面板
  if (state.isSelectingDevice) {
    drawDeviceSelectorModal();
    canvas.pushSprite(0, 0);
    return;
  }

  canvas.fillScreen(TFT_BLACK);

  // 1. 顶栏选项卡 Tab
  drawDynamicIsland();

  // 2. 中央视觉主体
  if (currentMode == MODE_PAGE_FLIP) {
    // ── Tab 3: 翻页遥控模式 (两个巨大半屏轻触按键，演讲/PPT/文档秒翻) ──
    bool isPageUpPressed   = (now < state.btnPageUpHighlightUntil);
    bool isPageDownPressed = (now < state.btnPageDownHighlightUntil);

    uint16_t upBgColor     = isPageUpPressed ? 0x0270 : 0x18C3;
    uint16_t upBorderColor = isPageUpPressed ? 0x07FF : 0x3186;
    uint16_t upTextColor   = isPageUpPressed ? TFT_WHITE : 0x07FF;

    uint16_t downBgColor     = isPageDownPressed ? 0x0320 : 0x18C3;
    uint16_t downBorderColor = isPageDownPressed ? 0x07E0 : 0x3186;
    uint16_t downTextColor   = isPageDownPressed ? TFT_WHITE : 0x07E0;

    // 左半边：上一页 Page Up (X: 12 ~ 154, Y: 56 ~ 228)
    canvas.fillRoundRect(12, 56, 142, 172, 14, upBgColor);
    canvas.drawRoundRect(12, 56, 142, 172, 14, upBorderColor);
    canvas.setTextColor(upTextColor);
    canvas.setTextSize(2);
    canvas.drawCenterString("▲", 83, 110);
    canvas.setTextSize(1);
    canvas.drawCenterString("上一页", 83, 145);

    // 右半边：下一页 Page Down (X: 166 ~ 308, Y: 56 ~ 228)
    canvas.fillRoundRect(166, 56, 142, 172, 14, downBgColor);
    canvas.drawRoundRect(166, 56, 142, 172, 14, downBorderColor);
    canvas.setTextColor(downTextColor);
    canvas.setTextSize(2);
    canvas.drawCenterString("▼", 237, 110);
    canvas.setTextSize(1);
    canvas.drawCenterString("下一页", 237, 145);
  } else if (currentMode == MODE_BLE_REMOTE || currentMode == MODE_CORES3_MIC) {
    // ── Tab 1 & Tab 2: 经典黑白麦克风 + 声波辐射扩散 (统一极简、高对比度黑白声波) ──
    drawClassicMicrophone(160, 110, now);
  } else {
    drawAppleCutePet(160, 130, state.emotion, eyeBlinkState);
  }

  // 3. 底栏 (发送按钮 / 已发送提示 / 录音进度)
  drawBottomActionBar();

  // 4. 浮层 Toast (如长按广播配对提示)
  if (now < state.toastUntil && state.toastMsg.length() > 0) {
    int tw = canvas.textWidth(state.toastMsg) + 24;
    int tx = (320 - tw) / 2;
    canvas.fillRoundRect(tx, 96, tw, 36, 18, 0x18C3);
    canvas.drawRoundRect(tx, 96, tw, 36, 18, 0x07FF);
    canvas.setTextColor(0x07FF);
    canvas.setTextSize(1);
    canvas.drawCenterString(state.toastMsg, 160, 108);
  }

  // DMA 高速推入屏幕
  canvas.pushSprite(0, 0);
}

// ==========================================
// 录音流式传输任务 (FreeRTOS 独立运行在 Core 0，绝对不抢占 Core 1 的 UI 与触控)
// ==========================================
static TaskHandle_t audioTaskHandle = NULL;
static volatile bool isAudioStreaming = false;

void audioStreamTask(void* parameter) {
  static const size_t SAMPLES_PER_CHUNK = 128; // 128 采样点 = 8ms @ 16kHz
  static int16_t pcmBuffer[SAMPLES_PER_CHUNK];
  static const char hexChars[] = "0123456789abcdef";
  // "V:" + 128 samples * 2 bytes * 2 hex chars + "\n" + '\0' = 516 字节
  static char hexChunk[2 + SAMPLES_PER_CHUNK * 2 * 2 + 2];
  hexChunk[0] = 'V';
  hexChunk[1] = ':';

  while (true) {
    if (isAudioStreaming && M5.Mic.isEnabled()) {
      if (M5.Mic.record(pcmBuffer, SAMPLES_PER_CHUNK, 16000, false)) {
        while (isAudioStreaming && M5.Mic.isRecording()) {
          vTaskDelay(1 / portTICK_PERIOD_MS);
        }
        if (isAudioStreaming) {
          int maxAmp = 0;
          for (size_t i = 0; i < SAMPLES_PER_CHUNK; ++i) {
            int a = abs(pcmBuffer[i]);
            if (a > maxAmp) maxAmp = a;
          }
          state.liveVoiceLevel = maxAmp / 500;

          const uint8_t* rawBytes = (const uint8_t*)pcmBuffer;
          size_t outIdx = 2;
          for (size_t i = 0; i < SAMPLES_PER_CHUNK * 2; ++i) {
            uint8_t b = rawBytes[i];
            hexChunk[outIdx++] = hexChars[b >> 4];
            hexChunk[outIdx++] = hexChars[b & 0x0F];
          }
          hexChunk[outIdx++] = '\n';
          if (Serial) {
            Serial.write((const uint8_t*)hexChunk, outIdx);
          }
        }
      } else {
        vTaskDelay(2 / portTICK_PERIOD_MS);
      }
    } else {
      vTaskDelay(15 / portTICK_PERIOD_MS);
    }
  }
}

void startVoiceRecording() {
  if (state.isRecordingVoice) return;
  state.isRecordingVoice = true;
  state.recordingStartTime = millis();
  state.emotion = EMOTION_RECORDING;
  state.statusMsg = "正在倾听 • 再次轻触发送";

  Serial.println("VOICE_START");
  isAudioStreaming = true;
}

void stopVoiceRecording() {
  if (!state.isRecordingVoice) return;
  state.isRecordingVoice = false;
  isAudioStreaming = false;

  setEmotion(EMOTION_THINKING, "豆包大模型识别中...", 6000);
  Serial.println("VOICE_END");
}

void cancelVoiceRecording() {
  if (!state.isRecordingVoice) return;
  state.isRecordingVoice = false;
  isAudioStreaming = false;

  setEmotion(EMOTION_IDLE, "已取消", 1500);
  Serial.println("VOICE_CANCEL");
}

// 处理滑动手势 (快捷切换常用编程工具)
void handleSwipe(int dx, int dy) {
  String targetApp = "";
  if (abs(dx) > abs(dy)) {
    if (dx > 35) {
      targetApp = "terminal";
      showToast("➡️ 切换: 终端 Terminal", 1600);
    } else if (dx < -35) {
      targetApp = "vscode";
      showToast("⬅️ 切换: VS Code", 1600);
    }
  } else {
    if (dy < -30) {
      targetApp = "antigravity";
      showToast("⬆️ 切换: 反重力 Antigravity", 1600);
    } else if (dy > 30) {
      targetApp = "claude";
      showToast("⬇️ 切换: Claude Desktop", 1600);
    }
  }

  if (targetApp.length() > 0) {
    Serial.println("CMD:switch:" + targetApp);
    setEmotion(EMOTION_HAPPY, "应用已切换: " + targetApp, 2000);
  }
}

// 串口指令接收
void handleCommandLine(const String& line) {
  if (line.length() == 0) return;

  if (line == "NOTICE:SENT") {
    state.sentNoticeUntil = millis() + 1800;
    renderScreen();
    return;
  }

  if (line == "NOTICE:SENT") {
    state.sentNoticeState = 1; // 1 = 成功(绿)
    state.sentNoticeUntil = millis() + 1800;
    renderScreen();
    return;
  }

  if (line == "NOTICE:FAIL") {
    state.sentNoticeState = 2; // 2 = 失败(红)
    state.sentNoticeUntil = millis() + 1800;
    renderScreen();
    return;
  }

  if (line.startsWith("buddy\t")) {
    int idx1 = line.indexOf('\t');
    int idx2 = line.indexOf('\t', idx1 + 1);
    String subCmd = (idx2 != -1) ? line.substring(idx1 + 1, idx2) : line.substring(idx1 + 1);
    String msg = (idx2 != -1) ? line.substring(idx2 + 1) : "";

    if (subCmd == "thinking") {
      setEmotion(EMOTION_THINKING, msg.length() ? msg : "AI 正在思考中...", 10000);
    } else if (subCmd == "done" || subCmd == "success") {
      setEmotion(EMOTION_HAPPY, msg.length() ? msg : "任务完成！", 5000);
      state.sentNoticeState = 1;
      state.sentNoticeUntil = millis() + 1800; // 同步点亮「已发送」提示
    } else if (subCmd == "error" || subCmd == "fail") {
      setEmotion(EMOTION_WORRIED, msg.length() ? msg : "遇到报错", 5000);
      state.sentNoticeState = 2;
      state.sentNoticeUntil = millis() + 1800;
    } else if (subCmd == "idle") {
      setEmotion(EMOTION_IDLE, "", 0);
    }
    Serial.println("{\"ok\":true,\"buddy\":true}");
  }
}

void setup() {
  auto cfg = M5.config();
  cfg.internal_spk = false;
  cfg.external_spk = false;
  cfg.internal_mic = true; // 开启板载 ES7210 高灵敏度双麦克风
  M5.begin(cfg);

  // 极度关键：将触控滑动阈值由默认过紧的 8px 放宽到 80px，彻底根除手指接触时微移被误判为 flick 导致丢点击的缺陷！
  M5.Touch.setFlickThresh(80);

  M5.Display.setRotation(1);
  M5.Display.setBrightness(state.brightness);
  M5.Display.clear(TFT_BLACK);

  // 初始化 PSRAM 双缓冲画布
  canvas.setColorDepth(16);
  canvas.createSprite(320, 240);
  canvas.setFont(&fonts::efontCN_14);
  canvas.setTextWrap(true);

  // 释放 Speaker 资源，将 I2S 与 DMA 总线完全交由麦克风独占
  M5.Speaker.end();

  // 配置 ES7210 声学前端放大：针对 1.5~2 米远场拾音强力增益
  auto micCfg = M5.Mic.config();
  micCfg.sample_rate = 16000;
  micCfg.magnification = 24;      // 远距离灵敏度放大 (24x)
  micCfg.noise_filter_level = 16; // 自适应环境低噪平滑
  M5.Mic.config(micCfg);
  M5.Mic.begin();

  Serial.begin(115200);

  // 创建独立的 FreeRTOS 音频采集与流式推流任务 (固定在 Core 0，杜绝与 Core 1 抢占)
  xTaskCreatePinnedToCore(
    audioStreamTask,
    "audio_task",
    8192,
    NULL,
    1,
    &audioTaskHandle,
    0
  );

  // 读取存储的设备通道 (0: Win 1, 1: Win 2, 2: Mac 1, 3: Mac 2)
  Preferences p;
  p.begin("flowdesk", false);
  currentDevice = p.getUChar("device", 0);
  p.end();
  if (currentDevice >= TOTAL_DEVICES) currentDevice = 0;

  // 为 4 台设备配置独立的物理蓝牙 MAC 地址，彻底杜绝串台与设备抢占
  uint8_t baseMac[6];
  if (esp_read_mac(baseMac, ESP_MAC_BT) == ESP_OK) {
    baseMac[5] = (baseMac[5] & 0xFC) | currentDevice;
    esp_base_mac_addr_set(baseMac);
  }

  // 原生免驱 BLE 蓝牙 HID 键盘初始化 (按照当前通道独立广播设备名)
  BleCombo.begin(bleNames[currentDevice]);

  nextBlinkTime = millis() + 2000;
  nextLookTime = millis() + 3500;
  state.lastUserActionTime = millis();
  state.cachedBattery = M5.Power.getBatteryLevel();

  showToast(devGreetingNames[currentDevice], 1800);
  renderScreen();
}

void loop() {
  M5.update();
  uint32_t now = millis();

  // 1. 极致顺滑、100% 灵敏的触控捕获 (采用物理按下状态锁，彻底防止漏检)
  auto touch = M5.Touch.getDetail();
  bool isTouching = touch.isPressed();
  static bool touchLatched = false; // 严格单次按下锁
  static uint32_t tab3PressStart = 0;
  static bool tab3LongTriggered = false;
  static uint32_t lastVoiceTabClick = 0;
  static DeviceMode lastVoiceMode = MODE_CORES3_MIC;

  if (isTouching) {
    state.lastUserActionTime = now;
    if (state.isDimmed) {
      state.isDimmed = false;
      M5.Display.setBrightness(state.brightness);
      renderScreen();
    }

    // 实时采样精准坐标 (优先当前触点，备选 base_x/prev_x)
    int tx = touch.x;
    int ty = touch.y;
    if (tx <= 0 && touch.base_x > 0) tx = touch.base_x;
    if (ty <= 0 && touch.base_y > 0) ty = touch.base_y;
    if (tx <= 0 && touch.prev_x > 0) tx = touch.prev_x;
    if (ty <= 0 && touch.prev_y > 0) ty = touch.prev_y;
    if (tx <= 0) tx = 160; // 兜底中心点
    if (ty <= 0) ty = 110;

    // ── 情况 1: 如果当前正处于「设备选择菜单」弹窗中 ──
    if (state.isSelectingDevice) {
      if (!touchLatched) {
        touchLatched = true;

        // 点击右上角【返回】或顶部标题栏 (ty <= 36)
        if (ty <= 36) {
          state.isSelectingDevice = false;
          renderScreen();
          return;
        }

        // 判定 4 张卡片点击 (超大判定区，绝不失手)
        int selectedDev = -1;
        if (ty >= 38 && ty <= 126) {
          if (tx >= 14 && tx <= 154) selectedDev = 0; // Win 1
          else if (tx >= 166 && tx <= 306) selectedDev = 1; // Win 2
        } else if (ty >= 134 && ty <= 222) {
          if (tx >= 14 && tx <= 154) selectedDev = 2; // Mac 1
          else if (tx >= 166 && tx <= 306) selectedDev = 3; // Mac 2
        }

        if (selectedDev >= 0) {
          if (selectedDev == currentDevice) {
            // 点击的是当前已经在用的设备 -> 直接关闭菜单
            state.isSelectingDevice = false;
            showToast(String("保持连接: ") + devLabels[currentDevice], 1200);
            renderScreen();
          } else {
            // 点击了新设备 -> 立即切换至该设备通道！
            state.isSelectingDevice = false;
            switchDeviceChannel((uint8_t)selectedDev);
          }
          return;
        } else {
          // 点击了卡片之外的空白边缘 -> 关闭菜单
          state.isSelectingDevice = false;
          renderScreen();
          return;
        }
      }
      return;
    }

    // ── 情况 2: 正常工作界面中的长按与点击 ──
    // 1. 长按顶栏「翻页」Tab (tx >= 122 && tx < 206) 1.5 秒：唤出「选择连接设备」大菜单！
    if (ty <= 50 && tx >= 122 && tx < 206) {
      if (tab3PressStart == 0) tab3PressStart = now;
      if (!tab3LongTriggered && (now - tab3PressStart >= 1500)) {
        tab3LongTriggered = true;
        state.isSelectingDevice = true; // 唤出 4 台设备选择菜单！
        renderScreen();
        return;
      }
    } else {
      tab3PressStart = 0;
      tab3LongTriggered = false;
    }

    if (!touchLatched) {
      touchLatched = true; // 锁定本次触摸，防止连击

      // 区域 A：顶部导航选项卡 (Y <= 50，对应顶栏两大主 Tab + 设备胶囊)
      if (ty <= 50) {
        if (tx < 122) {
          // ── 点击 Tab 1: 语音功能区 ──
          if (currentMode == MODE_PAGE_FLIP) {
            // 从翻页切回语音模式 (恢复之前使用的云端或电脑遥控)
            currentMode = lastVoiceMode;
            lastVoiceTabClick = now;
            renderScreen();
          } else {
            // 当前已经在语音模式：检测是否在 450ms 内双击！
            if (now - lastVoiceTabClick < 450 && lastVoiceTabClick > 0) {
              // 双击平滑切换「云端语音」与「电脑遥控」
              if (currentMode == MODE_CORES3_MIC) {
                if (state.isRecordingVoice) cancelVoiceRecording();
                currentMode = MODE_BLE_REMOTE;
                lastVoiceMode = MODE_BLE_REMOTE;
                showToast("已切换: 电脑遥控", 1500);
              } else {
                if (state.isBleVoiceActive) state.isBleVoiceActive = false;
                state.pendingReturnTime = 0;
                currentMode = MODE_CORES3_MIC;
                lastVoiceMode = MODE_CORES3_MIC;
                showToast("已切换: 云端语音", 1500);
              }
              lastVoiceTabClick = 0; // 重置防止三击连击
            } else {
              lastVoiceTabClick = now;
            }
            renderScreen();
          }
          return;
        } else if (tx >= 122 && tx < 206) {
          // ── 点击 Tab 2:「翻页」 ──
          if (currentMode != MODE_PAGE_FLIP) {
            if (state.isRecordingVoice) cancelVoiceRecording();
            if (state.isBleVoiceActive) state.isBleVoiceActive = false;
            state.pendingReturnTime = 0;
            currentMode = MODE_PAGE_FLIP;
            renderScreen();
          }
          return;
        } else if (tx >= 206 && tx <= 296) {
          // ── 点击设备胶囊：直接呼出 4 台设备选择菜单！ ──
          state.isSelectingDevice = true;
          renderScreen();
          return;
        }
        return; // 顶栏点击必须绝对 100% 拦截，绝不允许穿透到底部触发语音！
      }

      // 区域 B：核心操作区 (Y > 50)
      if (currentMode == MODE_PAGE_FLIP) {
        // ── Tab 3: 翻页遥控模式 (左半边上一页，右半边下一页，250ms 点击闪烁动效) ──
        if (tx < 160) {
          state.btnPageUpHighlightUntil = now + 250;
          if (BleCombo.isConnected()) {
            BleCombo.pressKey(0, 0x4B); // HID_KEY_PAGE_UP
            BleCombo.releaseAllKeys();
          }
          Serial.println("CMD:pageup");
        } else {
          state.btnPageDownHighlightUntil = now + 250;
          if (BleCombo.isConnected()) {
            BleCombo.pressKey(0, 0x4E); // HID_KEY_PAGE_DOWN
            BleCombo.releaseAllKeys();
          }
          Serial.println("CMD:pagedown");
        }
        renderScreen();
        return;
      } else if (currentMode == MODE_CORES3_MIC) {
        // ── Tab 1: 云端语音模式 (对齐顶栏无条件即触即发，零死角分区) ──
        if (ty >= 170 && tx < 150) {
          // 左下角：无条件【取消】(点亮按键高亮变色 250ms)
          state.btnCancelHighlightUntil = now + 250;
          if (state.isRecordingVoice) {
            cancelVoiceRecording();
          } else {
            setEmotion(EMOTION_IDLE, "已取消", 800);
          }
        } else if (ty >= 170 && tx >= 150) {
          // 右下角：【完成】发送 (点亮按键高亮变色 250ms)
          state.btnSendHighlightUntil = now + 250;
          if (state.isRecordingVoice) {
            stopVoiceRecording();
          } else {
            startVoiceRecording();
          }
        } else {
          // 上半部分麦克风 (Y < 170 整个超大区域)：点击切换录音/发送
          if (state.isRecordingVoice) {
            stopVoiceRecording();
          } else {
            startVoiceRecording();
          }
        }
        renderScreen();
        return;
      } else {
        // ── Tab 2: 电脑遥控模式 (完全复刻顶栏零门槛逻辑，无条件响应) ──
        // 1. 左下大区域【取消】判定区 (ty >= 170 && tx < 150)
        if (ty >= 170 && tx < 150) {
          state.btnCancelHighlightUntil = now + 250; // 点亮按键高亮变色 250ms
          bool wasActive = state.isBleVoiceActive;
          state.isBleVoiceActive = false;
          state.pendingReturnTime = 0; // 彻底取消自动回车

          if (BleCombo.isConnected()) {
            if (isMacDevice(currentDevice)) {
              // ── Mac 模式 (Mac 1: Mac Mini / Mac 2: MacBook Pro): 原生 macOS 撤销 (Escape + Cmd+Z) ──
              BleCombo.pressKey(0, HID_KEY_ESCAPE);
              BleCombo.releaseAllKeys();
              delay(15);
              BleCombo.pressKey(KEY_BLE_GUI, 0x1D); // Cmd + Z
              BleCombo.releaseAllKeys();
            } else {
              // ── Windows 模式: 微信输入法撤销 (Right Alt + Escape + Ctrl+Z) ──
              if (wasActive) {
                BleCombo.pressRightAlt();
                BleCombo.releaseRightAlt();
              }
              BleCombo.pressKey(0, HID_KEY_ESCAPE);
              BleCombo.releaseAllKeys();
              delay(15);
              BleCombo.pressKey(KEY_BLE_CTRL, 0x1D); // Ctrl + Z
              BleCombo.releaseAllKeys();
            }
          }
          if (wasActive) Serial.println("CMD:right_alt");
          Serial.println("CMD:escape");
          Serial.println("CMD:undo");
          setEmotion(EMOTION_IDLE, "已取消撤销", 1000);
          renderScreen();
          return;
        }

        // 2. 右下大区域【发送】判定区 (ty >= 170 && tx >= 150)
        if (ty >= 170 && tx >= 150) {
          state.btnSendHighlightUntil = now + 250; // 点亮按键高亮变色 250ms
          state.pendingReturnTime = 0; // 清除排队
          state.isBleVoiceActive = false;
          if (BleCombo.isConnected()) {
            BleCombo.pressKey(0, BLE_KEY_RETURN);
            BleCombo.releaseAllKeys();
          }
          Serial.println("CMD:enter");
          state.cmdEnterSentTime = now;
          renderScreen();
          return;
        }

        // 3. 上半部分巨大麦克风区域 (ty < 170)：开关语音输入 / 整理中点击提前发送
        if (state.pendingReturnTime > 0) {
          // 整理倒计时中轻碰麦克风 -> 立即发送
          state.pendingReturnTime = 0;
          if (BleCombo.isConnected()) {
            BleCombo.pressKey(0, BLE_KEY_RETURN);
            BleCombo.releaseAllKeys();
          }
          Serial.println("CMD:enter");
          state.cmdEnterSentTime = now;
        } else if (!state.isBleVoiceActive) {
          // 未开启语音 -> 开启语音输入
          state.isBleVoiceActive = true;
          state.bleVoiceStartTime = now;
          if (BleCombo.isConnected()) {
            BleCombo.pressRightAlt();
            BleCombo.releaseRightAlt();
          }
          Serial.println("CMD:right_alt");
        } else {
          // 正在录音 -> 停止录音，进入 2 秒 AI 整理倒计时
          state.isBleVoiceActive = false;
          if (BleCombo.isConnected()) {
            BleCombo.pressRightAlt();
            BleCombo.releaseRightAlt();
          }
          Serial.println("CMD:right_alt");
          state.pendingReturnTime = now + 2000;
        }
        renderScreen();
        return;
      }
    }
  } else {
    // 手指离开屏幕，立即复位锁，准备下一次极速触发
    touchLatched = false;
    tab3PressStart = 0;
    tab3LongTriggered = false;
  }

  // 1.5 非阻塞延时自动提交 (时间一到敲击回车，零卡顿，100% 成功发送)
  if (state.pendingReturnTime > 0 && now >= state.pendingReturnTime) {
    state.pendingReturnTime = 0;
    if (BleCombo.isConnected()) {
      BleCombo.pressKey(0, BLE_KEY_RETURN);
      BleCombo.releaseAllKeys();
    }
    Serial.println("CMD:enter");
    state.cmdEnterSentTime = now;
    renderScreen();
  }

  // 1.8 纯 BLE 蓝牙模式发送回执超时兜底 (若未连 USB 且仅用蓝牙)
  if (state.cmdEnterSentTime > 0 && now - state.cmdEnterSentTime >= 600) {
    state.cmdEnterSentTime = 0;
    if (BleCombo.isConnected() && state.sentNoticeState == 0) {
      state.sentNoticeState = 1;
      state.sentNoticeUntil = now + 1800;
      renderScreen();
    }
  }

  // 2. 萌宠动画更新
  if (currentStyle == STYLE_APPLE_PET && !state.isRecordingVoice) {
    if (now > nextBlinkTime) {
      eyeBlinkState = (eyeBlinkState + 1) % 3;
      nextBlinkTime = (eyeBlinkState == 0) ? now + random(2500, 5000) : now + 60;
    }
    if (now > nextLookTime) {
      eyeLookOffsetX = random(-12, 13);
      eyeLookOffsetY = random(-6, 7);
      nextLookTime = now + random(3000, 6000);
    }
  }

  // 3. 定时还原状态
  if (state.emotion != EMOTION_IDLE && state.emotionUntil > 0 && now > state.emotionUntil) {
    state.emotion = EMOTION_IDLE;
    state.statusMsg = "";
    state.emotionUntil = 0;
  }

  // 3.5「✓ 已发送」/「✕ 未发送」提示框到期自动无缝消除
  static bool lastNoticeActive = false;
  bool noticeActive = (now < state.sentNoticeUntil);
  if (lastNoticeActive && !noticeActive) {
    state.sentNoticeState = 0;
    renderScreen();
  }
  lastNoticeActive = noticeActive;

  // 4. 串口指令读取
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

  // 4.5 待机 60 秒自动进入微光护眼模式 (30% 亮度，降低发热与功耗)
  if (!state.isDimmed && !state.isRecordingVoice && !state.isBleVoiceActive && (now - state.lastUserActionTime > 60000)) {
    state.isDimmed = true;
    M5.Display.setBrightness(40); // 30% 微光护眼
  }

  // 5. 电量非阻塞更新 (每 5 秒安全读取一次 AXP2101，绝不阻塞触控 I2C 总线)
  if (now - state.lastBatteryCheck > 5000) {
    state.lastBatteryCheck = now;
    state.cachedBattery = M5.Power.getBatteryLevel();
  }

  // 6. 智能动态推屏 (平滑动画与触控总线零冲突：80ms 刷新既丝滑又不占用总线)
  static uint32_t lastRenderTime = 0;
  bool isAnimating = state.isRecordingVoice 
                  || state.isBleVoiceActive 
                  || (state.pendingReturnTime > 0)
                  || (now < state.sentNoticeUntil)
                  || (now < state.btnCancelHighlightUntil)
                  || (now < state.btnSendHighlightUntil)
                  || (now < state.btnPageUpHighlightUntil)
                  || (now < state.btnPageDownHighlightUntil)
                  || (now < state.toastUntil)
                  || (state.emotion != EMOTION_IDLE)
                  || (currentMode == MODE_CORES3_MIC && currentStyle == STYLE_APPLE_PET)
                  || (!BleCombo.isConnected() && !state.isDimmed);

  uint32_t renderInterval = (state.isRecordingVoice || state.pendingReturnTime > 0 || state.isBleVoiceActive) ? 80 : 120;
  if (isAnimating && (now - lastRenderTime >= renderInterval)) {
    lastRenderTime = now;
    renderScreen();
  }
}
