#include "SmartWiFi.h"

SmartWiFiClass SmartWiFi;

void SmartWiFiClass::begin() {
  prefs.begin("fd_wifi", false);
  _ssid = prefs.getString("ssid", "");
  _pass = prefs.getString("pass", "");
  prefs.end();

  if (_ssid.length() == 0) {
    // 未配置 Wi-Fi，保持射频休眠，完全零电量消耗
    return;
  }

  // 尝试快速启动并连接一次 (5秒超时，绝不长期占用电量)
  connect(5000);
}

bool SmartWiFiClass::connect(uint32_t timeoutMs) {
  if (_ssid.length() == 0) return false;

  WiFi.mode(WIFI_STA);
  WiFi.begin(_ssid.c_str(), _pass.c_str());

  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {
    delay(100);
  }

  if (WiFi.status() == WL_CONNECTED) {
    _connected = true;
    // 启用 802.11 Modem Sleep 省电机制 (保持网络连接同时节省~80%芯片功耗)
    WiFi.setSleep(true);

    // 自动同步阿里云/全球 NTP 网络标准时间
    configTime(8 * 3600, 0, "ntp.aliyun.com", "pool.ntp.org");
    _timeSynced = true;
    return true;
  } else {
    // 超时未连上：立刻彻底关闭 Wi-Fi 射频，阻止持续重试导致的电量耗尽！
    powerOff();
    return false;
  }
}

void SmartWiFiClass::powerOff() {
  if (_connected) {
    WiFi.disconnect(true);
    _connected = false;
  }
  WiFi.mode(WIFI_OFF);
}

bool SmartWiFiClass::isConnected() {
  if (!_connected) return false;
  return (WiFi.status() == WL_CONNECTED);
}

String SmartWiFiClass::getIP() {
  if (!isConnected()) return "OFF";
  return WiFi.localIP().toString();
}

int SmartWiFiClass::getRSSI() {
  if (!isConnected()) return 0;
  return WiFi.RSSI();
}

String SmartWiFiClass::getTimeStr() {
  time_t now;
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 50)) {
    return "";
  }
  char buf[16];
  snprintf(buf, sizeof(buf), "%02d:%02d", timeinfo.tm_hour, timeinfo.tm_min);
  return String(buf);
}

void SmartWiFiClass::setCredentials(const String& ssid, const String& pass) {
  _ssid = ssid;
  _pass = pass;
  prefs.begin("fd_wifi", false);
  prefs.putString("ssid", _ssid);
  prefs.putString("pass", _pass);
  prefs.end();
}
