# FlowDesk USB Bridge firmware notices

The linked UF2 map includes Arm GNU Toolchain 13.3.Rel1 `libgcc.a`, `libc.a`, and `libm.a` (Newlib), in addition to the Pico SDK and TinyUSB sources.

* `gcc-GPL-3.0.txt` and `gcc-runtime-library-exception-3.1.txt` are the GCC 13.3.0 `COPYING3` and `COPYING.RUNTIME` texts. Source: <https://gcc.gnu.org/onlinedocs/libstdc++/manual/license.html>.
* `newlib-COPYING.NEWLIB.txt` is `COPYING.NEWLIB` from Newlib 4.4.0.20231231. Source archive: <https://mirrors.edge.kernel.org/sourceware/newlib/newlib-4.4.0.20231231.tar.gz>.
* `pico-sdk-BSD-3-Clause.txt` is copied from the pinned Raspberry Pi Pico SDK 2.1.1 checkout.
* `tinyusb-MIT.txt` is copied from the TinyUSB commit pinned by that SDK.

Arm GNU Toolchain itself is a build dependency and is not included in this package. Its release and source information are available at <https://developer.arm.com/downloads/-/arm-gnu-toolchain-downloads>.
