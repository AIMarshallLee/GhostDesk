# FlowDesk USB HID 固件

面向 **Raspberry Pi Pico（RP2040，非 Pico 2、非 Pico W）** 的本地 USB CDC + HID 复合设备参考固件。USB 产品字符串是 `FlowDesk USB Bridge`，协议版本为 `4`，固件版本为 `0.5.0`；USB 序列号由 RP2040 的唯一板 ID 生成。

## 硬件与接线

所需 BOM：一块 Raspberry Pi Pico 或 Pico H（均为 RP2040 原版）开发板，以及一根支持数据的 USB 线。

上电、`hello`、`status` 和无会话的 `ping` 都不会启动控制。无活动会话时，主机以 `begin` 提供 16 位 nonce 即可建立会话并使 `armed=true`；活动会话每 10 秒内必须收到 `ping`。重复 `begin`、旧 nonce 和无会话 `ping` 被拒绝。主机应打开 CDC 时设置 DTR=true；DTR 本身不会启动会话，但其降低会立即清空帧和动作队列、释放 HID 并取消会话。`disarm`、10 秒心跳超时、USB 卸载或挂起也会执行相同清理，且不会自动恢复或重放动作。

板载 GPIO25 LED 在会话 `armed` 时点亮，待机时熄灭；无需外接按钮或额外接线。

## 串口协议

每行是最多 160 字节、以 LF 结尾的 TAB 分隔 ASCII 帧。设备对完整且合法的帧回一行 JSON；超长行会丢弃到 LF，绝不执行截断内容。`id` 为 1 到 2147483647 的整数。

```
1\thello
2\tbegin\t0123456789abcdef
3\tping\t0123456789abcdef
4\tmove\t0123456789abcdef\t-12\t8
5\tclick\t0123456789abcdef\tleft
6\twheel\t0123456789abcdef\t-3
7\tpaste\t0123456789abcdef
8\tkey\t0123456789abcdef\tctrl+a
9\ttext\t0123456789abcdef\tFlowDesk
10\tdisarm
```

nonce/session 必须是 16 位小写十六进制，由主机提供，只作会话关联。`move`、`wheel` 范围均为 -127..127；`click` 只接受 `left`/`right`；`key` 仅接受 `enter`、`tab`、`backspace`、`delete`、方向键、`home`、`end`、`ctrl+a`、`shift`、`escape`、`pagedown`。其中 `shift` 以标准键盘报告的左 Shift modifier 按下和归零释放发送。`paste` 只发送 Ctrl+V，绝不发送 Enter；`text` 仍兼容长度至多 64 的 ASCII 32..126，但中文拼音由主机每次发送一个 ASCII 字符，以便逐键检查取消；候选词选择由主机决定。动作 ID 在当前 session 中必须严格递增，重放和倒序返回 `replay`；旧 session 返回 `session`。成功 ACK 只在 HID 按下和释放报告完成后发出。`hello`、`status`、`ping` 不等待长动作。回复固定包含 `id`、`ok`、`protocol:4`、`device`、`firmware`、`board`、`armed`、`session`（无会话为空字符串）、`leaseMs`；失败时附加固定 `error`。

## 构建与刷写

仓库不提交工具链。首次在新 checkout 中按以下命令将全部依赖装到 `firmware/.tools/`；不会修改系统 PATH 或安装全局包。下载源均为 Raspberry Pi、Arm、TinyUSB 或 PyPI 官方发布页。

