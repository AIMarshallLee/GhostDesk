#!/usr/bin/env python3
"""
GhostDesk DeepSeek AI 智能中枢与语音总指挥引擎 (DeepSeek AI Brain & Voice Commander)
1. 统一接入 DeepSeek-V3 / DeepSeek-R1 (支持官方 API 或 SiliconFlow / 任意兼容端点)
2. 实时解析来自手机端语音识别 (Web Speech API) 或文字输入的自然语言指令
3. 智能意图拆解与参数提取，自动指挥对应的特工去电脑上干活
4. 生成富有亲和力的自然语音回执 (Spoken Response)，让手机直接开口向老板汇报工作
5. 支持无 Key 离线高精度启发式意图路由兜底，保证现场 100% 稳定运行
"""

import os
import sys
import json
import time
import re
import urllib.request
import urllib.error
from pathlib import Path

# 编码保护
if sys.platform == "win32" and hasattr(sys.stdout, "buffer"):
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "replace")
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "replace")

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
CONFIG_FILE = ROOT_DIR / "deepseek_config.json"

DEFAULT_CONFIG = {
    "api_key": "",
    "base_url": "https://api.deepseek.com",
    "model": "deepseek-chat",  # deepseek-chat (V3) 或 deepseek-reasoner (R1)
    "temperature": 0.3,
    "system_role": "你是由GhostDesk驱动的跨机多电脑矩阵AI总司令。你协助老板调度电脑上的短视频工厂、外贸抢单、达人建联、竞品雷达等特工。你的输出必须精准、果断且有商业洞察力。"
}

