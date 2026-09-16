#include "bridge_state.h"
#include <string.h>
static bool due(uint32_t n,uint32_t t){return (int32_t)(n-t)>=0;}
void flowdesk_state_init(flowdesk_state_t*s){memset(s,0,sizeof(*s));}
void flowdesk_state_disarm(flowdesk_state_t*s){s->armed=false;s->session_live=false;s->session[0]=0;s->last_action=0;}
void flowdesk_state_tick(flowdesk_state_t*s,uint32_t n){if(s->session_live&&due(n,s->lease_until))flowdesk_state_disarm(s);}
bool flowdesk_state_accept(flowdesk_state_t*s,const flowdesk_command_t*c,uint32_t n,const char**e){flowdesk_state_tick(s,n);if(c->kind==FLOWDESK_HELLO||c->kind==FLOWDESK_STATUS||c->kind==FLOWDESK_DISARM)return true;if(c->kind==FLOWDESK_BEGIN){if(s->session_live){*e="session";return false;}memcpy(s->session,c->session,17);s->armed=true;s->session_live=true;s->lease_until=n+10000;s->last_action=0;return true;}if(!s->session_live||strcmp(s->session,c->session)){*e="session";return false;}if(c->kind==FLOWDESK_PING){s->lease_until=n+10000;return true;}if(c->id<=s->last_action){*e="replay";return false;}s->last_action=c->id;return true;}
uint32_t flowdesk_state_lease_ms(const flowdesk_state_t*s,uint32_t n){return s->session_live&&!due(n,s->lease_until)?s->lease_until-n:0;}
