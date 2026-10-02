#!/usr/bin/env python3
"""
GhostDesk - 火山引擎豆包大模型流式语音识别 (Streaming ASR) 客户端
基于官方 WebSocket 二进制协议 (v3/sauc/bigmodel):
1. 超低延迟双向流式: 边录边推，手指松开瞬间文字已转录完成
2. 兼容中英混合代码词汇识别 (VS Code, Claude, Antigravity, npm, git 等)
3. 自动解析二进制帧 (4 字节 Header + 4 字节 Payload Size + GZIP 压缩 Payload)
"""

import asyncio
import gzip
import json
import os
import sys
import uuid
from typing import Callable, Optional

# 编码防护
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

try:
    import websockets
except ImportError:
    websockets = None

# ==============================================================================
# 火山引擎二进制帧常数 (ByteDance Speech WebSocket Protocol)
# ==============================================================================
PROTOCOL_VERSION = 0b0001
HEADER_SIZE = 0b0001

# 消息类型 (Message Type)
MSG_FULL_CLIENT_REQ = 0b0001      # 完整握手请求
MSG_AUDIO_CLIENT_REQ = 0b0010     # 音频分片请求
MSG_FULL_SERVER_RESP = 0b1001     # 服务端完整响应
MSG_SERVER_ACK = 0b1011           # 服务端确认

# 序列化与压缩 (Serialization & Compression)
SERIALIZATION_NONE = 0b0000
SERIALIZATION_JSON = 0b0001
COMPRESSION_NONE = 0b0000
COMPRESSION_GZIP = 0b0001


def build_binary_frame(msg_type: int, payload: bytes, is_gzip: bool = True, is_last: bool = False) -> bytes:
    """构建火山引擎标准的 4 字节二进制报头帧"""
    byte0 = (PROTOCOL_VERSION << 4) | HEADER_SIZE
    
    # Flags: 最低位第 2 位表示是否是最后一个分片 (is_last)
    flags = 0b0010 if is_last else 0b0000
    byte1 = (msg_type << 4) | flags
    
    serial_method = SERIALIZATION_JSON if msg_type == MSG_FULL_CLIENT_REQ else SERIALIZATION_NONE
    comp_method = COMPRESSION_GZIP if is_gzip else COMPRESSION_NONE
    byte2 = (serial_method << 4) | comp_method
    byte3 = 0x00  # Reserved
    
    compressed_payload = gzip.compress(payload) if is_gzip else payload
    header = bytes([byte0, byte1, byte2, byte3])
    length_bytes = len(compressed_payload).to_bytes(4, byteorder="big")
    
    return header + length_bytes + compressed_payload


def parse_binary_response(data: bytes) -> Optional[dict]:
    """解析服务端返回的二进制响应帧"""
    if len(data) < 8:
        return None
    
    byte2 = data[2]
    comp_method = byte2 & 0x0F
    
    payload_len = int.from_bytes(data[4:8], byteorder="big")
    payload = data[8:8 + payload_len]
    
    if comp_method == COMPRESSION_GZIP:
        try:
            payload = gzip.decompress(payload)
        except Exception:
            return None
            
    try:
        return json.loads(payload.decode("utf-8"))
    except Exception:
        return None


# ==============================================================================
# 火山引擎流式 ASR 识别类
# ==============================================================================
class VolcStreamingASR:
    DEFAULT_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"
    DEFAULT_RESOURCE_ID = "volc.bigasr.sauc.duration"

    def __init__(self, app_id: str, access_token: str, resource_id: str = DEFAULT_RESOURCE_ID, ws_url: str = DEFAULT_URL):
        self.app_id = app_id
        self.access_token = access_token
        self.resource_id = resource_id
        self.ws_url = ws_url

    async def transcribe_pcm_stream(self, pcm_bytes: bytes, sample_rate: int = 16000, chunk_size: int = 3200) -> str:
        """
        将完整的 PCM 音频流切片并通过 WebSocket 极速流式转文字
        sample_rate: 16000 (16bit 单声道)
        chunk_size: 3200 字节 (~100ms 一包)
        """
        if not websockets:
            raise RuntimeError("websockets 库未安装，请执行 pip install websockets")

        req_id = str(uuid.uuid4())
        headers = {
            "X-Api-App-Key": self.app_id,
            "X-Api-Access-Key": self.access_token,
            "X-Api-Resource-Id": self.resource_id,
            "X-Api-Request-Id": req_id
        }

        final_text = ""

        try:
            async with websockets.connect(self.ws_url, additional_headers=headers, max_size=10 * 1024 * 1024) as ws:
                # 1. 发送初始化配置 Full Client Request
                init_config = {
                    "user": {"uid": "ghostdesk_user"},
                    "audio": {
                        "format": "raw",
                        "rate": sample_rate,
                        "bits": 16,
                        "channel": 1,
                        "codec": "raw"
                    },
                    "request": {
                        "model_name": "bigmodel",
                        "enable_punc": True,
                        "enable_itn": True
                    }
                }
                init_frame = build_binary_frame(MSG_FULL_CLIENT_REQ, json.dumps(init_config).encode("utf-8"), is_gzip=True)
                await ws.send(init_frame)

                # 2. 启动异步接收协程
                async def receiver():
                    nonlocal final_text
                    while True:
                        try:
                            resp_data = await ws.recv()
                            if isinstance(resp_data, bytes):
                                res = parse_binary_response(resp_data)
                                if res:
                                    # 提取识别结果
                                    results = res.get("result", [])
                                    if results and isinstance(results, list):
                                        text = results[0].get("text", "")
                                        if text:
                                            final_text = text
                                    elif "text" in res:
                                        final_text = res["text"]
                        except websockets.exceptions.ConnectionClosed:
                            break
                        except Exception:
                            break

                recv_task = asyncio.create_task(receiver())

                # 3. 流式推送音频分片
                total_len = len(pcm_bytes)
                offset = 0
                while offset < total_len:
                    chunk = pcm_bytes[offset:offset + chunk_size]
                    offset += chunk_size
                    is_last = offset >= total_len
                    frame = build_binary_frame(MSG_AUDIO_CLIENT_REQ, chunk, is_gzip=True, is_last=is_last)
                    await ws.send(frame)
                    await asyncio.sleep(0.02)  # 模拟轻微网络间隔

                # 等待接收结束
                await asyncio.sleep(0.3)
                recv_task.cancel()

        except Exception as e:
            print(f"[火山流式ASR] WebSocket 连接或识别异常: {e}")

        return final_text


def load_volc_config() -> dict:
    """自动寻找并读取 volc_config.json 或环境变量"""
    config = {
        "volc_appid": os.environ.get("VOLC_APPID", ""),
        "volc_token": os.environ.get("VOLC_TOKEN", ""),
        "volc_cluster": os.environ.get("VOLC_CLUSTER", "volcengine_streaming_common"),
        "ark_api_key": os.environ.get("ARK_API_KEY", ""),
        "ark_endpoint_id": os.environ.get("ARK_ENDPOINT_ID", "")
    }

    # 优先查找本地配置文件
    config_paths = ["volc_config.json", os.path.join(os.path.dirname(__file__), "..", "volc_config.json")]
    for p in config_paths:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    local_cfg = json.load(f)
                    config.update({k: v for k, v in local_cfg.items() if v})
                    break
            except Exception:
                pass

    return config
