#include "pico/stdlib.h"
#include "protocol.h"
#include "bridge_state.h"
#include "tusb.h"
#include "bsp/board.h"
#include <stdio.h>

#define LED_PIN 25
#define QUEUE_CAPACITY 8

static flowdesk_command_t queue[QUEUE_CAPACITY]; static uint8_t q_read, q_write, q_count;
static flowdesk_state_t state; static bool cdc_dtr, active, completing, disarm_ack, report_in_flight, aborting; static uint8_t release_pending; static uint32_t due_at;
static flowdesk_command_t current; static bool pressed; static uint8_t char_at;
static char frame[FLOWDESK_FRAME_MAX + 1]; static uint16_t frame_len; static bool discarding;
typedef enum { REPORT_NONE, REPORT_RELEASE_KEYBOARD, REPORT_RELEASE_MOUSE, REPORT_ACTION_PRESS, REPORT_ACTION_RELEASE, REPORT_ACTION_ONESHOT } report_step_t;
static report_step_t report_step;
static void discard_serial(void);

static bool elapsed(uint32_t now, uint32_t target) { return (int32_t)(now - target) >= 0; }
static void release_all(void) { release_pending = 3; }
static bool reply(uint32_t id, bool ok, const char *error) {
  char out[512];
  int n = error
    ? snprintf(out, sizeof(out), "{\"id\":%lu,\"ok\":%s,\"protocol\":4,\"device\":\"FlowDesk USB Bridge\",\"firmware\":\"0.5.0\",\"board\":\"pico\",\"armed\":%s,\"session\":\"%s\",\"leaseMs\":%lu,\"error\":\"%s\"}\n", (unsigned long)id, ok ? "true" : "false", state.armed ? "true" : "false", state.session_live ? state.session : "", (unsigned long)flowdesk_state_lease_ms(&state,to_ms_since_boot(get_absolute_time())), error)
    : snprintf(out, sizeof(out), "{\"id\":%lu,\"ok\":%s,\"protocol\":4,\"device\":\"FlowDesk USB Bridge\",\"firmware\":\"0.5.0\",\"board\":\"pico\",\"armed\":%s,\"session\":\"%s\",\"leaseMs\":%lu}\n", (unsigned long)id, ok ? "true" : "false", state.armed ? "true" : "false", state.session_live ? state.session : "", (unsigned long)flowdesk_state_lease_ms(&state,to_ms_since_boot(get_absolute_time())));
  if (n < 0 || n >= (int)sizeof(out) || tud_cdc_write_available() < (uint32_t)n) return false;
  if (tud_cdc_write(out, (uint32_t)n) != (uint32_t)n) return false;
  tud_cdc_write_flush();
  return true;
}
static void disarm(void) { flowdesk_state_disarm(&state); active = false; completing = false; disarm_ack = false; pressed = false; q_read = q_write = q_count = 0; aborting = report_in_flight; release_all(); }
// A USB bus unmount never relies on CDC line state; it only clears device-side state.
static void bus_disarm(void) { cdc_dtr = false; frame_len = 0; discarding = false; report_in_flight = false; report_step = REPORT_NONE; aborting = false; disarm(); }
void tud_umount_cb(void) { bus_disarm(); }
void tud_suspend_cb(bool remote_wakeup_en) { (void)remote_wakeup_en; bus_disarm(); }
void tud_cdc_line_state_cb(uint8_t itf, bool dtr, bool rts) {
  (void)rts;
  if (itf != 0) return;
  cdc_dtr = dtr;
  discard_serial();
  if (!dtr) disarm();
}
static bool enqueue(const flowdesk_command_t *command) { if (q_count == QUEUE_CAPACITY) return false; queue[q_write] = *command; q_write = (q_write + 1) % QUEUE_CAPACITY; ++q_count; return true; }

