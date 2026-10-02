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
  MODE_CORES3_MIC       = 0,  // Tab 1: 云端语音 (CoreS3 硬件双麦 + 豆包 ASR)
  MODE_BLE_REMOTE       = 1,  // Tab 1 子模式: 电脑遥控 (右Alt 触发电脑输入法 + 回车)
  MODE_PAGE_FLIP        = 2,  // Tab 2: 翻页演讲 (PPT / 文档 上下翻页演讲遥控器)
  MODE_MEDIA_CONTROL    = 3,  // Tab 3: 媒体控制 (音量调节、播放/暂停、上一曲/下一曲、一键静音)
  MODE_SYSTEM_SHORTCUTS = 4,  // Tab 3 子模式: 系统快捷台 (截图、锁屏、桌面、切窗口)
  MODE_TOUCH_MOUSE      = 5   // 触控鼠标 (高精度苹果触控板，指哪打哪)
};
DeviceMode currentMode = MODE_BLE_REMOTE;

// 记忆用户当前选定的语音与控制子模式 (默认“电脑遥控”极速模式，无需云端转写等待)
DeviceMode activeVoiceMode   = MODE_BLE_REMOTE;
DeviceMode activeControlMode = MODE_SYSTEM_SHORTCUTS;

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
  uint32_t btnMediaVolDownHighlight = 0;
  uint32_t btnMediaVolUpHighlight = 0;
  uint32_t btnMediaPrevHighlight = 0;
  uint32_t btnMediaPlayHighlight = 0;
  uint32_t btnMediaNextHighlight = 0;
  uint32_t btnMediaMuteHighlight = 0;
  uint32_t btnScShotHighlight = 0;
  uint32_t btnScEnterHighlight = 0;
  uint32_t btnScEscHighlight = 0;
  uint32_t btnScSwitchHighlight = 0;    // 切应用高亮
  uint32_t btnScLockHighlight = 0;
  uint32_t btnScCopyHighlight = 0;
  uint32_t btnScPasteHighlight = 0;
  uint32_t btnScUndoHighlight = 0;
  uint32_t btnScAllHighlight = 0;       // 全选高亮
  uint32_t btnScDeskHighlight = 0;
  uint32_t btnMouseHighlight = 0;       // 触控鼠标按键高亮
  uint32_t btnMouseLeftHighlight = 0;   // 鼠标左键高亮
  uint32_t btnMouseRightHighlight = 0;  // 鼠标右键高亮

  // 触控板高精鼠标状态
  int mouseLastX = -1;
  int mouseLastY = -1;
  uint32_t mouseTouchStartTime = 0;
  int mouseTouchStartX = 0;
  int mouseTouchStartY = 0;
  int mouseVisualX = -1;
  int mouseVisualY = -1;

  uint32_t lastUserActionTime = 0;      // 最后一次用户触控操作时间
  bool isDimmed = false;                // 是否处于低功耗微暗屏状态
  bool isScreenOff = false;             // 是否处于彻底熄屏休眠状态
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
// 视图 1：多媒体控制台 (小米 2 Pro 风格：音量调节 + 播控中枢)
// ==========================================
void drawMediaControlView(uint32_t now) {
  bool volDownPressed = (now < state.btnMediaVolDownHighlight);
  bool volUpPressed   = (now < state.btnMediaVolUpHighlight);
  bool prevPressed    = (now < state.btnMediaPrevHighlight);
  bool playPressed    = (now < state.btnMediaPlayHighlight);
  bool nextPressed    = (now < state.btnMediaNextHighlight);
  bool mutePressed    = (now < state.btnMediaMuteHighlight);

  // 1. 上半部分：音量大面板 (X: 12, Y: 56, W: 296, H: 76, R: 12)
  canvas.fillRoundRect(12, 56, 296, 76, 12, 0x18C3);
  canvas.drawRoundRect(12, 56, 296, 76, 12, 0x3186);

  // 左侧【音量 -】按键 (X: 20, Y: 64, W: 68, H: 60, R: 8)
  canvas.fillRoundRect(20, 64, 68, 60, 8, volDownPressed ? 0x2965 : 0x10C3);
  canvas.drawRoundRect(20, 64, 68, 60, 8, volDownPressed ? 0x9CDF : 0x52AA);
  canvas.setTextColor(volDownPressed ? TFT_WHITE : 0x07FF);
  canvas.setTextSize(2);
  canvas.drawCenterString("-", 54, 78);
  canvas.setTextSize(1);
  canvas.drawCenterString("音量", 54, 102);

  // 右侧【音量 +】按键 (X: 232, Y: 64, W: 68, H: 60, R: 8)
  canvas.fillRoundRect(232, 64, 68, 60, 8, volUpPressed ? 0x2965 : 0x10C3);
  canvas.drawRoundRect(232, 64, 68, 60, 8, volUpPressed ? 0x9CDF : 0x52AA);
  canvas.setTextColor(volUpPressed ? TFT_WHITE : 0x07FF);
  canvas.setTextSize(2);
  canvas.drawCenterString("+", 266, 78);
  canvas.setTextSize(1);
  canvas.drawCenterString("音量", 266, 102);

  // 中间提示与状态刻度
  canvas.setTextColor(TFT_WHITE);
  canvas.setTextSize(1);
  canvas.drawCenterString("系统音量调节", 160, 76);
  canvas.setTextColor(0x9CD3);
  canvas.drawCenterString("点击左右增减", 160, 100);

  // 2. 下半部分：4 个播控大按钮 (Y: 140, H: 88)
  // 按键 1: 上一曲
  canvas.fillRoundRect(12, 140, 68, 88, 10, prevPressed ? 0x2965 : 0x18C3);
  canvas.drawRoundRect(12, 140, 68, 88, 10, prevPressed ? 0x9CDF : 0x3186);
  canvas.setTextColor(prevPressed ? TFT_WHITE : 0x07FF);
  canvas.setTextSize(1);
  canvas.drawCenterString("上曲", 46, 166);
  canvas.setTextColor(0x7BEF);
  canvas.drawCenterString("Prev", 46, 192);

  // 按键 2: 播放/暂停
  canvas.fillRoundRect(86, 140, 74, 88, 10, playPressed ? 0x0320 : 0x18C3);
  canvas.drawRoundRect(86, 140, 74, 88, 10, playPressed ? 0x07E0 : 0x3186);
  canvas.setTextColor(playPressed ? TFT_WHITE : 0x07E0);
  canvas.setTextSize(1);
  canvas.drawCenterString("播/停", 123, 166);
  canvas.setTextColor(0x7BEF);
  canvas.drawCenterString("Play", 123, 192);

  // 按键 3: 下一曲
  canvas.fillRoundRect(166, 140, 68, 88, 10, nextPressed ? 0x2965 : 0x18C3);
  canvas.drawRoundRect(166, 140, 68, 88, 10, nextPressed ? 0x9CDF : 0x3186);
  canvas.setTextColor(nextPressed ? TFT_WHITE : 0x07FF);
  canvas.setTextSize(1);
  canvas.drawCenterString("下曲", 200, 166);
  canvas.setTextColor(0x7BEF);
  canvas.drawCenterString("Next", 200, 192);

  // 按键 4: 静音
  canvas.fillRoundRect(240, 140, 68, 88, 10, mutePressed ? 0x3800 : 0x18C3);
  canvas.drawRoundRect(240, 140, 68, 88, 10, mutePressed ? 0xF800 : 0x3186);
  canvas.setTextColor(mutePressed ? TFT_WHITE : 0xF880);
  canvas.setTextSize(1);
  canvas.drawCenterString("静音", 274, 166);
  canvas.setTextColor(0x7BEF);
  canvas.drawCenterString("Mute", 274, 192);
}

