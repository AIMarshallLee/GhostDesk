#pragma once
#include "protocol.h"
typedef struct { bool armed, session_live; uint32_t lease_until, last_action; char session[17]; } flowdesk_state_t;
void flowdesk_state_init(flowdesk_state_t *s);
void flowdesk_state_disarm(flowdesk_state_t *s);
void flowdesk_state_tick(flowdesk_state_t *s,uint32_t now);
bool flowdesk_state_accept(flowdesk_state_t *s,const flowdesk_command_t*c,uint32_t now,const char**error);
uint32_t flowdesk_state_lease_ms(const flowdesk_state_t*s,uint32_t now);
