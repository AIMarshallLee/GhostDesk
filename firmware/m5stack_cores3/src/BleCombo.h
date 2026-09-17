#pragma once
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include "BLEHIDDevice.h"
#include "HIDTypes.h"
#include <BLE2902.h>

// 标准 HID 报文描述符 (键盘 + 鼠标 + 消费级多媒体)
static const uint8_t _hidReportDescriptor[] = {
  // 键盘报文 (Report ID = 1)
  0x05, 0x01,                    // USAGE_PAGE (Generic Desktop)
  0x09, 0x06,                    // USAGE (Keyboard)
  0xa1, 0x01,                    // COLLECTION (Application)
  0x85, 0x01,                    //   REPORT_ID (1)
  0x05, 0x07,                    //   USAGE_PAGE (Keyboard)
  0x19, 0xe0,                    //   USAGE_MINIMUM (Keyboard LeftControl)
  0x29, 0xe7,                    //   USAGE_MAXIMUM (Keyboard Right GUI)
  0x15, 0x00,                    //   LOGICAL_MINIMUM (0)
  0x25, 0x01,                    //   LOGICAL_MAXIMUM (1)
  0x75, 0x01,                    //   REPORT_SIZE (1)
  0x95, 0x08,                    //   REPORT_COUNT (8)
  0x81, 0x02,                    //   INPUT (Data,Var,Abs)
  0x95, 0x01,                    //   REPORT_COUNT (1)
  0x75, 0x08,                    //   REPORT_SIZE (8)
  0x81, 0x01,                    //   INPUT (Cnst,Ary,Abs)
  0x95, 0x06,                    //   REPORT_COUNT (6)
  0x75, 0x08,                    //   REPORT_SIZE (8)
  0x15, 0x00,                    //   LOGICAL_MINIMUM (0)
  0x25, 0x65,                    //   LOGICAL_MAXIMUM (101)
  0x05, 0x07,                    //   USAGE_PAGE (Keyboard)
  0x19, 0x00,                    //   USAGE_MINIMUM (Reserved)
  0x29, 0x65,                    //   USAGE_MAXIMUM (Keyboard Application)
  0x81, 0x00,                    //   INPUT (Data,Ary,Abs)
  0xc0,                          // END_COLLECTION

  // 鼠标报文 (Report ID = 2)
  0x05, 0x01,                    // USAGE_PAGE (Generic Desktop)
  0x09, 0x02,                    // USAGE (Mouse)
  0xa1, 0x01,                    // COLLECTION (Application)
  0x85, 0x02,                    //   REPORT_ID (2)
  0x09, 0x01,                    //   USAGE (Pointer)
  0xa1, 0x00,                    //   COLLECTION (Physical)
  0x05, 0x09,                    //     USAGE_PAGE (Button)
  0x19, 0x01,                    //     USAGE_MINIMUM (Button 1)
  0x29, 0x03,                    //     USAGE_MAXIMUM (Button 3)
  0x15, 0x00,                    //     LOGICAL_MINIMUM (0)
  0x25, 0x01,                    //     LOGICAL_MAXIMUM (1)
  0x75, 0x01,                    //     REPORT_SIZE (1)
  0x95, 0x03,                    //     REPORT_COUNT (3)
  0x81, 0x02,                    //     INPUT (Data,Var,Abs)
  0x75, 0x05,                    //     REPORT_SIZE (5)
  0x95, 0x01,                    //     REPORT_COUNT (1)
  0x81, 0x01,                    //     INPUT (Cnst,Ary,Abs)
  0x05, 0x01,                    //     USAGE_PAGE (Generic Desktop)
  0x09, 0x30,                    //     USAGE (X)
  0x09, 0x31,                    //     USAGE (Y)
  0x09, 0x38,                    //     USAGE (Wheel)
  0x15, 0x81,                    //     LOGICAL_MINIMUM (-127)
  0x25, 0x7f,                    //     LOGICAL_MAXIMUM (127)
  0x75, 0x08,                    //     REPORT_SIZE (8)
  0x95, 0x03,                    //     REPORT_COUNT (3)
  0x81, 0x06,                    //     INPUT (Data,Var,Rel)
  0xc0,                          //   END_COLLECTION
  0xc0,                          // END_COLLECTION

  // 多媒体报文 (Report ID = 3)
  0x05, 0x0c,                    // USAGE_PAGE (Consumer Devices)
  0x09, 0x01,                    // USAGE (Consumer Control)
  0xa1, 0x01,                    // COLLECTION (Application)
  0x85, 0x03,                    //   REPORT_ID (3)
  0x15, 0x00,                    //   LOGICAL_MINIMUM (0)
  0x26, 0xff, 0x03,              //   LOGICAL_MAXIMUM (1023)
  0x19, 0x00,                    //   USAGE_MINIMUM (0)
  0x2a, 0xff, 0x03,              //   USAGE_MAXIMUM (1023)
  0x75, 0x10,                    //   REPORT_SIZE (16)
  0x95, 0x01,                    //   REPORT_COUNT (1)
  0x81, 0x00,                    //   INPUT (Data,Ary,Abs)
  0xc0                           // END_COLLECTION
};

#define BLE_KEY_REPORT_ID   1
#define BLE_MOUSE_REPORT_ID 2
#define BLE_MEDIA_REPORT_ID 3

// BLE HID Modifiers
#define KEY_BLE_CTRL        0x01
#define KEY_BLE_SHIFT       0x02
#define KEY_BLE_ALT         0x04
#define KEY_BLE_GUI         0x08
#define KEY_BLE_RIGHT_CTRL  0x10
#define KEY_BLE_RIGHT_SHIFT 0x20
#define KEY_BLE_RIGHT_ALT   0x40
#define KEY_BLE_RIGHT_GUI   0x80

