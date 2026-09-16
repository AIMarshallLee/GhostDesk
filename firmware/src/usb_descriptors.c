#include "tusb.h"
#include "pico/unique_id.h"

enum { ITF_NUM_CDC = 0, ITF_NUM_CDC_DATA, ITF_NUM_HID, ITF_NUM_TOTAL };
enum { CONFIG_TOTAL_LEN = TUD_CONFIG_DESC_LEN + TUD_CDC_DESC_LEN + TUD_HID_DESC_LEN };
enum { EPNUM_CDC_NOTIF = 0x81, EPNUM_CDC_OUT = 0x02, EPNUM_CDC_IN = 0x82, EPNUM_HID_IN = 0x83 };

#define USB_VID 0xCAFE /* TinyUSB example VID/PID: development only, not commercial allocation. */
#define USB_PID 0x4001
#define USB_BCD 0x0100

static tusb_desc_device_t const device_desc = {
  .bLength = sizeof(tusb_desc_device_t), .bDescriptorType = TUSB_DESC_DEVICE,
  .bcdUSB = 0x0200, .bDeviceClass = TUSB_CLASS_MISC, .bDeviceSubClass = MISC_SUBCLASS_COMMON,
  .bDeviceProtocol = MISC_PROTOCOL_IAD, .bMaxPacketSize0 = CFG_TUD_ENDPOINT0_SIZE,
  .idVendor = USB_VID, .idProduct = USB_PID, .bcdDevice = USB_BCD,
  .iManufacturer = 0x01, .iProduct = 0x02, .iSerialNumber = 0x03, .bNumConfigurations = 0x01
};

uint8_t const *tud_descriptor_device_cb(void) { return (uint8_t const *) &device_desc; }

enum { REPORT_ID_KEYBOARD = 1, REPORT_ID_MOUSE = 2 };
uint8_t const hid_report_desc[] = {
  TUD_HID_REPORT_DESC_KEYBOARD(HID_REPORT_ID(REPORT_ID_KEYBOARD)),
  TUD_HID_REPORT_DESC_MOUSE(HID_REPORT_ID(REPORT_ID_MOUSE))
};

uint8_t const *tud_hid_descriptor_report_cb(uint8_t instance) { (void) instance; return hid_report_desc; }
uint16_t tud_hid_descriptor_report_cb_len(uint8_t instance) { (void) instance; return sizeof(hid_report_desc); }

uint8_t const config_desc[] = {
  TUD_CONFIG_DESCRIPTOR(1, ITF_NUM_TOTAL, 0, CONFIG_TOTAL_LEN, TUSB_DESC_CONFIG_ATT_REMOTE_WAKEUP, 100),
  TUD_CDC_DESCRIPTOR(ITF_NUM_CDC, 4, EPNUM_CDC_NOTIF, 8, EPNUM_CDC_OUT, EPNUM_CDC_IN, 64),
  TUD_HID_DESCRIPTOR(ITF_NUM_HID, 5, HID_ITF_PROTOCOL_NONE, sizeof(hid_report_desc), EPNUM_HID_IN, 16, 10)
};
uint8_t const *tud_descriptor_configuration_cb(uint8_t index) { (void) index; return config_desc; }

static char const *strings[] = { (const char[]) { 0x09, 0x04 }, "FlowDesk", "FlowDesk USB Bridge", "", "FlowDesk CDC", "FlowDesk HID" };
uint16_t const *tud_descriptor_string_cb(uint8_t index, uint16_t langid) {
  (void) langid; static uint16_t desc[32];
  if (index == 0) { desc[0] = (TUSB_DESC_STRING << 8) | 4; desc[1] = 0x0409; return desc; }
  if (index >= sizeof(strings) / sizeof(strings[0])) return NULL;
  if (index == 3) { pico_unique_board_id_t id; pico_get_unique_board_id(&id); static const char hex[]="0123456789ABCDEF"; for (size_t i=0;i<PICO_UNIQUE_BOARD_ID_SIZE_BYTES;i++) { desc[1+i*2]=hex[id.id[i]>>4]; desc[2+i*2]=hex[id.id[i]&15]; } desc[0]=(TUSB_DESC_STRING<<8)|(2+PICO_UNIQUE_BOARD_ID_SIZE_BYTES*4); return desc; }
  const char *s = strings[index]; size_t n = 0; while (s[n] && n < 31) { desc[1 + n] = s[n]; ++n; }
  desc[0] = (TUSB_DESC_STRING << 8) | (2 * n + 2); return desc;
}

uint16_t tud_hid_get_report_cb(uint8_t instance, uint8_t report_id, hid_report_type_t report_type, uint8_t *buffer, uint16_t reqlen) {
  (void) instance; (void) report_id; (void) report_type; (void) buffer; (void) reqlen; return 0;
}
void tud_hid_set_report_cb(uint8_t instance, uint8_t report_id, hid_report_type_t report_type, uint8_t const *buffer, uint16_t bufsize) {
  (void) instance; (void) report_id; (void) report_type; (void) buffer; (void) bufsize;
}
