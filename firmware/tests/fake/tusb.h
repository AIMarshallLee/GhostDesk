#pragma once
#include <stdbool.h>
#include <stdint.h>
void tusb_init(void); void tud_task(void); bool tud_hid_ready(void);
bool tud_hid_keyboard_report(uint8_t id,uint8_t mod,uint8_t const keys[6]);
bool tud_hid_mouse_report(uint8_t id,uint8_t buttons,int8_t x,int8_t y,int8_t wheel,int8_t pan);
uint32_t tud_cdc_write_available(void); uint32_t tud_cdc_write(void const*data,uint32_t len); void tud_cdc_write_flush(void);
uint32_t tud_cdc_available(void); uint32_t tud_cdc_read(void*data,uint32_t len);
#define HID_KEY_A 4
#define HID_KEY_1 30
#define HID_KEY_2 31
#define HID_KEY_3 32
#define HID_KEY_4 33
#define HID_KEY_5 34
#define HID_KEY_6 35
#define HID_KEY_7 36
#define HID_KEY_8 37
#define HID_KEY_9 38
#define HID_KEY_0 39
#define HID_KEY_SPACE 44
#define HID_KEY_MINUS 45
#define HID_KEY_EQUAL 46
#define HID_KEY_BRACKET_LEFT 47
#define HID_KEY_BRACKET_RIGHT 48
#define HID_KEY_BACKSLASH 49
#define HID_KEY_SEMICOLON 51
#define HID_KEY_APOSTROPHE 52
#define HID_KEY_GRAVE 53
#define HID_KEY_COMMA 54
#define HID_KEY_PERIOD 55
#define HID_KEY_SLASH 56
#define HID_KEY_V 25
#define HID_KEY_ENTER 40
#define HID_KEY_TAB 43
#define HID_KEY_BACKSPACE 42
#define HID_KEY_DELETE 76
#define HID_KEY_ARROW_LEFT 80
#define HID_KEY_ARROW_RIGHT 79
#define HID_KEY_ARROW_UP 82
#define HID_KEY_ARROW_DOWN 81
#define HID_KEY_HOME 74
#define HID_KEY_END 77
#define HID_KEY_ESCAPE 41
#define HID_KEY_PAGE_DOWN 78
#define HID_KEY_SHIFT_LEFT 225
#define KEYBOARD_MODIFIER_LEFTSHIFT 2
#define KEYBOARD_MODIFIER_LEFTCTRL 1
#define MOUSE_BUTTON_RIGHT 2
#define MOUSE_BUTTON_LEFT 1
