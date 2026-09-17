#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <Preferences.h>
#include <time.h>

class SmartWiFiClass {
private:
  Preferences prefs;
  String _ssid = "";
  String _pass = "";
  bool _connected = false;
  bool _timeSynced = false;

public:
  void begin();
  bool connect(uint32_t timeoutMs = 5000);
  void powerOff();
  bool isConnected();
  String getIP();
  int getRSSI();
  String getTimeStr(); // 返回 HH:MM 格式时间 (若已同步)
  void setCredentials(const String& ssid, const String& pass);
  String getSSID() const { return _ssid; }
};

extern SmartWiFiClass SmartWiFi;