```powershell
Set-Location E:\Obsidian\产品与技术\FlowDesk
$tools = '.\firmware\.tools'
New-Item -ItemType Directory -Force $tools | Out-Null
py -3.11 -m pip install --disable-pip-version-check --target "$tools\python" cmake==3.30.5 ninja==1.11.1.1
git clone --depth 1 --branch 2.1.1 --recurse-submodules https://github.com/raspberrypi/pico-sdk.git "$tools\pico-sdk"
Invoke-WebRequest 'https://developer.arm.com/-/media/Files/downloads/gnu/13.3.rel1/binrel/arm-gnu-toolchain-13.3.rel1-mingw-w64-i686-arm-none-eabi.zip' -OutFile "$tools\arm.zip"
Expand-Archive "$tools\arm.zip" -DestinationPath $tools
Invoke-WebRequest 'https://github.com/hathach/tinyusb/archive/86ad6e56c1700e85f1c5678607a762cfe3aa2f47.zip' -OutFile "$tools\tinyusb.zip"
Expand-Archive "$tools\tinyusb.zip" -DestinationPath $tools
Invoke-WebRequest 'https://github.com/raspberrypi/pico-sdk-tools/releases/download/v2.1.1-3/picotool-2.1.1-x64-win.zip' -OutFile "$tools\picotool.zip"
Expand-Archive "$tools\picotool.zip" -DestinationPath "$tools\picotool"
```

其中 TinyUSB 展开目录名应为 `tinyusb-86ad6e56c1700e85f1c5678607a762cfe3aa2f47`，与脚本检查的固定提交一致。仓库内 `build.ps1` 会验证所有工具存在、用临时 ASCII 路径避开 Arm i686 链接器对中文路径的限制、检查每一命令退出码，并在 `finally` 中恢复 PATH。仅在本次成功生成 UF2 后才会覆盖输出文件：

```powershell
Set-Location E:\Obsidian\产品与技术\FlowDesk
.\firmware\build.ps1
Get-FileHash .\firmware\build\flowdesk_usb_bridge.uf2 -Algorithm SHA256
```

生成文件为 `firmware/build/flowdesk_usb_bridge.uf2`。刷写时，按住 Pico 的 **BOOTSEL** 键再插入 USB；系统显示 `RPI-RP2` 盘后，把 UF2 复制到该盘并等待它自动重启。没有开发板时不可声称已完成物理枚举、按键或 HID 行为验证。

最终交付校验值见 `release/FlowDesk-Pico-RP2040.uf2.sha256`，打包核验收据在 `artifacts/portable-verification.json`。任何重新构建后都应重新运行 `Get-FileHash`，不能沿用旧校验值。

## 依赖与许可

* Raspberry Pi Pico SDK `2.1.1`（提交 `bddd20f`）采用 BSD-3-Clause；其 TinyUSB 固定子模块提交 `86ad6e56c1700e85f1c5678607a762cfe3aa2f47`，采用 MIT。
* 最终链接图包含 Arm GNU Toolchain `13.3.Rel1` 的 `libgcc.a` 与 Newlib 的 `libc.a`/`libm.a`。分发包必须携带 `licenses/`：GCC GPL-3.0 文本及 GCC Runtime Library Exception 3.1、Newlib `COPYING.NEWLIB`、Pico SDK BSD-3-Clause 与 TinyUSB MIT。Arm GNU Toolchain 本体不随本项目分发；其是构建依赖，不能以“Arm 许可”概括已链接运行库的许可。
* CMake `3.30.5`（BSD-3-Clause）和 Ninja `1.11.1.1`（Apache-2.0）仅装在 `.tools/`，不在发行包中。
* USB `0xCAFE:0x4001` 是 TinyUSB 示例开发 VID/PID，仅可用于开发与测试；产品化必须取得并使用自有或受授权的 VID/PID，本文不主张任何商业分配。

## 无板 C 宿主测试

本机隔离测试使用 Zig 0.14.1，放在 `firmware/.tools/zig/`（包含 zig.exe 和完整 lib 目录），不修改系统工具链。运行 `powershell -NoProfile -ExecutionPolicy Bypass -File firmware/host-tests.ps1`。脚本实际编译并运行协议测试、120 秒模拟心跳状态测试、包含生产 main.c 的 Pico/TinyUSB fake HAL 测试；不会打开设备。最终日志为 `artifacts/firmware-host-tests.log`。

HID harness 验证 Ctrl+V、点击和移动回调完成前没有成功 ACK，忙端点不重复按下，以及停止期间队列清空、双释放后 ACK、失联、挂起和重插恢复。它验证 C 行为逻辑，不替代实物 USB 控制器与 Windows 驱动测试。