// Standard HID Usage IDs
#define HID_KEY_RETURN      0x28
#define HID_KEY_ESCAPE      0x29
#define HID_KEY_BACKSPACE   0x2A
#define HID_KEY_TAB         0x2B
#define HID_KEY_SPACE       0x2C
#define HID_KEY_RIGHT_ARROW 0x4F
#define HID_KEY_LEFT_ARROW  0x50
#define HID_KEY_DOWN_ARROW  0x51
#define HID_KEY_UP_ARROW    0x52
#define HID_KEY_DELETE      0x4C

// Consumer Control Codes (16-bit)
#define BLE_MEDIA_PLAY_PAUSE    0x00CD
#define BLE_MEDIA_NEXT          0x00B5
#define BLE_MEDIA_PREV          0x00B6
#define BLE_MEDIA_MUTE          0x00E2
#define BLE_MEDIA_VOLUME_UP     0x00E9
#define BLE_MEDIA_VOLUME_DOWN   0x00EA
#define BLE_MEDIA_HOME          0x0223

struct BleKeyReport {
  uint8_t modifiers;
  uint8_t reserved;
  uint8_t keys[6];
};

struct BleMouseReport {
  uint8_t buttons;
  int8_t x;
  int8_t y;
  int8_t wheel;
};

class BleComboServerCallbacks : public BLEServerCallbacks {
public:
  bool* connected;
  BleComboServerCallbacks(bool* c) : connected(c) {}
  void onConnect(BLEServer* pServer) override {
    *connected = true;
    BLEDevice::startAdvertising();
  }
  void onDisconnect(BLEServer* pServer) override {
    *connected = false;
    BLEDevice::startAdvertising();
  }
};

class BleComboClass {
private:
  BLEServer* pServer = nullptr;
  BLEHIDDevice* pHid = nullptr;
  BLECharacteristic* inputKeyboard = nullptr;
  BLECharacteristic* inputMouse = nullptr;
  BLECharacteristic* inputMedia = nullptr;
  bool _connected = false;
  BleKeyReport _keyReport = {0, 0, {0}};
  uint8_t _mouseButtons = 0;

public:
  void begin(const std::string& deviceName = "FlowDesk CyberDeck") {
    BLEDevice::init(deviceName);
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new BleComboServerCallbacks(&_connected));

    pHid = new BLEHIDDevice(pServer);
    inputKeyboard = pHid->inputReport(BLE_KEY_REPORT_ID);
    inputMouse = pHid->inputReport(BLE_MOUSE_REPORT_ID);
    inputMedia = pHid->inputReport(BLE_MEDIA_REPORT_ID);

    pHid->manufacturer()->setValue("FlowDesk");
    pHid->pnp(0x02, 0xCAFE, 0x4002, 0x0100);
    pHid->hidInfo(0x00, 0x01);
    pHid->reportMap((uint8_t*)_hidReportDescriptor, sizeof(_hidReportDescriptor));
    pHid->startServices();

    BLESecurity *pSecurity = new BLESecurity();
    pSecurity->setAuthenticationMode(ESP_LE_AUTH_BOND);

    BLEAdvertising *pAdvertising = pServer->getAdvertising();
    pAdvertising->setAppearance(HID_KEYBOARD);
    pAdvertising->addServiceUUID(pHid->hidService()->getUUID());
    pAdvertising->setScanResponse(true);
    pAdvertising->start();
  }

  bool isConnected() const {
    return _connected;
  }

  void sendKeyReport() {
    if (!_connected || !inputKeyboard) return;
    inputKeyboard->setValue((uint8_t*)&_keyReport, sizeof(BleKeyReport));
    inputKeyboard->notify();
  }

  void pressKey(uint8_t mod, uint8_t key) {
    _keyReport.modifiers |= mod;
    for (int i = 0; i < 6; ++i) {
      if (_keyReport.keys[i] == 0) {
        _keyReport.keys[i] = key;
        break;
      }
    }
    sendKeyReport();
  }

  void releaseKey(uint8_t mod, uint8_t key) {
    _keyReport.modifiers &= ~mod;
    for (int i = 0; i < 6; ++i) {
      if (_keyReport.keys[i] == key) _keyReport.keys[i] = 0;
    }
    sendKeyReport();
  }

  void releaseAllKeys() {
    memset(&_keyReport, 0, sizeof(_keyReport));
    sendKeyReport();
  }

  void writeKey(uint8_t mod, uint8_t key) {
    pressKey(mod, key);
    delay(15);
    releaseAllKeys();
  }

  void moveMouse(int8_t x, int8_t y, int8_t wheel = 0) {
    if (!_connected || !inputMouse) return;
    BleMouseReport r = {_mouseButtons, x, y, wheel};
    inputMouse->setValue((uint8_t*)&r, sizeof(BleMouseReport));
    inputMouse->notify();
  }

  void mouseClick(uint8_t btn) {
    if (!_connected || !inputMouse) return;
    _mouseButtons |= btn;
    moveMouse(0, 0, 0);
    delay(15);
    _mouseButtons &= ~btn;
    moveMouse(0, 0, 0);
  }

  void mousePress(uint8_t btn);
  void mouseRelease(uint8_t btn);
  void print(const String& s);

  void sendMedia(uint16_t code) {
    if (!_connected || !inputMedia) return;
    uint8_t buf[2] = {(uint8_t)(code & 0xFF), (uint8_t)((code >> 8) & 0xFF)};
    inputMedia->setValue(buf, 2);
    inputMedia->notify();
    delay(20);
    uint8_t zero[2] = {0, 0};
    inputMedia->setValue(zero, 2);
    inputMedia->notify();
  }
};

extern BleComboClass BleCombo;
