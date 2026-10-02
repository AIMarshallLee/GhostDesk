# SAUC WebSocket 接口参数速查

来源：[官方文档](https://docs.volcengine.com/docs/DoubaoVoice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh)。本文档为参数级速查，帧协议见 SKILL.md。

- 方法：`POST`
- Endpoint：`wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`（另有 bigmodel_nostream）

## 请求头

| Header | 必选 | 说明 |
|--------|------|------|
| X-Api-Key | 是* | 新版控制台 API Key，从控制台 API Key 管理获取 |
| X-Api-App-Key + X-Api-Access-Key | 是* | 旧版控制台鉴权，与 X-Api-Key 二选一 |
| X-Api-Resource-Id | 是 | 模型版本，见下表 |
| X-Api-Request-Id | 是 | 任务 ID，推荐随机 UUID |

X-Api-Resource-Id 取值：

| 模型 | 小时版 | 并发版 |
|------|--------|--------|
| 豆包流式语音识别 2.0（推荐） | volc.seedasr.sauc.duration | volc.seedasr.sauc.concurrent |
| 豆包流式语音识别 1.0 | volc.bigasr.sauc.duration | volc.bigasr.sauc.concurrent |

## audio（音频描述，必选）

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| format | string | 必填 | wav / mp3 / ogg / pcm / spx / amr / aac / m4a |
| codec | string | raw | 编码：raw（pcm）/ opus |
| rate | int | 16000 | 采样率 |
| bits | int | 16 | 采样点位数 |
| channel | int | 1 | 声道：1 mono / 2 stereo |

## request（识别配置）

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| model_name | string | 必填 | 目前仅支持 bigmodel |
| enable_nonstream | bool | 官方 false，本 skill 模板 true | 二遍识别，一句话结束后重新识别以提升准确率；推荐开启 |
| enable_speaker_info | bool | false | 说话人分离；需同时开启 show_utterances，推荐搭配 2.0 |
| enable_itn | bool | true | 逆文本规范化，口语数字/金额/日期转书面格式 |
| enable_punc | bool | true | 标点 |
| enable_ddc | bool | false | 语义顺滑，删除停顿词/语气词/重复 |
| output_zh_variant | string | - | traditional 繁体（大陆）/ tw 台湾正体 / hk 香港繁体 |
| show_utterances | bool | false | 输出分句、分词、说话人、停顿信息 |
| show_speech_rate | bool | false | 分句携带语速（token/s） |
| show_volume | bool | false | 分句携带音量（dB） |
| enable_lid | bool | false | 中英文及方言识别（见下方语种标签） |
| enable_emotion_detection | bool | false | 情绪检测（见情绪标签） |
| enable_gender_detection | bool | false | 性别标签 male/female |
| enable_age_detection | bool | false | 年龄（字符串浮点数，仅供参考） |
| result_type | string | full | full 全量 / single 仅增量 |
| enable_accelerate_text | bool | false | 首字返回加速，可能降低首字准确率 |
| accelerate_score | int | 0 | 加速率，越大出字越快，需同时开 enable_accelerate_text |
| vad_segment_duration | int | 3000 | 语义分句最大静音阈值（ms），仅影响语义分句；配置 end_window_size 时不生效 |
| end_window_size | int | 800 | VAD 静音判停阈值（ms），范围 [300,5000]，推荐 [800,1000] |
| force_to_speech_time | int | 0 | 起始强制按有声处理时长（ms），规避起始静音过早判停，推荐 1000 |
| sensitive_words_filter | string | - | 敏感词过滤配置（JSON 字符串，见下） |
| enable_poi_fc | bool | false | POI 地图领域 Function Call，需 enable_nonstream=true |
| enable_music_fc | bool | false | 音乐领域 Function Call，需 enable_nonstream=true |

依赖关系：开启 show_speech_rate / show_volume / enable_lid / 情绪 / 性别等会自动启用 VAD 分句，默认 800ms 静音判停，可由 end_window_size 调整。

### 语种/场景标签（enable_lid）

singing_en、singing_mand、singing_dia_cant、speech_en、speech_mand、speech_dia_nan（闽南语）、speech_dia_wuu（吴语/上海话）、speech_dia_cant（粤语）、speech_dia_xina（西南官话/四川话）、speech_dia_zgyu（中原官话/陕西话）、other_langs、others；返回空表示无法判断。

### 情绪标签

angry / happy / neutral / sad / surprise

### sensitive_words_filter 结构

```json
{"system_reserved_filter": true, "filter_with_empty": ["敏感词"], "filter_with_signed": ["敏感词"]}
```

- system_reserved_filter：启用系统内置敏感词库，命中替换为 *
- filter_with_empty：命中替换为空字符串的自定义词
- filter_with_signed：命中替换为 * 的自定义词

## request.corpus（语境词典）

上下文与热词（直传 + 词表）合计最大 100 tokens，超出按传入顺序截断。

| 字段 | 说明 |
|------|------|
| boosting_table_name | 热词词表名称（控制台自学习平台） |
| boosting_table_id | 热词词表 id；与 name 不一致时以 id 为准 |
| correct_table_name | 替换词词表名称 |
| correct_table_id | 替换词词表 id；不一致时以 id 为准 |
| regex_correct_table_name | 正则替换词词表名称，适合批量格式转换/模糊匹配 |
| regex_correct_table_id | 正则替换词词表 id |
| context | 上下文，需序列化为 JSON 字符串 |

context 内部结构：

```json
{
  "hotwords": [{ "word": "自定义热词A" }],
  "context_type": "dialog_ctx",
  "context_data": [
    { "speaker": "user", "text": "用户文本" },
    { "speaker": "bot", "text": "助手文本" }
  ]
}
```

- context_type 目前仅支持 dialog_ctx
- image_url 视觉上下文仅模型 2.0 + enable_nonstream 时支持，最多 1 张、单张 ≤500KB、jpeg/jpg/png

## 响应字段

| 字段 | 说明 |
|------|------|
| code | 0 成功，非 0 失败 |
| event | 会话事件类型标识 |
| is_last_package | 是否最后一个响应包 |
| payload_sequence | 响应包序号 |
| payload_size | payload 字节大小 |
| payload_msg | 响应主体 |

payload_msg 结构：

- audio_info.duration：音频时长（ms）
- result.text：整段识别文本
- result.additions.log_id：服务端 logid，用于定位问题
- result.utterances[]：分句（需 show_utterances）
  - definite：是否最终确定
  - text / start_time / end_time
  - speaker_id：说话人 ID（enable_speaker_info）
  - additions：fixed_prefix_result、source 及语速/音量/语种/情绪/性别等
  - words[]：分词 start_time / end_time / text

## 关键超时约束

- 服务端等待下一个音频包的超时为 **8 秒**；超过且未收到负序号结束包，会话被异常结束
- 发送节拍建议等于 seg_duration（默认 200ms），间隔过大触发超时，连接挂起没有业务意义
