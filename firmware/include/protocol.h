#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#define FLOWDESK_FRAME_MAX 160
#define FLOWDESK_TEXT_MAX 64
#define FLOWDESK_SESSION_HEX 16
typedef enum { FLOWDESK_HELLO, FLOWDESK_STATUS, FLOWDESK_DISARM, FLOWDESK_BEGIN, FLOWDESK_PING, FLOWDESK_MOVE, FLOWDESK_CLICK, FLOWDESK_WHEEL, FLOWDESK_PASTE, FLOWDESK_KEY, FLOWDESK_TEXT } flowdesk_command_kind_t;
typedef enum { FLOWDESK_KEY_ENTER, FLOWDESK_KEY_TAB, FLOWDESK_KEY_BACKSPACE, FLOWDESK_KEY_DELETE, FLOWDESK_KEY_LEFT, FLOWDESK_KEY_RIGHT, FLOWDESK_KEY_UP, FLOWDESK_KEY_DOWN, FLOWDESK_KEY_HOME, FLOWDESK_KEY_END, FLOWDESK_KEY_CTRL_A, FLOWDESK_KEY_SHIFT, FLOWDESK_KEY_ESCAPE, FLOWDESK_KEY_PAGEDOWN } flowdesk_key_t;
typedef struct { uint32_t id; flowdesk_command_kind_t kind; char session[FLOWDESK_SESSION_HEX + 1]; int8_t x, y; bool right; flowdesk_key_t key; char text[FLOWDESK_TEXT_MAX + 1]; } flowdesk_command_t;
bool flowdesk_parse_frame(const char *frame, size_t length, flowdesk_command_t *out, const char **error);