// ==========================================
// 视图 2：系统快捷台 (Stream Deck 风格 10 大高频生产力按键闭环)
// ==========================================
void drawSystemShortcutsView(uint32_t now) {
  bool scShotPressed   = (now < state.btnScShotHighlight);
  bool scEnterPressed  = (now < state.btnScEnterHighlight);
  bool scEscPressed    = (now < state.btnScEscHighlight);
  bool scSwitchPressed = (now < state.btnScSwitchHighlight);
  bool scLockPressed   = (now < state.btnScLockHighlight);

  bool scCopyPressed   = (now < state.btnScCopyHighlight);
  bool scPastePressed  = (now < state.btnScPasteHighlight);
  bool scUndoPressed   = (now < state.btnScUndoHighlight);
  bool scAllPressed    = (now < state.btnScAllHighlight);
  bool scDeskPressed   = (now < state.btnScDeskHighlight);

  // ── 第一行 (Y: 58, H: 80)：截图、确认、取消与窗口调度 ──
  // [0, 0] 微信截图 (X: 6, Y: 58, W: 56, H: 80)
  canvas.fillRoundRect(6, 58, 56, 80, 8, scShotPressed ? 0x2965 : 0x18C3);
  canvas.drawRoundRect(6, 58, 56, 80, 8, scShotPressed ? 0x9CDF : 0x3186);
  canvas.setTextColor(scShotPressed ? TFT_WHITE : 0x07FF);
  canvas.setTextSize(1);
  canvas.drawCenterString("截图", 34, 76);
  canvas.setTextColor(0x7BEF);
  canvas.drawCenterString("Ctrl+J", 34, 104);

  // [0, 1] 确定 Enter (X: 69, Y: 58, W: 56, H: 80) - 截图确认/发送神器！
  canvas.fillRoundRect(69, 58, 56, 80, 8, scEnterPressed ? 0x0320 : 0x18C3);
  canvas.drawRoundRect(69, 58, 56, 80, 8, scEnterPressed ? 0x07E0 : 0x3186);
  canvas.setTextColor(scEnterPressed ? TFT_WHITE : 0x07E0);
  canvas.drawCenterString("确定", 97, 76);
  canvas.setTextColor(0x7BEF);
  canvas.drawCenterString("Enter", 97, 104);

  // [0, 2] 取消 Esc (X: 132, Y: 58, W: 56, H: 80) - 截图截偏/误触秒退！
  canvas.fillRoundRect(132, 58, 56, 80, 8, scEscPressed ? 0x3800 : 0x18C3);
  canvas.drawRoundRect(132, 58, 56, 80, 8, scEscPressed ? 0xF800 : 0x3186);
  canvas.setTextColor(scEscPressed ? TFT_WHITE : 0xF880);
  canvas.drawCenterString("取消", 160, 76);
  canvas.setTextColor(0x7BEF);
  canvas.drawCenterString("Esc", 160, 104);

  // [0, 3] 切应用 Alt+Tab (X: 195, Y: 58, W: 56, H: 80) 🌟 瞬间在最近活跃窗口间自由切换！
  canvas.fillRoundRect(195, 58, 56, 80, 8, scSwitchPressed ? 0x2965 : 0x18C3);
  canvas.drawRoundRect(195, 58, 56, 80, 8, scSwitchPressed ? 0x07FF : 0x3186);
  canvas.setTextColor(scSwitchPressed ? TFT_WHITE : 0x07FF);
  canvas.drawCenterString("切窗", 223, 76);
  canvas.setTextColor(0x7BEF);
  canvas.drawCenterString("Alt+Tab", 223, 104);

  // [0, 4] 锁屏 (X: 258, Y: 58, W: 56, H: 80)
  canvas.fillRoundRect(258, 58, 56, 80, 8, scLockPressed ? 0x3980 : 0x18C3);
  canvas.drawRoundRect(258, 58, 56, 80, 8, scLockPressed ? 0xFD20 : 0x3186);
  canvas.setTextColor(scLockPressed ? TFT_WHITE : 0xFD20);
  canvas.drawCenterString("锁屏", 286, 76);
  canvas.setTextColor(0x7BEF);
  canvas.drawCenterString("Win+L", 286, 104);

  // ── 第二行 (Y: 144, H: 80)：高频生产力编辑与桌面 ──
  // [1, 0] 复制 (X: 6, Y: 144, W: 56, H: 80)
  canvas.fillRoundRect(6, 144, 56, 80, 8, scCopyPressed ? 0x0270 : 0x18C3);
  canvas.drawRoundRect(6, 144, 56, 80, 8, scCopyPressed ? 0x07FF : 0x3186);
  canvas.setTextColor(scCopyPressed ? TFT_WHITE : 0x07FF);
  canvas.drawCenterString("复制", 34, 162);
  canvas.setTextColor(0x7BEF);
  canvas.drawCenterString("Ctrl+C", 34, 190);

  // [1, 1] 粘贴 (X: 69, Y: 144, W: 56, H: 80)
  canvas.fillRoundRect(69, 144, 56, 80, 8, scPastePressed ? 0x39C0 : 0x18C3);
  canvas.drawRoundRect(69, 144, 56, 80, 8, scPastePressed ? 0xFFE0 : 0x3186);
  canvas.setTextColor(scPastePressed ? TFT_WHITE : 0xFFE0);
  canvas.drawCenterString("粘贴", 97, 162);
  canvas.setTextColor(0x7BEF);
  canvas.drawCenterString("Ctrl+V", 97, 190);

  // [1, 2] 撤销 (X: 132, Y: 144, W: 56, H: 80)
  canvas.fillRoundRect(132, 144, 56, 80, 8, scUndoPressed ? 0x2124 : 0x18C3);
  canvas.drawRoundRect(132, 144, 56, 80, 8, scUndoPressed ? 0xD69A : 0x3186);
  canvas.setTextColor(scUndoPressed ? TFT_WHITE : 0xD69A);
  canvas.drawCenterString("撤销", 160, 162);
  canvas.setTextColor(0x7BEF);
  canvas.drawCenterString("Ctrl+Z", 160, 190);

  // [1, 3] 全选 (X: 195, Y: 144, W: 56, H: 80)
  canvas.fillRoundRect(195, 144, 56, 80, 8, scAllPressed ? 0x0270 : 0x18C3);
  canvas.drawRoundRect(195, 144, 56, 80, 8, scAllPressed ? 0x07FF : 0x3186);
  canvas.setTextColor(scAllPressed ? TFT_WHITE : 0x07FF);
  canvas.drawCenterString("全选", 223, 162);
  canvas.setTextColor(0x7BEF);
  canvas.drawCenterString("Ctrl+A", 223, 190);

  // [1, 4] 桌面 (X: 258, Y: 144, W: 56, H: 80)
  canvas.fillRoundRect(258, 144, 56, 80, 8, scDeskPressed ? 0x0320 : 0x18C3);
  canvas.drawRoundRect(258, 144, 56, 80, 8, scDeskPressed ? 0x07E0 : 0x3186);
  canvas.setTextColor(scDeskPressed ? TFT_WHITE : 0x07E0);
  canvas.drawCenterString("桌面", 286, 162);
  canvas.setTextColor(0x7BEF);
  canvas.drawCenterString("Win+D", 286, 190);
}