static bool ascii_key(char ch, uint8_t *modifier, uint8_t *keycode) {
  *modifier = 0; if (ch >= 'a' && ch <= 'z') { *keycode = HID_KEY_A + ch - 'a'; return true; }
  if (ch >= 'A' && ch <= 'Z') { *modifier = KEYBOARD_MODIFIER_LEFTSHIFT; *keycode = HID_KEY_A + ch - 'A'; return true; }
  if (ch >= '1' && ch <= '9') { *keycode = HID_KEY_1 + ch - '1'; return true; } if (ch == '0') { *keycode = HID_KEY_0; return true; }
  if (ch == ' ') { *keycode = HID_KEY_SPACE; return true; } if (ch == '-') { *keycode = HID_KEY_MINUS; return true; } if (ch == '=') { *keycode = HID_KEY_EQUAL; return true; }
  if (ch == '[') { *keycode = HID_KEY_BRACKET_LEFT; return true; } if (ch == ']') { *keycode = HID_KEY_BRACKET_RIGHT; return true; } if (ch == '\\') { *keycode = HID_KEY_BACKSLASH; return true; }
  if (ch == ';') { *keycode = HID_KEY_SEMICOLON; return true; } if (ch == '\'') { *keycode = HID_KEY_APOSTROPHE; return true; } if (ch == '`') { *keycode = HID_KEY_GRAVE; return true; }
  if (ch == ',') { *keycode = HID_KEY_COMMA; return true; } if (ch == '.') { *keycode = HID_KEY_PERIOD; return true; } if (ch == '/') { *keycode = HID_KEY_SLASH; return true; }
  *modifier = KEYBOARD_MODIFIER_LEFTSHIFT;
  switch (ch) { case '!': *keycode = HID_KEY_1; break; case '@': *keycode = HID_KEY_2; break; case '#': *keycode = HID_KEY_3; break; case '$': *keycode = HID_KEY_4; break; case '%': *keycode = HID_KEY_5; break; case '^': *keycode = HID_KEY_6; break; case '&': *keycode = HID_KEY_7; break; case '*': *keycode = HID_KEY_8; break; case '(': *keycode = HID_KEY_9; break; case ')': *keycode = HID_KEY_0; break; case '_': *keycode = HID_KEY_MINUS; break; case '+': *keycode = HID_KEY_EQUAL; break; case '{': *keycode = HID_KEY_BRACKET_LEFT; break; case '}': *keycode = HID_KEY_BRACKET_RIGHT; break; case '|': *keycode = HID_KEY_BACKSLASH; break; case ':': *keycode = HID_KEY_SEMICOLON; break; case '\"': *keycode = HID_KEY_APOSTROPHE; break; case '~': *keycode = HID_KEY_GRAVE; break; case '<': *keycode = HID_KEY_COMMA; break; case '>': *keycode = HID_KEY_PERIOD; break; case '?': *keycode = HID_KEY_SLASH; break; default: return false; }
  return true;
}
static void finish(void) { completing = true; }
static bool send_keyboard(uint8_t modifier, uint8_t const keycode[6], report_step_t step) { if (!tud_hid_keyboard_report(1, modifier, keycode)) return false; report_in_flight = true; report_step = step; return true; }
static bool send_mouse(uint8_t buttons, int8_t x, int8_t y, int8_t wheel, int8_t pan, report_step_t step) { if (!tud_hid_mouse_report(2, buttons, x, y, wheel, pan)) return false; report_in_flight = true; report_step = step; return true; }
void tud_hid_report_complete_cb(uint8_t instance, uint8_t const *report, uint16_t len) {
  (void)instance; (void)report; (void)len;
  if (!report_in_flight) return;
  report_in_flight = false;
  if (aborting) { aborting = false; report_step = REPORT_NONE; return; }
  uint32_t now = to_ms_since_boot(get_absolute_time());
  switch (report_step) {
    case REPORT_RELEASE_KEYBOARD: release_pending &= ~1; break;
    case REPORT_RELEASE_MOUSE: release_pending &= ~2; break;
    case REPORT_ACTION_PRESS: pressed = true; due_at = now + (current.kind == FLOWDESK_TEXT ? 3 : 5); break;
    case REPORT_ACTION_RELEASE: if (current.kind == FLOWDESK_TEXT) { pressed = false; ++char_at; due_at = now + 3; } else finish(); break;
    case REPORT_ACTION_ONESHOT: finish(); break;
    default: break;
  }
  report_step = REPORT_NONE;
}
static void run_hid(uint32_t now) {
  if (report_in_flight) return;
  if (release_pending) {
    if (!tud_hid_ready()) return;
    if (release_pending & 1) { send_keyboard(0, NULL, REPORT_RELEASE_KEYBOARD); return; }
    if (release_pending & 2) send_mouse(0, 0, 0, 0, 0, REPORT_RELEASE_MOUSE);
    return;
  }
  if (completing) { if (reply(current.id, true, NULL)) { completing = false; disarm_ack = false; active = false; } return; }
  if (!active || !elapsed(now, due_at)) return;
  // Once a press report has been accepted, never abandon its matching release
  // merely because the endpoint is temporarily busy.
  if (!tud_hid_ready()) { if (pressed) return; if (reply(current.id, false, "notready")) active = false; return; }
  if (current.kind == FLOWDESK_MOVE) { send_mouse(0, current.x, current.y, 0, 0, REPORT_ACTION_ONESHOT); return; }
  if (current.kind == FLOWDESK_WHEEL) { send_mouse(0, 0, 0, current.y, 0, REPORT_ACTION_ONESHOT); return; }
  if (current.kind == FLOWDESK_CLICK) { send_mouse(pressed ? 0 : (current.right ? MOUSE_BUTTON_RIGHT : MOUSE_BUTTON_LEFT), 0, 0, 0, 0, pressed ? REPORT_ACTION_RELEASE : REPORT_ACTION_PRESS); return; }
  if (current.kind == FLOWDESK_PASTE) { uint8_t keys[6] = { HID_KEY_V }; send_keyboard(pressed ? 0 : KEYBOARD_MODIFIER_LEFTCTRL, pressed ? NULL : keys, pressed ? REPORT_ACTION_RELEASE : REPORT_ACTION_PRESS); return; }
  if (current.kind == FLOWDESK_KEY) { static const uint8_t keys[]={HID_KEY_ENTER,HID_KEY_TAB,HID_KEY_BACKSPACE,HID_KEY_DELETE,HID_KEY_ARROW_LEFT,HID_KEY_ARROW_RIGHT,HID_KEY_ARROW_UP,HID_KEY_ARROW_DOWN,HID_KEY_HOME,HID_KEY_END,HID_KEY_A,0,HID_KEY_ESCAPE,HID_KEY_PAGE_DOWN}; uint8_t k[6]={keys[current.key]}; uint8_t mod=current.key==FLOWDESK_KEY_CTRL_A?KEYBOARD_MODIFIER_LEFTCTRL:current.key==FLOWDESK_KEY_SHIFT?KEYBOARD_MODIFIER_LEFTSHIFT:0; send_keyboard(pressed?0:mod,pressed?NULL:k,pressed ? REPORT_ACTION_RELEASE : REPORT_ACTION_PRESS); return; }
  if (current.kind == FLOWDESK_TEXT) { if (!pressed && !current.text[char_at]) { finish(); return; } uint8_t mod, key, keys[6] = { 0 }; if (!ascii_key(current.text[char_at], &mod, &key)) { if (reply(current.id, false, "unsupported")) active = false; return; } keys[0] = key; send_keyboard(pressed ? 0 : mod, pressed ? NULL : keys, pressed ? REPORT_ACTION_RELEASE : REPORT_ACTION_PRESS); }
}
static void process_queue(uint32_t now) {
  if (active || !q_count) return; current = queue[q_read]; q_read = (q_read + 1) % QUEUE_CAPACITY; --q_count;
  if (current.kind == FLOWDESK_HELLO || current.kind == FLOWDESK_STATUS) { reply(current.id, true, NULL); return; }
  if (current.kind == FLOWDESK_DISARM) { disarm(); active = true; completing = true; disarm_ack = true; return; }
  active = true; pressed = false; char_at = 0; due_at = now;
}
static void discard_serial(void) {
  char ch;
  while (tud_cdc_available()) tud_cdc_read(&ch, 1);
  frame_len = 0;
  discarding = false;
}
static void consume_serial(void) {
  if (!cdc_dtr) { discard_serial(); return; }
  while (tud_cdc_available()) { char ch; tud_cdc_read(&ch, 1); if (ch == '\r') continue; if (ch == '\n') { if (!discarding && frame_len) { flowdesk_command_t c; const char *err; uint32_t now=to_ms_since_boot(get_absolute_time()); if (flowdesk_parse_frame(frame, frame_len, &c, &err)) { if (c.kind == FLOWDESK_DISARM) { disarm(); current=c; active=true; completing=true; disarm_ack=true; } else if (c.kind == FLOWDESK_HELLO || c.kind == FLOWDESK_STATUS) reply(c.id, true, NULL); else if (c.kind == FLOWDESK_BEGIN || c.kind == FLOWDESK_PING) { if (flowdesk_state_accept(&state,&c,now,&err)) reply(c.id,true,NULL); else reply(c.id,false,err); } else if (q_count == QUEUE_CAPACITY) reply(c.id, false, "busy"); else if (!flowdesk_state_accept(&state,&c,now,&err)) reply(c.id,false,err); else if (!enqueue(&c)) reply(c.id, false, "busy"); } else reply(0, false, err); } frame_len = 0; discarding = false; continue; } if (discarding) continue; if (frame_len >= FLOWDESK_FRAME_MAX) { discarding = true; continue; } frame[frame_len++] = ch; }
}
static void expiry_tick(uint32_t now) {
  bool was_armed = state.armed;
  flowdesk_state_tick(&state, now);
  if ((was_armed && !state.armed) || (!state.armed && (q_count || (active && !disarm_ack)))) disarm();
}
int main(void) {
  flowdesk_state_init(&state); gpio_init(LED_PIN); gpio_set_dir(LED_PIN, GPIO_OUT); board_init(); tusb_init();
  while (true) { tud_task(); uint32_t now = to_ms_since_boot(get_absolute_time()); expiry_tick(now); gpio_put(LED_PIN, state.armed); consume_serial(); process_queue(now); run_hid(now); sleep_ms(1); }
}