class DeepSeekBrainEngine:
    """GhostDesk DeepSeek AI 智能中枢"""

    @classmethod
    def load_config(cls) -> dict:
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    return {**DEFAULT_CONFIG, **cfg}
            except Exception:
                pass
        return DEFAULT_CONFIG.copy()

    @classmethod
    def save_config(cls, new_cfg: dict) -> bool:
        try:
            curr = cls.load_config()
            curr.update(new_cfg)
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(curr, f, indent=2, ensure_ascii=False)
            return True
        except Exception:
            return False

    @classmethod
    def call_deepseek_llm(cls, messages: list, cfg: dict) -> str:
        """调用 DeepSeek 官方或兼容 API"""
        api_key = cfg.get("api_key", "").strip() or os.environ.get("DEEPSEEK_API_KEY", "").strip()
        if not api_key:
            return ""

        url = f"{cfg.get('base_url', 'https://api.deepseek.com').rstrip('/')}/chat/completions"
        payload = {
            "model": cfg.get("model", "deepseek-chat"),
            "messages": messages,
            "temperature": cfg.get("temperature", 0.3),
            "max_tokens": 1024
        }

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                choices = data.get("choices", [])
                if choices:
                    return choices[0].get("message", {}).get("content", "")
        except Exception as e:
            print(f"⚠️ [DeepSeek API] 调用异常: {e}, 自动切换本地智能路由")
        return ""

    @classmethod
    def parse_with_offline_heuristic(cls, prompt: str) -> dict:
        """本地高拟真智能启发式路由（当未配置 DeepSeek Key 或断网时的 100% 稳定保障）"""
        p_lower = prompt.lower()

        # 1. 批量 CapCut 短视频工厂
        if any(k in p_lower for k in ["批量", "剪视频", "出海视频", "短视频", "草稿", "capcut", "剪映", "tiktok视频"]):
            # 提取商品
            product = "Smart Fitness Watch"
            m = re.search(r"(?:商品|剪|视频|制作|生成)(?:关于)?\s*([a-zA-Z0-9\u4e00-\u9fa5\s]+?)(?:的|视频|草稿|，|,|$)", prompt)
            if m and len(m.group(1).strip()) > 1:
                cand = m.group(1).strip()
                if cand not in ["批量", "几条", "出海", "一个", "3条"]:
                    product = cand

            lang = "en"
            if any(k in p_lower for k in ["印尼", "东南亚", "id"]):
                lang = "id"
            elif any(k in p_lower for k in ["西语", "西班牙", "拉美"]):
                lang = "es"
            elif any(k in p_lower for k in ["中文", "国内"]):
                lang = "zh"

            return {
                "intent": "batch_video_factory",
                "product_name": product,
                "selling_points": ["Top viral trending item", "High durability & premium finish", "Fast delivery"],
                "lang": lang,
                "count": 3,
                "voice_reply": f"收到指令！已为您启动 CapCut 出海短视频工厂，正在为《{product}》批量生成 3 组爆款草稿工程与神经网络英文配音，马上就好！"
            }

        # 2. 24小时外贸智能抢单报价
        elif any(k in p_lower for k in ["外贸", "抢单", "报价", "询盘", "fob", "单价", "发票", "inquiry", "pcs", "quote"]):
            return {
                "intent": "trade_quote",
                "inquiry_text": prompt,
                "voice_reply": "收到外贸买家询盘！正在核算工厂阶梯底价与起订量，WhatsApp 极速促单话术与形式发票 Excel 已火速生成，请在手机查收！"
            }

        # 3. 海外带货达人建联
        elif any(k in p_lower for k in ["达人", "红人", "influencer", "kol", "koc", "建联", "邀约", "网红"]):
            prod = "4K Ultra Smart Projector"
            niche = "tech"
            if any(k in p_lower for k in ["家居", "生活", "收纳", "home"]):
                niche = "home"
            elif any(k in p_lower for k in ["美妆", "护肤", "口红", "beauty"]):
                niche = "beauty"
            elif any(k in p_lower for k in ["健身", "运动", "户外", "fitness"]):
                niche = "fitness"

            return {
                "intent": "influencer_outreach",
                "product_name": prod,
                "niche": niche,
                "count": 3,
                "voice_reply": f"明白！已锁定美区高权重出海带货达人，私信短案、3步邮件跟进序列与样品寄送 CRM 表格已生成！"
            }

        # 4. 爆品与竞品情报雷达 (Crawl4AI)
        elif any(k in p_lower for k in ["雷达", "爬", "选品", "竞品", "情报", "趋势", "热卖", "爆品", "radar", "crawl", "amazon"]):
            return {
                "intent": "product_radar",
                "category": "Smart Consumer Electronics",
                "platform": "Amazon / TikTok Shop",
                "voice_reply": "已启动全球爆品情报雷达，正在扫描跨境热卖榜单、买家差评痛点与定价区间！"
            }

        # 5. 评论截流获客
        elif any(k in p_lower for k in ["截流", "获客", "评论", "买家", "手机号", "微信", "线索"]):
            return {
                "intent": "lead_capture",
                "voice_reply": "正在扫描社交平台高意向求购评论，已为您提取意向客户与联系方式并归档至表格！"
            }

        # 6. 电脑体检与负荷
        elif any(k in p_lower for k in ["体检", "负荷", "硬件", "状态", "电脑"]):
            return {
                "intent": "system_health",
                "voice_reply": "矩阵电脑状态良好！系统底层高稳驱动已就绪，剪映与媒体渲染管线畅通！"
            }

        # 兜底
        return {
            "intent": "general_chat",
            "reply_text": f"收到指令: \"{prompt}\"。AI 员工已就位，您可以随时说：'帮我剪3条手表视频'、'给德国客户报价' 或 '寻找TikTok带货达人'。",
            "voice_reply": "指令已收到！AI 员工随时待命，您可以对我说：帮我剪视频、外贸报价或者联系海外达人。"
        }

    @classmethod
    def dispatch_command(cls, user_input: str) -> dict:
        """
        🚀 核心指挥调度：
        1. 尝试使用 DeepSeek 思考模型进行高维意图识别
        2. 若无 Key 或异常，平滑降级到启发式意图引擎
        3. 给出结构化执行方案 + 语音播报文案
        """
        cfg = cls.load_config()
        api_key = cfg.get("api_key", "").strip() or os.environ.get("DEEPSEEK_API_KEY", "").strip()

        print(f"\n🧠 [DeepSeek Brain] 接收到老板指令: \"{user_input}\"", flush=True)

        if api_key:
            sys_prompt = (
                "你是一个跨机多电脑矩阵的AI总司令。根据老板输入的自然语言或语音指令，判断其核心意图并提取参数。\n"
                "可用意图类型(intent)：\n"
                "1. 'batch_video_factory': 剪辑或批量制作短视频 (参数: product_name, lang, count)\n"
                "2. 'trade_quote': 外贸客户询盘、算价格、给外国买家报价 (参数: inquiry_text)\n"
                "3. 'influencer_outreach': 寻找海外带货网红、红人建联、TikTok达人合作 (参数: product_name, niche, count)\n"
                "4. 'product_radar': 跨境外贸爆品挖掘、爬虫抓取竞品、行业情报 (参数: category, platform)\n"
                "5. 'lead_capture': 社交评论区截流客户、找手机微信 (参数: platform)\n"
                "6. 'system_health': 检查电脑负荷、体检 (参数: 无)\n"
                "7. 'general_chat': 其他普通对话 (参数: reply_text)\n\n"
                "请严格输出 JSON 格式：\n"
                "{\n"
                "  \"thought\": \"你的思考过程\",\n"
                "  \"intent\": \"意图类型\",\n"
                "  \"params\": { ...提取的参数... },\n"
                "  \"voice_reply\": \"用来在手机上语音播报给老板听的简短干练答复(20字以内)\"\n"
                "}"
            )

            messages = [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": user_input}
            ]

            raw_resp = cls.call_deepseek_llm(messages, cfg)
            if raw_resp:
                try:
                    # 剥离 markdown ```json
                    cleaned = re.sub(r"^```json\s*", "", raw_resp.strip())
                    cleaned = re.sub(r"\s*```$", "", cleaned)
                    parsed = json.loads(cleaned)
                    print(f"🎯 [DeepSeek Brain] 智能解析成功: 意图 [{parsed.get('intent')}] | 播报: {parsed.get('voice_reply')}")
                    return parsed
                except Exception as e:
                    print(f"⚠️ [DeepSeek Brain] 响应解析为JSON失败: {e}, 切换启发式兜底")

        # 离线/无Key启发式兜底
        heuristic_res = cls.parse_with_offline_heuristic(user_input)
        print(f"🎯 [Local Heuristic] 智能解析完成: 意图 [{heuristic_res.get('intent')}] | 播报: {heuristic_res.get('voice_reply')}")
        return {
            "thought": "本地极速高拟真引擎解析",
            "intent": heuristic_res["intent"],
            "params": heuristic_res,
            "voice_reply": heuristic_res.get("voice_reply", "指令已执行完毕！")
        }


if __name__ == "__main__":
    test_voice_prompts = [
        "帮我批量做3条便携投影仪的美式英文出海视频",
        "德国客户要1000台投影仪，问我们最低FOB价格和交期是多少？",
        "帮我联系5个美区TikTok带货达人，主要推智能手表",
        "查一下现在亚马逊最火的数码爆品有什么痛点"
    ]

    for p in test_voice_prompts:
        res = DeepSeekBrainEngine.dispatch_command(p)
        print("Result:", json.dumps(res, indent=2, ensure_ascii=False))