// ==========================================
// 视图 3：触控鼠标模式 (MacBook 触控板手感，指哪打哪，阻尼滚轮滑轨)
// ==========================================
void drawTouchMouseView(uint32_t now) {
  // 1. 触控板主体区域 (X: 6, Y: 52, W: 258, H: 138, R: 8)
  canvas.fillRoundRect(6, 52, 258, 138, 8, 0x10A2);
  canvas.drawRoundRect(6, 52, 258, 138, 8, 0x2965);

  // 触控板居中微光提示
  canvas.setTextColor(0x52AA);
  canvas.setTextSize(1);
  canvas.drawCenterString("高精度触控板", 135, 100);
  canvas.setTextColor(0x39E7);
  canvas.drawCenterString("慢移微调 / 快划飞跃 / 轻击左键", 135, 122);

  // 手指滑过时的动态光标触点涟漪动效
  if (state.mouseVisualX >= 6 && state.mouseVisualX <= 264 && state.mouseVisualY >= 52 && state.mouseVisualY <= 190) {
    canvas.drawCircle(state.mouseVisualX, state.mouseVisualY, 14, 0x07FF);
    canvas.fillCircle(state.mouseVisualX, state.mouseVisualY, 4, TFT_WHITE);
  }

  // 2. 右侧垂直阻尼滚轮滑轨 (X: 270, Y: 52, W: 44, H: 138, R: 8)
  canvas.fillRoundRect(270, 52, 44, 138, 8, 0x18C3);
  canvas.drawRoundRect(270, 52, 44, 138, 8, 0x3186);
  canvas.setTextColor(0x07FF);
  canvas.setTextSize(1);
  canvas.drawCenterString("▲", 292, 66);
  canvas.setTextColor(0x9CDF);
  canvas.drawCenterString("滚", 292, 98);
  canvas.drawCenterString("轮", 292, 118);
  canvas.setTextColor(0x07FF);
  canvas.drawCenterString("▼", 292, 160);

  // 3. 底部操作栏 (左键、返回语音、右键 - 与顶栏及主界面完全等宽对称！)
  bool isLeftPressed  = (now < state.btnMouseLeftHighlight);
  bool isRightPressed = (now < state.btnMouseRightHighlight);
  bool isBackPressed  = (now < state.btnMouseHighlight);

  // [左键] (X: 6, Y: 196, W: 92, H: 38)
  canvas.fillRoundRect(6, 196, 92, 38, 8, isLeftPressed ? 0x0320 : 0x18C3);
  canvas.drawRoundRect(6, 196, 92, 38, 8, isLeftPressed ? 0x07E0 : 0x3186);
  canvas.setTextColor(isLeftPressed ? TFT_WHITE : 0x07E0);
  canvas.drawCenterString("左键单击", 52, 208);

  // [返回] (X: 102, Y: 196, W: 88, H: 38)
  canvas.fillRoundRect(102, 196, 88, 38, 8, isBackPressed ? 0x2965 : 0x18C3);
  canvas.drawRoundRect(102, 196, 88, 38, 8, isBackPressed ? 0x9CDF : 0x3186);
  canvas.setTextColor(isBackPressed ? TFT_WHITE : 0x9CDF);
  canvas.drawCenterString("返回语音", 146, 208);

  // [右键] (X: 194, Y: 196, W: 98, H: 38)
  canvas.fillRoundRect(194, 196, 98, 38, 8, isRightPressed ? 0x3980 : 0x18C3);
  canvas.drawRoundRect(194, 196, 98, 38, 8, isRightPressed ? 0xFD20 : 0x3186);
  canvas.setTextColor(isRightPressed ? TFT_WHITE : 0xFD20);
  canvas.drawCenterString("右键菜单", 243, 208);
}

