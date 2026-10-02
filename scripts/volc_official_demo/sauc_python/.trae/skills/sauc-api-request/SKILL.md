---
name: sauc-api-request
description: Build and debug SAUC streaming ASR WebSocket requests including auth headers, binary frame protocol, payload params, and last-packet rules. Use when integrating the SAUC bigmodel speech API or troubleshooting packet/session errors. Not for one-shot HTTP file transcription.
---

# SAUC 流式语音识别 API 请求构造

帮助用户正确构造、接入、排查豆包 SAUC（Streaming Audio Understanding Center）双向流式 WebSocket 语音识别请求。本仓库已有可运行的 Python 参考实现，构造或修改请求时**必须与该实现对齐**，不要凭空猜帧格式。

## 参考实现与文档（先读再写）

- 客户端入口：[sauc_websocket_demo.py](file:///Users/bytedance/Desktop/work/bytedance/speech_au_clients/python_client/sauc_python/sauc_websocket_demo.py)
- 协议实现（帧头/组包/解析/收发）：[protocol.py](file:///Users/bytedance/Desktop/work/bytedance/speech_au_clients/python_client/sauc_python/protocol.py)
- 官方参数文档：[双向流式语音识别 WebSocket](https://docs.volcengine.com/docs/DoubaoVoice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh)
- 完整参数速查：[references/parameters.md](references/parameters.md)
- 请求体模板：[assets/payload_template.json](assets/payload_template.json)

当用户询问某个具体字段含义或取值时，优先查阅 parameters.md，不要靠记忆作答。

## Endpoint

基础域名 `wss://openspeech.bytedance.com`，两个路径按业务选择：

| 路径 | 行为 |
|------|------|
| `/api/v3/sauc/bigmodel_async` | 流式（官方文档主用端点），异步返回 |
| `/api/v3/sauc/bigmodel_nostream` | 整段音频识别完成后一次性返回 |

## 鉴权请求头

WebSocket 握手时通过 HTTP header 传入，二选一：

- 新版控制台（推荐）：`X-Api-Key`
- 旧版控制台：`X-Api-App-Key` + `X-Api-Access-Key`

必选公共头：

- `X-Api-Resource-Id`：模型版本
  - 模型 2.0（推荐）：`volc.seedasr.sauc.duration`（小时版）/ `volc.seedasr.sauc.concurrent`（并发版）
  - 模型 1.0：`volc.bigasr.sauc.duration` / `volc.bigasr.sauc.concurrent`
- `X-Api-Request-Id`：每次请求一个随机 UUID

## 二进制帧协议（关键，易错）

WebSocket 传输的是**自定义二进制帧**，不是裸 JSON。每帧 = 4 字节帧头 + 序号 + payload_size + gzip 后的 payload。

### 4 字节帧头（参考 AsrRequestHeader.to_bytes）

- byte0：`(protocol_version << 4) | header_size`，V1=0b0001，header_size 填 `1`（服务端按该值 ×4 得到 4 字节头长）
- byte1：`(message_type << 4) | specific_flags`
- byte2：`(serialization << 4) | compression`
- byte3：保留位 `0x00`

取值常量：

- message_type：客户端 full request=`0b0001`，客户端 audio only=`0b0010`；服务端 full response=`0b1001`，服务端 error=`0b1111`
- specific_flags：NO_SEQUENCE=`0b0000`，POS_SEQUENCE=`0b0001`，NEG_SEQUENCE=`0b0010`，NEG_WITH_SEQUENCE=`0b0011`
- serialization：JSON=`0b0001`；compression：GZIP=`0b0001`

### 帧体布局

首个 full client request：

```
header(4B) | seq(>i, 4B 有符号大端) | payload_size(>I, 4B 无符号大端) | gzip(json 请求体)
```

后续 audio only 包：

```
header(4B) | seq(>i) | payload_size(>I) | gzip(音频分段)
```

硬性要求：

- `payload_size` 必须填 **gzip 压缩后**的字节数，字节序为大端；填原始长度会导致服务端读帧错位
- 序号 `seq` 从 1 开始，full request 占 seq=1，音频包从 seq=2 起逐包 +1

## 请求体结构（full request 的 JSON payload）

顶层三段：`user`、`audio`、`request`。最小可用集见 assets/payload_template.json。

- `audio`：`format`（必填，wav/mp3/ogg/pcm/spx/amr/aac/m4a）、`codec`（raw/opus，默认 raw）、`rate`（默认 16000）、`bits`（默认 16）、`channel`（默认 1）
- `request.model_name`：必填，目前仅支持 `bigmodel`
- 常用开关：`enable_itn`（默认 true）、`enable_punc`（默认 true）、`enable_ddc`（默认 false）、`show_utterances`（默认 false）、`enable_nonstream`（二遍识别，本 skill 默认 true）、`enable_speaker_info`（说话人分离）
- 热词/上下文放在 `request.corpus`，与热词表 id 二选一等细节查 parameters.md

## 标准请求流程

1. 建立 WebSocket 连接（带鉴权头）
2. 发送 full client request（seq=1，含完整配置），等待并解析服务端首个响应
3. 按固定节拍发送音频包：默认每包 `seg_duration=200ms` 音频，分包大小按 `声道数 × 位宽/8 × 采样率 × 时长` 计算
4. 发送与接收**必须用两个并发任务**，发送方绝不能阻塞在等待回包上（见 start_audio_stream）
5. 发送最后一个音频包后，继续接收直到 `is_last_package=true`

本地运行方式：

```bash
python3 sauc_websocket_demo.py --file /path/to/audio.wav \
  --api_key $API_KEY \
  --url wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
```

## 末包规则（最高频故障点，务必遵守）

服务端在收到最后一个音频包后，**连续 8 秒收不到下一个包也收不到结束标记，就会结束会话**并报 `waiting next packet timeout: 8 seconds / Session unexpectedly finished`，gateway 连带报 `session is done`。

末包要求：

- specific_flags 置 `NEG_WITH_SEQUENCE`（0b0011），且 `seq` 取**负值**
- 末包音频段可以是最后一段真实数据，也可以是空音频段（b""）的纯标记包
- 末包判定必须基于**分段总数/下标**（`i == total_segments - 1`），不能依赖"本次读取长度不足一块"——音频长度恰好是分包整数倍时最后一块是满读的，会导致末包漏标记
- 在音频源 EOF、上游断连、发送异常、任务被取消的**所有退出路径**上，都要 best-effort 补发负序号末包，且该补发必须幂等

## 响应解析（参考 ResponseParser.parse_response）

- 头长 = `msg[0] & 0x0f`，payload 起始偏移 = 头长 × 4
- flags：bit0 表示 payload 带序号；bit1 表示末包（`is_last_package`）；bit2 表示带 event
- 服务端 full response：先读 `payload_size(>I)`；error response：先读 `code(>i)` 再读 `payload_size(>I)`
- 业务字段在 gzip + JSON 解压后：`code`（0 成功）、`payload_msg.result.text`、`utterances`（需 show_utterances）、`result.additions.log_id`

## 排查顺序

遇到 SAUC 报错时按此顺序定位，不要跳过证据直接改代码：

1. 取服务端 `log_id`（响应 additions 或 Argos），确认报错来自鉴权、帧解析、音频解码还是会话超时
2. 鉴权失败 → 检查 X-Api-Key / App-Key 组合与 X-Api-Resource-Id 是否匹配模型版本
3. 帧解析/ payload size 错误 → 检查帧头 4 字节各位、payload_size 是否为压缩后长度、字节序
4. `waiting next packet timeout` / `unexpectedly finished` → 按"末包规则"检查末包 flags/负序号及 sender 是否提前退出
5. 音频解码错误 → 核对实际音频格式/采样率/声道与 `audio` 声明是否一致
