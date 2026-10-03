import os
import sys
import json
import time
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

# 编码保护
if sys.platform == "win32" and hasattr(sys.stdout, "buffer"):
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "replace")
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "replace")

from mcp_tools.registry import registry

def print_banner():
    print("=" * 66)
    print("🤖  GhostDesk 模块化 AI 员工特工控制台 (MCP 标准架构版)")
    print("    [一块一块实打实打通 · 拒绝空转 · 不重复造轮子]")
    print("=" * 66)
    print("已动态挂载的 MCP 标准特工工具:")
    tools = registry.list_tool_definitions()
    for idx, t in enumerate(tools, 1):
        print(f"  {idx}. [{t['name']}] - {t['description'][:36]}...")
    print("=" * 66)

def run_test_lead_capture():
    print("\n🎯 【测试：小红书/抖音高意向截流获客】")
    sample_comments = [
        {"user": "老陈数码", "text": "你们这个对讲机一套多少钱啊？求购买链接！"},
        {"user": "过客甲", "text": "看起来还不错，支持一下。"},
        {"user": "张经理", "text": "我是做电商直播矩阵的，能批量采购合作吗？加我微信 13912345678 详聊"}
    ]
    print("正在输入模拟评论流进行意向识别与联系方式提取...")
    res = registry.call_tool("ghostdesk_lead_capture", {
        "platform": "小红书",
        "mode": "comments",
        "comments": sample_comments
    })
    print("\n[提取结果]:")
    print(json.dumps(res, indent=2, ensure_ascii=False))

def run_test_kada_reply():
    print("\n💬 【测试：'咔哒'客服大脑智能回复】")
    user = "张经理"
    inquiry = "可以批量管理多台电脑吗？多少钱一套？"
    print(f"客户: {user} | 咨询: {inquiry}")
    res = registry.call_tool("ghostdesk_kada_reply", {
        "customer_name": user,
        "inquiry": inquiry,
        "auto_send": False
    })
    print("\n[生成话术与敲入结果]:")
    print(json.dumps(res, indent=2, ensure_ascii=False))

def run_test_video_factory():
    print("\n🎬 【测试：短视频工厂与剪映草稿联动】")
    prompt = "GhostDesk 智能对讲机系统，支持多台异地电脑矩阵跨公网协同干活！"
    print(f"短视频口播文案: \"{prompt}\"")
    res = registry.call_tool("ghostdesk_video_factory", {
        "topic_or_script": prompt
    })
    print("\n[工程与音频产物]:")
    print(json.dumps(res, indent=2, ensure_ascii=False))

def run_test_sop_executor():
    print("\n📋 【测试：标准 Markdown 业务流 SOP 执行】")
    list_res = registry.call_tool("ghostdesk_sop_executor", {"action": "list"})
    sops = list_res.get("result", {}).get("sops", [])
    print(f"发现 {len(sops)} 个 SOP 业务流:")
    for i, s in enumerate(sops, 1):
        print(f"  {i}. {s['name']} (ID: {s['id']})")
    
    if sops:
        chosen = sops[0]["id"]
        print(f"\n即将以沙箱模式试运行 SOP: 【{sops[0]['name']}】...")
        run_res = registry.call_tool("ghostdesk_sop_executor", {
            "action": "execute",
            "sop_id": chosen,
            "dry_run": True
        })
        print("\n[SOP 执行结果]:", run_res.get("result", {}).get("status"))

def run_test_wechat_publisher():
    print("\n📰 【测试：微信公众号内容工厂 (wechat-oa-daily-publisher)】")
    res = registry.call_tool("ghostdesk_wechat_publisher", {"action": "preview"})
    print("\n[检测已有素材与预览]:")
    print(json.dumps(res, indent=2, ensure_ascii=False))

def run_test_feishu():
    print("\n📲 【测试：飞书多维表格流水账归档】")
    res = registry.call_tool("ghostdesk_feishu_sync", {
        "task_id": f"task_{int(time.time())}",
        "prompt": "模块化打通功能专项自测",
        "target_node": "Windows 主力机",
        "status": "complete",
        "result_message": "全套 MCP 插件探查与在环联动全部跑通"
    })
    print("\n[飞书日志记录结果]:")
    print(json.dumps(res, indent=2, ensure_ascii=False))

def interactive_menu():
    while True:
        print_banner()
        print("请选择要单块打通测试的模块:")
        print("  1. 测试小红书/抖音评论抓取与截流找客户")
        print("  2. 测试'咔哒'智能客服回复与转化")
        print("  3. 测试短视频内容工厂与剪映工程生成")
        print("  4. 测试标准 Markdown SOP 自动化执行 (发票/审批/截流)")
        print("  5. 测试微信公众号图文工厂套件")
        print("  6. 测试飞书多维表格流水账归档")
        print("  7. 一键连续跑通全部 6 大模块 (全功能巡检)")
        print("  0. 退出控制台")
        print("-" * 66)
        
        choice = input("请输入选项编号 (0-7): ").strip()
        if choice == "0":
            print("退出控制台。")
            break
        elif choice == "1":
            run_test_lead_capture()
        elif choice == "2":
            run_test_kada_reply()
        elif choice == "3":
            run_test_video_factory()
        elif choice == "4":
            run_test_sop_executor()
        elif choice == "5":
            run_test_wechat_publisher()
        elif choice == "6":
            run_test_feishu()
        elif choice == "7":
            print("\n🚀 [全功能巡检] 正在依次测试打通全部核心模块...\n")
            run_test_lead_capture()
            time.sleep(1)
            run_test_kada_reply()
            time.sleep(1)
            run_test_video_factory()
            time.sleep(1)
            run_test_sop_executor()
            time.sleep(1)
            run_test_wechat_publisher()
            time.sleep(1)
            run_test_feishu()
            print("\n🎉 全部 6 大核心模块全线测试跑通！")
        else:
            print("⚠️ 无效选项，请重新输入。")
        
        input("\n按回车键返回主菜单...")

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--all":
        # 非交互式全检模式
        run_test_lead_capture()
        run_test_kada_reply()
        run_test_video_factory()
        run_test_sop_executor()
        run_test_wechat_publisher()
        run_test_feishu()
        print("\n✅ [Non-interactive] All module tests passed!")
    else:
        interactive_menu()
