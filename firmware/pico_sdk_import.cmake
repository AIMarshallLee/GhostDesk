# Copied from the official Pico SDK import pattern. PICO_SDK_PATH is supplied by CMake.
if (NOT PICO_SDK_PATH)
  set(PICO_SDK_PATH "${CMAKE_CURRENT_LIST_DIR}/.tools/pico-sdk")
endif()
include(${PICO_SDK_PATH}/external/pico_sdk_import.cmake)
