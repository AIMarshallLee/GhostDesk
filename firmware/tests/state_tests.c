#include "bridge_state.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>
static flowdesk_command_t cmd(uint32_t id, flowdesk_command_kind_t kind) {
  flowdesk_command_t c={.id=id,.kind=kind}; strcpy(c.session,"0123456789abcdef"); return c;
}
int main(void) {
  flowdesk_state_t s; const char *error;
  flowdesk_state_init(&s);
  flowdesk_command_t begin=cmd(1,FLOWDESK_BEGIN), action=cmd(4,FLOWDESK_MOVE), ping=cmd(5,FLOWDESK_PING);
  assert(flowdesk_state_accept(&s,&begin,0,&error)&&s.armed);
  assert(!flowdesk_state_accept(&s,&begin,1,&error)&&!strcmp(error,"session"));
  assert(flowdesk_state_accept(&s,&action,2,&error));
  assert(!flowdesk_state_accept(&s,&action,3,&error)&&!strcmp(error,"replay"));
  for(uint32_t now=2000;now<=120000;now+=2000) {
    assert(flowdesk_state_accept(&s,&ping,now,&error));
    flowdesk_state_tick(&s,now+1); assert(s.session_live&&s.armed);
  }
  flowdesk_state_tick(&s,130000); assert(!s.session_live&&!s.armed);
  assert(!flowdesk_state_accept(&s,&ping,130001,&error));
  assert(flowdesk_state_accept(&s,&begin,210001,&error));
  flowdesk_state_disarm(&s); assert(!s.session_live&&!s.armed);
  puts("firmware state tests passed: software begin, replay, 120s heartbeat, lease expiry, no ping rearm");
  return 0;
}