// ==========================================
// 顶栏：三大全功能主 Tab [语音] [翻页] [控制] + 苹果风竖直微电量柱
// ==========================================
void drawDynamicIsland() {
  // ── Tab 1: 语音功能区 (X: 6, Y: 6, 宽 92, 高 38, R: 8) ──
  // 支持 450ms 内双击直接在「云端语音」和「电脑遥控」之间平滑切换！
  if (currentMode == MODE_CORES3_MIC) {
    canvas.fillRoundRect(6, 6, 92, 38, 8, 0x0317);
    canvas.drawRoundRect(6, 6, 92, 38, 8, 0x07FF);
    canvas.setTextColor(TFT_WHITE);
    canvas.setTextSize(1);
    canvas.drawCenterString("云端语音", 52, 18);
  } else if (currentMode == MODE_BLE_REMOTE) {
    canvas.fillRoundRect(6, 6, 92, 38, 8, 0x39C0);
    canvas.drawRoundRect(6, 6, 92, 38, 8, 0xFFE0);
    canvas.setTextColor(TFT_WHITE);
    canvas.setTextSize(1);
    canvas.drawCenterString("电脑遥控", 52, 18);
  } else {
    // 当前处于翻页或控制模式：准确显示用户当前使用的语音模式 (解决状态跟不上的问题！)
    canvas.fillRoundRect(6, 6, 92, 38, 8, 0x18C3);
    canvas.drawRoundRect(6, 6, 92, 38, 8, 0x3186);
    canvas.setTextColor(0x7BEF);
    canvas.setTextSize(1);
    canvas.drawCenterString(activeVoiceMode == MODE_BLE_REMOTE ? "电脑遥控" : "云端语音", 52, 18);
  }

  // ── Tab 2: 翻页演讲区 (X: 102, Y: 6, 宽 88, 高 38, R: 8) ──
  // 单击进入翻页；双击或长按 1.5 秒打开 4 台设备大选择菜单
  if (currentMode == MODE_PAGE_FLIP) {
    canvas.fillRoundRect(102, 6, 88, 38, 8, 0x0320);
    canvas.drawRoundRect(102, 6, 88, 38, 8, 0x07E0);
    canvas.setTextColor(TFT_WHITE);
  } else {
    canvas.fillRoundRect(102, 6, 88, 38, 8, 0x18C3);
    canvas.drawRoundRect(102, 6, 88, 38, 8, 0x3186);
    canvas.setTextColor(0x7BEF);
  }
  canvas.setTextSize(1);
  canvas.drawCenterString("翻页", 146, 18);

  // ── Tab 3: 控制中心区 (X: 194, Y: 6, 宽 98, 高 38, R: 8) ──
  // 支持 450ms 内双击直接在「媒体控制」和「系统快捷」之间平滑切换！
  if (currentMode == MODE_MEDIA_CONTROL) {
    canvas.fillRoundRect(194, 6, 98, 38, 8, 0x2965);
    canvas.drawRoundRect(194, 6, 98, 38, 8, 0x9CDF);
    canvas.setTextColor(TFT_WHITE);
    canvas.setTextSize(1);
    canvas.drawCenterString("媒体控制", 243, 18);
  } else if (currentMode == MODE_SYSTEM_SHORTCUTS) {
    canvas.fillRoundRect(194, 6, 98, 38, 8, 0x3980);
    canvas.drawRoundRect(194, 6, 98, 38, 8, 0xFD20);
    canvas.setTextColor(TFT_WHITE);
    canvas.setTextSize(1);
    canvas.drawCenterString("系统快捷", 243, 18);
  } else {
    canvas.fillRoundRect(194, 6, 98, 38, 8, 0x18C3);
    canvas.drawRoundRect(194, 6, 98, 38, 8, 0x3186);
    canvas.setTextColor(0x7BEF);
    canvas.setTextSize(1);
    canvas.drawCenterString(activeControlMode == MODE_SYSTEM_SHORTCUTS ? "系统快捷" : "媒体控制", 243, 18);
  }

  // 蓝牙状态极简微指示点 (X: 298, Y: 25, 直径 4px)
  bool bleConnected = BleCombo.isConnected();
  if (bleConnected) {
    canvas.fillCircle(298, 25, 2, 0x07FF); // 已连接：稳定常亮纯净科技青
  } else {
    // 未连接：微弱柔和呼吸闪烁 (周期 1000ms)
    uint32_t phase = millis() % 1000;
    if (phase < 500) {
      canvas.fillCircle(298, 25, 2, 0x0256); // 柔和深蓝
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
// 底栏：极简状态与功能按钮 (严格消除任何错位与多余框框)
// ==========================================
void drawBottomActionBar() {
  uint32_t now = millis();

  // 按钮瞬时点击反馈
  bool isCancelPressed = (now < state.btnCancelHighlightUntil);
  bool isSendPressed   = (now < state.btnSendHighlightUntil);

  // 取消按键颜色：平时高级暗灰 0x18C3；点击瞬间高亮暖红 0x3800 + 亮红框 0xF980
  uint16_t cancelBgColor     = isCancelPressed ? 0x3800 : 0x18C3;
  uint16_t cancelBorderColor = isCancelPressed ? 0xF980 : 0x3186;
  uint16_t cancelTextColor   = isCancelPressed ? TFT_WHITE : 0x7BEF;

  // 发送/状态按键颜色：平时高级暗灰 0x18C3；点击瞬间高亮翠绿 0x0320
  uint16_t sendBgColor     = isSendPressed ? 0x0320 : 0x18C3;
  uint16_t sendBorderColor = isSendPressed ? 0x07E0 : 0x3186;
  uint16_t sendTextColor   = isSendPressed ? TFT_WHITE : 0x7BEF;
  String sendLabel = (currentMode == MODE_CORES3_MIC) ? "完成" : "发送";

  // 若收到确切发送状态回执，直接将右下角按键原位平滑变色 (100% 严丝合缝，绝不二次错位叠画！)
  if (now < state.sentNoticeUntil) {
    if (state.sentNoticeState == 1) {
      sendBgColor     = 0x0320;
      sendBorderColor = 0x07E0;
      sendTextColor   = TFT_WHITE;
      sendLabel       = "✓ 已发送";
    } else if (state.sentNoticeState == 2) {
      sendBgColor     = 0x4000;
      sendBorderColor = 0xF800;
      sendTextColor   = TFT_WHITE;
      sendLabel       = "✕ 未发送";
    }
  } else if (currentMode == MODE_CORES3_MIC && state.isRecordingVoice) {
    uint32_t sec = (millis() - state.recordingStartTime) / 1000;
    sendLabel = "完成 " + String(sec) + "s";
  }

  if (currentMode == MODE_CORES3_MIC || currentMode == MODE_BLE_REMOTE) {
    bool isMousePressed = (now < state.btnMouseHighlight);
    uint16_t mouseBgColor     = isMousePressed ? 0x0270 : 0x18C3;
    uint16_t mouseBorderColor = isMousePressed ? 0x07FF : 0x3186;
    uint16_t mouseTextColor   = isMousePressed ? TFT_WHITE : 0x07FF;

    // 1. 左下角：【取消】按钮 (严格匹配 Tab 1 尺寸 X: 6, Y: 196, 宽 92, 高 38)
    canvas.fillRoundRect(6, 196, 92, 38, 8, cancelBgColor);
    canvas.drawRoundRect(6, 196, 92, 38, 8, cancelBorderColor);
    canvas.setTextColor(cancelTextColor);
    canvas.setTextSize(1);
    canvas.drawCenterString("取消", 52, 208);

    // 2. 正下方中间：【触控鼠标】(严格匹配 Tab 2 尺寸 X: 102, Y: 196, 宽 88, 高 38) - 100% 对称！
    canvas.fillRoundRect(102, 196, 88, 38, 8, mouseBgColor);
    canvas.drawRoundRect(102, 196, 88, 38, 8, mouseBorderColor);
    canvas.setTextColor(mouseTextColor);
    canvas.setTextSize(1);
    canvas.drawCenterString("触控鼠标", 146, 208);

    // 3. 右下角：【发送/完成/状态】(严格匹配 Tab 3 尺寸 X: 194, Y: 196, 宽 98, 高 38) - 100% 对称！
    canvas.fillRoundRect(194, 196, 98, 38, 8, sendBgColor);
    canvas.drawRoundRect(194, 196, 98, 38, 8, sendBorderColor);
    canvas.setTextColor(sendTextColor);
    canvas.setTextSize(1);
    canvas.drawCenterString(sendLabel, 243, 208);
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
  } else if (currentMode == MODE_MEDIA_CONTROL) {
    // ── Tab 3 形态 A: 多媒体播控中枢 ──
    drawMediaControlView(now);
  } else if (currentMode == MODE_SYSTEM_SHORTCUTS) {
    // ── Tab 3 形态 B: 系统快捷台 ──
    drawSystemShortcutsView(now);
  } else if (currentMode == MODE_TOUCH_MOUSE) {
    // ── 触控鼠标模式 (MacBook 触控板) ──
    drawTouchMouseView(now);
  } else if (currentMode == MODE_BLE_REMOTE || currentMode == MODE_CORES3_MIC) {
    // ── Tab 1: 经典黑白麦克风 + 声波辐射扩散 ──
    drawClassicMicrophone(160, 110, now);
  }

  // 3. 底栏 (发送按钮 / 已发送提示 / 录音进度 / 触控鼠标按键)
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

  // 读取存储的设备通道与模式 (默认 0 号设备与电脑遥控模式)
  Preferences p;
  p.begin("flowdesk", false);
  currentDevice = p.getUChar("device", 0);
  activeVoiceMode = (DeviceMode)p.getUChar("voice_mode", (uint8_t)MODE_BLE_REMOTE);
  p.end();
  if (currentDevice >= TOTAL_DEVICES) currentDevice = 0;
  if (activeVoiceMode != MODE_CORES3_MIC && activeVoiceMode != MODE_BLE_REMOTE) {
    activeVoiceMode = MODE_BLE_REMOTE;
  }
  currentMode = activeVoiceMode;

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

  // 1. 极致顺滑、100% 灵敏的触控捕获 (支持瞬时短点与按下，彻底防止漏检)
  auto touch = M5.Touch.getDetail();
  bool isTouching = touch.isPressed() || touch.wasPressed() || touch.wasClicked();
  static bool touchLatched = false; // 严格单次按下锁
  static uint32_t tab2PressStart = 0;
  static bool tab2LongTriggered = false;
  static uint32_t lastVoiceTabClick = 0;
  static uint32_t lastPageTabClick = 0;
  static uint32_t lastControlTabClick = 0;

  // 实体侧边电源键单击：一键息屏黑屏休眠 / 极速点亮
  if (M5.BtnPWR.wasClicked()) {
    if (!state.isScreenOff) {
      state.isScreenOff = true;
      M5.Display.setBrightness(0);
      M5.Display.sleep();
    } else {
      state.isScreenOff = false;
      M5.Display.wakeup();
      M5.Display.setBrightness(state.brightness);
      renderScreen();
    }
  }

  if (isTouching) {
    if (state.isScreenOff) {
      // 触碰熄灭屏幕 -> 瞬间点亮唤醒屏幕！
      state.isScreenOff = false;
      M5.Display.wakeup();
      M5.Display.setBrightness(state.brightness);
      renderScreen();
      return; // 拦截本次触碰，防止误触发功能
    }

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
          if (tx >= 14 && tx <= 154) selectedDev = 0; // Win 1: Marshall
          else if (tx >= 166 && tx <= 306) selectedDev = 1; // Win 2: AiMarshall
        } else if (ty >= 134 && ty <= 222) {
          if (tx >= 14 && tx <= 154) selectedDev = 2; // Mac 1: MacMini
          else if (tx >= 166 && tx <= 306) selectedDev = 3; // Mac 2: MacPro
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
    // 1. 长按顶栏「翻页」Tab (tx >= 98 && tx < 192) 1.5 秒：唤出「选择连接设备」大菜单！
    if (ty <= 50 && tx >= 98 && tx < 192) {
      if (tab2PressStart == 0) tab2PressStart = now;
      if (!tab2LongTriggered && (now - tab2PressStart >= 1500)) {
        tab2LongTriggered = true;
        state.isSelectingDevice = true; // 唤出 4 台设备选择菜单！
        renderScreen();
        return;
      }
    } else {
      tab2PressStart = 0;
      tab2LongTriggered = false;
    }

    // ── 特殊模式：触控鼠标高精度滑动画板 (Y: 48 ~ 192) ──
    if (currentMode == MODE_TOUCH_MOUSE && ty > 48 && ty < 192) {
      if (tx >= 268) {
        // 右侧垂直阻尼滚轮滑轨 (X >= 268)
        if (state.mouseLastY > 0) {
          int dy = ty - state.mouseLastY;
          if (abs(dy) >= 4) {
            int8_t wheel = (dy < 0) ? 1 : -1;
            if (BleCombo.isConnected()) BleCombo.moveMouse(0, 0, wheel);
            Serial.printf("MOUSE:0,0,%d\n", wheel);
            state.mouseLastY = ty;
          }
        } else {
          state.mouseLastY = ty;
        }
      } else {
        // 主触控板移动区 (MacBook 苹果触控板手感：指哪打哪，细腻平滑)
        state.mouseVisualX = tx;
        state.mouseVisualY = ty;

        // 若刚触碰或尚未锚定基准点
        if (state.mouseLastX < 0 || state.mouseLastY < 0) {
          state.mouseLastX = tx;
          state.mouseLastY = ty;
          state.mouseTouchStartX = tx;
          state.mouseTouchStartY = ty;
          state.mouseTouchStartTime = now;
        } else {
          int dx = tx - state.mouseLastX;
          int dy = ty - state.mouseLastY;
          state.mouseLastX = tx;
          state.mouseLastY = ty;

          if (dx != 0 || dy != 0) {
            float dist = sqrtf((float)(dx * dx + dy * dy));
            // 苹果经典动力学加速度模型
            float gain;
            if (dist <= 2.0f) {
              gain = 1.2f; // 慢速微调：清晰 1:1 跟随，绝不截断为 0！
            } else if (dist <= 7.0f) {
              gain = 1.5f + (dist - 2.0f) * 0.3f; // 中速巡航：平滑舒适跟手
            } else {
              gain = 3.0f + (dist - 7.0f) * 0.25f; // 快速跨屏滑掠
              if (gain > 5.5f) gain = 5.5f;
            }

            int moveX = (int)roundf(dx * gain);
            int moveY = (int)roundf(dy * gain);

            if (moveX > 80) moveX = 80;
            if (moveX < -80) moveX = -80;
            if (moveY > 80) moveY = 80;
            if (moveY < -80) moveY = -80;

            if (moveX != 0 || moveY != 0) {
              if (BleCombo.isConnected()) {
                BleCombo.moveMouse((int8_t)moveX, (int8_t)moveY, 0);
              }
              Serial.printf("MOUSE:%d,%d,0\n", moveX, moveY);
            }
          }
        }
      }
      return;
    }

    if (!touchLatched) {
      touchLatched = true; // 锁定本次触摸，防止连击

      // 区域 A：顶部导航三大主选项卡 (Y <= 50)
      if (ty <= 50) {
        if (tx < 98) {
          // ── 点击 Tab 1: 语音功能区 ──
          if (currentMode != MODE_CORES3_MIC && currentMode != MODE_BLE_REMOTE) {
            // 从翻页或控制切回语音 (准确恢复记忆的云端或电脑遥控)
            currentMode = activeVoiceMode;
            lastVoiceTabClick = now;
            renderScreen();
          } else {
            // 当前已经在语音模式：检测是否在 450ms 内双击！
            if (now - lastVoiceTabClick < 450 && lastVoiceTabClick > 0) {
              if (currentMode == MODE_CORES3_MIC) {
                if (state.isRecordingVoice) cancelVoiceRecording();
                currentMode = MODE_BLE_REMOTE;
                activeVoiceMode = MODE_BLE_REMOTE;
                showToast("已切换: 电脑遥控", 1500);
              } else {
                if (state.isBleVoiceActive) state.isBleVoiceActive = false;
                state.pendingReturnTime = 0;
                currentMode = MODE_CORES3_MIC;
                activeVoiceMode = MODE_CORES3_MIC;
                showToast("已切换: 云端语音", 1500);
              }
              Preferences p;
              p.begin("flowdesk", false);
              p.putUChar("voice_mode", (uint8_t)activeVoiceMode);
              p.end();
              lastVoiceTabClick = 0;
            } else {
              lastVoiceTabClick = now;
            }
            renderScreen();
          }
          return;
        } else if (tx >= 98 && tx < 192) {
          // ── 点击 Tab 2:「翻页」 ──
          if (currentMode != MODE_PAGE_FLIP) {
            if (state.isRecordingVoice) cancelVoiceRecording();
            if (state.isBleVoiceActive) state.isBleVoiceActive = false;
            state.pendingReturnTime = 0;
            currentMode = MODE_PAGE_FLIP;
            lastPageTabClick = now;
            renderScreen();
          } else {
            // 当前已经在翻页模式：检测双击打开设备选择菜单！
            if (now - lastPageTabClick < 450 && lastPageTabClick > 0) {
              state.isSelectingDevice = true; // 双击唤出 4 台设备选择菜单！
              lastPageTabClick = 0;
              renderScreen();
            } else {
              lastPageTabClick = now;
            }
          }
          return;
        } else if (tx >= 192 && tx < 296) {
          // ── 点击 Tab 3: 控制功能区 ──
          if (currentMode != MODE_MEDIA_CONTROL && currentMode != MODE_SYSTEM_SHORTCUTS) {
            // 从其他模式切入控制中心
            if (state.isRecordingVoice) cancelVoiceRecording();
            if (state.isBleVoiceActive) state.isBleVoiceActive = false;
            state.pendingReturnTime = 0;
            currentMode = activeControlMode;
            lastControlTabClick = now;
            renderScreen();
          } else {
            // 当前已经在控制模式：检测是否在 450ms 内双击！
            if (now - lastControlTabClick < 450 && lastControlTabClick > 0) {
              if (currentMode == MODE_MEDIA_CONTROL) {
                currentMode = MODE_SYSTEM_SHORTCUTS;
                activeControlMode = MODE_SYSTEM_SHORTCUTS;
                showToast("已切换: 系统快捷台", 1500);
              } else {
                currentMode = MODE_MEDIA_CONTROL;
                activeControlMode = MODE_MEDIA_CONTROL;
                showToast("已切换: 媒体控制台", 1500);
              }
              lastControlTabClick = 0;
            } else {
              lastControlTabClick = now;
            }
            renderScreen();
          }
          return;
        }
        return; // 顶栏点击必须绝对 100% 拦截
      }

      // 区域 B：核心操作区 (Y > 50)
      if (currentMode == MODE_PAGE_FLIP) {
        // ── Tab 2: 翻页遥控模式 (左半边上一页，右半边下一页，250ms 点击闪烁动效) ──
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
      } else if (currentMode == MODE_MEDIA_CONTROL) {
        // ── Tab 3 形态 A: 多媒体播控中枢 ──
        if (ty >= 56 && ty <= 132) {
          // 上半部分：音量控制
          if (tx <= 90) {
            // 音量 -
            state.btnMediaVolDownHighlight = now + 200;
            if (BleCombo.isConnected()) BleCombo.sendMedia(BLE_MEDIA_VOLUME_DOWN);
            Serial.println("CMD:vol_down");
          } else if (tx >= 230) {
            // 音量 +
            state.btnMediaVolUpHighlight = now + 200;
            if (BleCombo.isConnected()) BleCombo.sendMedia(BLE_MEDIA_VOLUME_UP);
            Serial.println("CMD:vol_up");
          }
        } else if (ty > 132) {
          // 下半部分：4 大播控键
          if (tx < 80) {
            // 上一曲
            state.btnMediaPrevHighlight = now + 200;
            if (BleCombo.isConnected()) BleCombo.sendMedia(BLE_MEDIA_PREV);
            Serial.println("CMD:prev_track");
          } else if (tx >= 80 && tx < 162) {
            // 播放/暂停
            state.btnMediaPlayHighlight = now + 200;
            if (BleCombo.isConnected()) BleCombo.sendMedia(BLE_MEDIA_PLAY_PAUSE);
            Serial.println("CMD:play_pause");
          } else if (tx >= 162 && tx < 236) {
            // 下一曲
            state.btnMediaNextHighlight = now + 200;
            if (BleCombo.isConnected()) BleCombo.sendMedia(BLE_MEDIA_NEXT);
            Serial.println("CMD:next_track");
          } else {
            // 一键静音
            state.btnMediaMuteHighlight = now + 200;
            if (BleCombo.isConnected()) BleCombo.sendMedia(BLE_MEDIA_MUTE);
            Serial.println("CMD:mute");
          }
        }
        renderScreen();
        return;
      } else if (currentMode == MODE_SYSTEM_SHORTCUTS) {
        // ── Tab 3 形态 B: 系统快捷台 (Stream Deck 10大高频生产力按键) ──
        if (ty < 138) {
          // ── 第一行 (Y: 58 ~ 138)：截图、确认、取消、切应用、锁屏 ──
          if (tx < 66) {
            // [0, 0] 微信截图 (Ctrl + J)
            state.btnScShotHighlight = now + 250;
            if (BleCombo.isConnected()) {
              if (isMacDevice(currentDevice)) {
                BleCombo.pressKey(KEY_BLE_GUI | KEY_BLE_SHIFT, 0x21); // Mac: Cmd+Shift+4
              } else {
                BleCombo.pressKey(KEY_BLE_CTRL, 0x0D); // Win: Ctrl + J
              }
              BleCombo.releaseAllKeys();
            }
            Serial.println("CMD:screenshot");
            showToast("微信截图 (Ctrl+J)", 1000);
          } else if (tx >= 66 && tx < 129) {
            // [0, 1] 确定 Enter (截图确认/发送神器！)
            state.btnScEnterHighlight = now + 250;
            if (BleCombo.isConnected()) {
              BleCombo.pressKey(0, BLE_KEY_RETURN);
              BleCombo.releaseAllKeys();
            }
            Serial.println("CMD:enter");
            showToast("确定 Enter", 1000);
          } else if (tx >= 129 && tx < 192) {
            // [0, 2] 取消 Esc (截图截偏/误触秒退！)
            state.btnScEscHighlight = now + 250;
            if (BleCombo.isConnected()) {
              BleCombo.pressKey(0, HID_KEY_ESCAPE);
              BleCombo.releaseAllKeys();
            }
            Serial.println("CMD:escape");
            showToast("取消 Esc", 1000);
          } else if (tx >= 192 && tx < 255) {
            // [0, 3] 切应用 Alt+Tab 🌟 (瞬间切换最近活跃窗口！)
            state.btnScSwitchHighlight = now + 250;
            if (BleCombo.isConnected()) {
              if (isMacDevice(currentDevice)) {
                BleCombo.pressKey(KEY_BLE_GUI, HID_KEY_TAB);
              } else {
                BleCombo.pressKey(KEY_BLE_ALT, HID_KEY_TAB);
              }
              BleCombo.releaseAllKeys();
            }
            Serial.println("CMD:switch_window");
            showToast("切应用 (Alt+Tab)", 1000);
          } else {
            // [0, 4] 锁屏 (Win+L / Cmd+Ctrl+Q)
            state.btnScLockHighlight = now + 250;
            if (BleCombo.isConnected()) {
              if (isMacDevice(currentDevice)) {
                BleCombo.pressKey(KEY_BLE_GUI | KEY_BLE_CTRL, 0x14); // Cmd+Ctrl+Q
              } else {
                BleCombo.pressKey(KEY_BLE_GUI, 0x0F); // Win+L
              }
              BleCombo.releaseAllKeys();
            }
            Serial.println("CMD:lock");
            showToast("电脑锁屏 (Win+L)", 1000);
          }
        } else {
          // ── 第二行 (Y: 138 ~ 224)：编辑、全选与显隐桌面 ──
          uint8_t mod = isMacDevice(currentDevice) ? KEY_BLE_GUI : KEY_BLE_CTRL;
          if (tx < 66) {
            // [1, 0] 复制 (Ctrl+C / Cmd+C)
            state.btnScCopyHighlight = now + 250;
            if (BleCombo.isConnected()) {
              BleCombo.pressKey(mod, 0x06); // 'c' = 0x06
              BleCombo.releaseAllKeys();
            }
            Serial.println("CMD:copy");
            showToast("复制 (Ctrl+C)", 1000);
          } else if (tx >= 66 && tx < 129) {
            // [1, 1] 粘贴 (Ctrl+V / Cmd+V)
            state.btnScPasteHighlight = now + 250;
            if (BleCombo.isConnected()) {
              BleCombo.pressKey(mod, 0x19); // 'v' = 0x19
              BleCombo.releaseAllKeys();
            }
            Serial.println("CMD:paste");
            showToast("粘贴 (Ctrl+V)", 1000);
          } else if (tx >= 129 && tx < 192) {
            // [1, 2] 撤销 (Ctrl+Z / Cmd+Z)
            state.btnScUndoHighlight = now + 250;
            if (BleCombo.isConnected()) {
              BleCombo.pressKey(mod, 0x1D); // 'z' = 0x1D
              BleCombo.releaseAllKeys();
            }
            Serial.println("CMD:undo");
            showToast("撤销 (Ctrl+Z)", 1000);
          } else if (tx >= 192 && tx < 255) {
            // [1, 3] 全选 (Ctrl+A / Cmd+A)
            state.btnScAllHighlight = now + 250;
            if (BleCombo.isConnected()) {
              BleCombo.pressKey(mod, 0x04); // 'a' = 0x04
              BleCombo.releaseAllKeys();
            }
            Serial.println("CMD:select_all");
            showToast("全选 (Ctrl+A)", 1000);
          } else {
            // [1, 4] 桌面 (Win+D / F11)
            state.btnScDeskHighlight = now + 250;
            if (BleCombo.isConnected()) {
              if (isMacDevice(currentDevice)) {
                BleCombo.pressKey(0, 0x44); // F11
              } else {
                BleCombo.pressKey(KEY_BLE_GUI, 0x07); // Win+D
              }
              BleCombo.releaseAllKeys();
            }
            Serial.println("CMD:desktop");
            showToast("显隐桌面 (Win+D)", 1000);
          }
        }
        renderScreen();
        return;
      } else if (currentMode == MODE_TOUCH_MOUSE) {
        // ── 触控鼠标模式底部 3 大按键 ──
        if (tx < 100) {
          // 左下角：鼠标左键单击
          state.btnMouseLeftHighlight = now + 250;
          if (BleCombo.isConnected()) BleCombo.mouseClick(MOUSE_LEFT);
          Serial.println("CMD:mouse_left");
        } else if (tx >= 100 && tx < 192) {
          // 正下方中间：返回语音模式
          state.btnMouseHighlight = now + 250;
          currentMode = activeVoiceMode;
          showToast("已返回语音模式", 1000);
        } else {
          // 右下角：鼠标右键菜单
          state.btnMouseRightHighlight = now + 250;
          if (BleCombo.isConnected()) BleCombo.mouseClick(MOUSE_RIGHT);
          Serial.println("CMD:mouse_right");
        }
        renderScreen();
        return;
      } else if (currentMode == MODE_CORES3_MIC) {
        // ── Tab 1: 云端语音模式 ──
        if (ty >= 185 && tx < 100) {
          // 左下角：无条件【取消】(点亮按键高亮变色 250ms)
          state.btnCancelHighlightUntil = now + 250;
          state.sentNoticeUntil = 0;
          state.sentNoticeState = 0;
          if (state.isRecordingVoice) {
            cancelVoiceRecording();
          } else {
            setEmotion(EMOTION_IDLE, "已取消", 800);
          }
        } else if (ty >= 185 && tx >= 100 && tx < 192) {
          // 正下方中间：一键进入【触控鼠标】模式！
          state.btnMouseHighlight = now + 250;
          currentMode = MODE_TOUCH_MOUSE;
          showToast("高精度触控板", 1000);
        } else if (ty >= 185 && tx >= 192) {
          // 右下角：【完成】发送 (点亮按键高亮变色 250ms)
          state.btnSendHighlightUntil = now + 250;
          if (state.isRecordingVoice) {
            stopVoiceRecording();
          } else {
            startVoiceRecording();
          }
        } else {
          // 上半部分麦克风 (Y < 185 整个超大区域)：点击切换录音/发送
          if (state.isRecordingVoice) {
            stopVoiceRecording();
          } else {
            startVoiceRecording();
          }
        }
        renderScreen();
        return;
      } else {
        // ── Tab 1 子模式: 电脑遥控模式 ──
        // 1. 左下大区域【取消】判定区 (ty >= 185 && tx < 100)
        if (ty >= 185 && tx < 100) {
          state.btnCancelHighlightUntil = now + 250; // 点亮按键高亮变色 250ms
          state.sentNoticeUntil = 0; // 彻底清除任何状态，绝无任何错位绿框！
          state.sentNoticeState = 0;
          bool wasActive = state.isBleVoiceActive;
          state.isBleVoiceActive = false;
          state.pendingReturnTime = 0; // 彻底取消自动回车

          if (BleCombo.isConnected()) {
            if (isMacDevice(currentDevice)) {
              BleCombo.pressKey(0, HID_KEY_ESCAPE);
              BleCombo.releaseAllKeys();
              delay(20);
              BleCombo.pressKey(KEY_BLE_GUI, 0x04); // Cmd+A 全选
              BleCombo.releaseAllKeys();
              delay(30);
              BleCombo.pressKey(0, HID_KEY_BACKSPACE); // Backspace 清空
              BleCombo.releaseAllKeys();
            } else {
              if (wasActive) {
                BleCombo.pressRightAlt();
                BleCombo.releaseRightAlt();
                delay(40);
              }
              BleCombo.pressKey(0, HID_KEY_ESCAPE);
              BleCombo.releaseAllKeys();
              delay(20);
              BleCombo.pressKey(KEY_BLE_CTRL, 0x04); // Ctrl+A 全选
              BleCombo.releaseAllKeys();
              delay(30);
              BleCombo.pressKey(0, HID_KEY_BACKSPACE); // Backspace 清空
              BleCombo.releaseAllKeys();
            }
          }
          if (wasActive) Serial.println("CMD:right_alt");
          Serial.println("CMD:escape");
          Serial.println("CMD:clear_input");
          setEmotion(EMOTION_IDLE, "已清空取消", 1000);
          renderScreen();
          return;
        }

        // 2. 正下方中间【触控鼠标】判定区 (ty >= 185 && tx >= 100 && tx < 192)
        if (ty >= 185 && tx >= 100 && tx < 192) {
          state.btnMouseHighlight = now + 250;
          currentMode = MODE_TOUCH_MOUSE;
          showToast("高精度触控板", 1000);
          renderScreen();
          return;
        }

        // 3. 右下大区域【发送】判定区 (ty >= 185 && tx >= 192)
        if (ty >= 185 && tx >= 192) {
          state.btnSendHighlightUntil = now + 250;
          state.pendingReturnTime = 0;
          bool wasActive = state.isBleVoiceActive;
          state.isBleVoiceActive = false;

          if (BleCombo.isConnected()) {
            if (wasActive && !isMacDevice(currentDevice)) {
              BleCombo.pressRightAlt();
              BleCombo.releaseRightAlt();
              delay(30);
            }
            BleCombo.pressKey(0, BLE_KEY_RETURN);
            BleCombo.releaseAllKeys();
          }
          if (wasActive) Serial.println("CMD:right_alt");
          Serial.println("CMD:enter");
          state.cmdEnterSentTime = now;
          renderScreen();
          return;
        }

        // 4. 上半部分巨大麦克风区域 (ty < 185)：开关语音输入 / 提前发送
        if (state.pendingReturnTime > 0) {
          state.pendingReturnTime = 0;
          if (BleCombo.isConnected()) {
            BleCombo.pressKey(0, BLE_KEY_RETURN);
            BleCombo.releaseAllKeys();
          }
          Serial.println("CMD:enter");
          state.cmdEnterSentTime = now;
        } else if (!state.isBleVoiceActive) {
          state.isBleVoiceActive = true;
          state.bleVoiceStartTime = now;
          if (BleCombo.isConnected()) {
            BleCombo.pressRightAlt();
            BleCombo.releaseRightAlt();
          }
          Serial.println("CMD:right_alt");
        } else {
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
    // 手指离开屏幕，立即复位锁与触控板状态
    if (currentMode == MODE_TOUCH_MOUSE) {
      if (state.mouseTouchStartTime > 0 && (now - state.mouseTouchStartTime < 250)) {
        int ddx = abs(state.mouseLastX - state.mouseTouchStartX);
        int ddy = abs(state.mouseLastY - state.mouseTouchStartY);
        if (ddx < 10 && ddy < 10 && state.mouseTouchStartY < 190 && state.mouseTouchStartX < 268) {
          if (BleCombo.isConnected()) BleCombo.mouseClick(MOUSE_LEFT);
          Serial.println("CMD:mouse_left");
        }
      }
      state.mouseLastX = -1;
      state.mouseLastY = -1;
      state.mouseTouchStartTime = 0;
      state.mouseVisualX = -1;
      state.mouseVisualY = -1;
      renderScreen();
    }
    touchLatched = false;
    tab2PressStart = 0;
    tab2LongTriggered = false;
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
