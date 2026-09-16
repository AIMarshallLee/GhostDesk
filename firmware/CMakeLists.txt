cmake_minimum_required(VERSION 3.13)

include(pico_sdk_import.cmake)

project(flowdesk_usb_bridge C CXX ASM)

pico_sdk_init()

add_executable(flowdesk_usb_bridge
    src/main.c
    src/protocol.c
    src/bridge_state.c
    src/usb_descriptors.c
)

target_include_directories(flowdesk_usb_bridge PRIVATE include)
target_link_libraries(flowdesk_usb_bridge PRIVATE pico_stdlib tinyusb_device tinyusb_board hardware_gpio)
target_compile_definitions(flowdesk_usb_bridge PRIVATE PICO_RP2040_USB_DEVICE_ENUMERATION_FIX=1)
pico_enable_stdio_usb(flowdesk_usb_bridge 0)
pico_enable_stdio_uart(flowdesk_usb_bridge 0)
pico_add_extra_outputs(flowdesk_usb_bridge)

enable_testing()
add_executable(protocol_tests tests/protocol_tests.c src/protocol.c)
target_include_directories(protocol_tests PRIVATE include)
add_test(NAME protocol_tests COMMAND protocol_tests)
add_executable(state_tests tests/state_tests.c src/bridge_state.c)
target_include_directories(state_tests PRIVATE include)
add_test(NAME state_tests COMMAND state_tests)
