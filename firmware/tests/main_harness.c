#include <assert.h>
#include <string.h>
#include <stdint.h>
#include <stdio.h>
static uint32_t fake_now, replies, reports;
static const char *input;
static char last_reply[512];
static _Bool endpoint_ready = 1;
typedef struct { uint8_t id, mod, key, buttons; int8_t x,y,wheel; } report_t;
static report_t history[256];
uint32_t to_ms_since_boot(uint32_t t){return t;}
uint32_t get_absolute_time(void){return fake_now;}
void sleep_ms(uint32_t n){(void)n;}
void gpio_init(uint32_t p){(void)p;}
void gpio_set_dir(uint32_t p,_Bool d){(void)p;(void)d;}
void gpio_pull_up(uint32_t p){(void)p;}
_Bool gpio_get(uint32_t p){(void)p;return 1;}
void gpio_put(uint32_t p,_Bool v){(void)p;(void)v;}
void board_init(void){} void tusb_init(void){} void tud_task(void){}
_Bool tud_hid_ready(void){return endpoint_ready;}
_Bool tud_hid_keyboard_report(uint8_t i,uint8_t m,uint8_t const*k){
  assert(reports<256); history[reports++]=(report_t){.id=i,.mod=m,.key=k?k[0]:0}; return 1;
}
_Bool tud_hid_mouse_report(uint8_t i,uint8_t b,int8_t x,int8_t y,int8_t w,int8_t p){
  (void)p; assert(reports<256); history[reports++]=(report_t){.id=i,.buttons=b,.x=x,.y=y,.wheel=w}; return 1;
}
uint32_t tud_cdc_write_available(void){return 256;}
uint32_t tud_cdc_write(void const*d,uint32_t n){assert(n<sizeof(last_reply));memcpy(last_reply,d,n);last_reply[n]=0;++replies;return n;}
void tud_cdc_write_flush(void){}
uint32_t tud_cdc_available(void){return input&&*input?1:0;}
uint32_t tud_cdc_read(void*d,uint32_t n){if(!input||!n)return 0;*(char*)d=*input++;return 1;}
#define main firmware_main
#include "../src/main.c"
#undef main
static void reset(void){
  memset(queue,0,sizeof(queue)); memset(history,0,sizeof(history));
  memset(&current,0,sizeof(current)); flowdesk_state_init(&state);
  q_read=q_write=q_count=0; active=completing=disarm_ack=report_in_flight=aborting=pressed=false;
  release_pending=char_at=frame_len=0; discarding=false; report_step=REPORT_NONE;
  replies=reports=fake_now=due_at=0; input=NULL; endpoint_ready=1; cdc_dtr=false; last_reply[0]=0;
}
static void loop(void){expiry_tick(fake_now);process_queue(fake_now);run_hid(fake_now);}
static void complete(void){assert(report_in_flight);tud_hid_report_complete_cb(0,NULL,0);}
static void receive(const char *s){input=s;consume_serial();}
static void begin(void){reset();tud_cdc_line_state_cb(0,true,false);receive("1\tbegin\t0123456789abcdef\n");assert(state.session_live&&state.armed&&replies==1&&strstr(last_reply,"\"protocol\":4")&&strstr(last_reply,"\"firmware\":\"0.5.0\""));replies=0;}
static void key_and_ack(const char *name,uint8_t modifier,uint8_t keycode){char line[96];begin();snprintf(line,sizeof(line),"2\tkey\t0123456789abcdef\t%s\n",name);receive(line);loop();assert(reports==1&&replies==0&&history[0].id==1&&history[0].mod==modifier&&history[0].key==keycode);complete();fake_now+=5;loop();assert(reports==2&&replies==0&&history[1].id==1&&history[1].mod==0&&history[1].key==0);complete();loop();assert(replies==1&&strstr(last_reply,"\"id\":2"));}
static void release_and_ack(void){
  loop(); assert(report_in_flight&&replies==0); complete();
  loop(); assert(report_in_flight&&replies==0); complete();
  loop(); assert(replies==1&&!active&&!state.armed&&!state.session_live);
}
int main(void){
  reset(); tud_cdc_line_state_cb(0,true,false); receive("1\thello\n2\tstatus\n3\tping\t0123456789abcdef\n"); assert(!state.armed&&!state.session_live&&replies==3&&strstr(last_reply,"session"));
  reset(); tud_cdc_line_state_cb(0,true,false); receive("1\tbegin\t0123456789abcdef\n2\tbegin\tfedcba9876543210\n"); assert(state.armed&&state.session_live&&replies==2&&strstr(last_reply,"session"));

  begin(); receive("10\tmove\t0123456789abcdef\t1\t2\n10\tmove\t0123456789abcdef\t1\t2\n");
  assert(q_count==1&&state.last_action==10&&replies==1&&strstr(last_reply,"replay"));

  begin();receive("2\tpaste\t0123456789abcdef\n");loop();
  assert(reports==1&&replies==0&&history[0].id==1&&history[0].mod==KEYBOARD_MODIFIER_LEFTCTRL&&history[0].key==HID_KEY_V);
  loop();assert(reports==1&&replies==0);complete();fake_now+=5;endpoint_ready=0;loop();assert(reports==1&&replies==0);
  endpoint_ready=1;loop();assert(reports==2&&replies==0&&history[1].mod==0&&history[1].key==0);
  complete();loop();assert(replies==1&&strstr(last_reply,"\"id\":2"));

  begin();receive("2\tclick\t0123456789abcdef\tleft\n");loop();
  assert(reports==1&&replies==0&&history[0].id==2&&history[0].buttons==MOUSE_BUTTON_LEFT);
  complete();fake_now+=5;loop();assert(reports==2&&replies==0&&history[1].buttons==0);complete();loop();assert(replies==1);

  begin();receive("2\tmove\t0123456789abcdef\t-12\t8\n");loop();
  assert(replies==0&&reports==1&&history[0].x==-12&&history[0].y==8);complete();loop();assert(replies==1);

  key_and_ack("shift",KEYBOARD_MODIFIER_LEFTSHIFT,0);key_and_ack("escape",0,HID_KEY_ESCAPE);key_and_ack("pagedown",0,HID_KEY_PAGE_DOWN);

  begin();receive("2\tmove\t0123456789abcdef\t1\t1\n");assert(q_count==1);
  tud_cdc_line_state_cb(0,false,false);loop();assert(!state.armed&&!active&&!q_count&&reports==1&&history[0].id==1);
  receive("3\tbegin\t0123456789abcdef\n");assert(!state.armed&&!state.session_live);
  tud_cdc_line_state_cb(0,true,false);loop();assert(!state.armed&&!state.session_live);

  begin();receive("2\tpaste\t0123456789abcdef\n3\tmove\t0123456789abcdef\t1\t1\n");loop();assert(report_in_flight);
  receive("4\tdisarm\n");loop();assert(q_count==0&&reports==1&&replies==0);complete();release_and_ack();
  assert(reports==3&&strstr(last_reply,"\"id\":4"));loop();assert(reports==3&&replies==1);

  reset();tud_cdc_line_state_cb(0,true,false);receive("12\tdisarm\n");release_and_ack();assert(strstr(last_reply,"\"id\":12"));

  begin();receive("2\tmove\t0123456789abcdef\t1\t1\n");fake_now=10000;loop();
  assert(!state.armed&&!active&&!q_count&&release_pending==3&&reports==1);
  complete();loop();complete();loop();assert(replies==0&&release_pending==0);

  begin();receive("2\tpaste\t0123456789abcdef\n");loop();tud_umount_cb();
  assert(!state.session_live&&!state.armed&&!active&&!report_in_flight&&!cdc_dtr);loop();complete();loop();complete();loop();assert(replies==0&&release_pending==0);
  receive("3\tbegin\t0123456789abcdef\n");assert(!state.session_live&&!state.armed);
  tud_cdc_line_state_cb(0,true,false);receive("3\tbegin\t0123456789abcdef\n");assert(state.session_live&&state.armed&&strstr(last_reply,"\"id\":3"));

  begin();receive("2\tpaste\t0123456789abcdef\n");loop();tud_suspend_cb(false);
  assert(!state.armed&&!active&&release_pending==3&&!report_in_flight);
  loop();complete();loop();complete();loop();assert(replies==0&&release_pending==0);
  puts("firmware HID harness passed: begin, idle ping, replay, paste, click, move, busy endpoint, disarm, lease, USB recovery");
  return 0;
}
