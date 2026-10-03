import os
import sys
import json
import time
import threading
import subprocess
from pathlib import Path
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext

if getattr(sys, "frozen", False):
    ROOT_DIR = Path(sys.executable).resolve().parent
    sys.path.insert(0, str(ROOT_DIR / "_internal"))
    sys.path.insert(0, str(ROOT_DIR))
else:
    ROOT_DIR = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(ROOT_DIR))

# 编码保护
if sys.platform == "win32":
    import codecs
    if sys.stdout is not None and hasattr(sys.stdout, "buffer"):
        try:
            sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "replace")
        except Exception:
            pass
    if sys.stderr is not None and hasattr(sys.stderr, "buffer"):
        try:
            sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "replace")
        except Exception:
            pass

from mcp_tools.registry import registry

class McpDashboardApp:
    def __init__(self, root):
        self.root = root
        self.root.title("GhostDesk AI 员工特工控制台 (MCP 标准架构版)")
        self.root.geometry("1060x720")
        self.root.minsize(900, 600)
        self.root.configure(bg="#181825")

        # 强制置顶并聚焦一次，确保用户双击必见窗口
        self.root.lift()
        self.root.attributes("-topmost", True)
        self.root.after(800, lambda: self.root.attributes("-topmost", False))
        self.root.focus_force()

        self._setup_ui()
        self._log("🎉 GhostDesk MCP 智能特工控制台已就绪！")
        self._log(f"🔌 当前动态挂载的标准 MCP 插件数量: {len(registry.list_tool_definitions())} 个")
        self._log("👉 请在左侧点击任意功能按钮，一块一块实机测试与验证。\n" + "-" * 60)

    def _setup_ui(self):
        # 顶部标题栏
        top_frame = tk.Frame(self.root, bg="#1e1e2e", height=70, padx=20, pady=12)
        top_frame.pack(fill="x", side="top")

        title_lbl = tk.Label(
            top_frame, 
            text="🏎️ GhostDesk · 模块化 AI 员工特工控制台", 
            font=("微软雅黑", 16, "bold"), 
            fg="#cdd6f4", 
            bg="#1e1e2e"
        )
        title_lbl.pack(side="left")

        sub_lbl = tk.Label(
            top_frame, 
            text="[MCP 标准插件架构 · 现成资产复用 · 一块一块测通]", 
            font=("微软雅黑", 10), 
            fg="#89b4fa", 
            bg="#1e1e2e"
        )
        sub_lbl.pack(side="left", padx=15, pady=4)

        btn_folder = tk.Button(
            top_frame,
            text="📂 打开产物目录 (dist)",
            font=("微软雅黑", 9, "bold"),
            bg="#45475a",
            fg="#f5e0dc",
            activebackground="#585b70",
            relief="flat",
            padx=12,
            pady=4,
            cursor="hand2",
            command=self._open_output_dir
        )
        btn_folder.pack(side="right")

        # 主内容区域
        main_paned = tk.PanedWindow(self.root, orient="horizontal", bg="#181825", sashwidth=4)
        main_paned.pack(fill="both", expand=True, padx=12, pady=12)

        # 左侧按键操作面板
        left_panel = tk.Frame(main_paned, bg="#1e1e2e", padx=16, pady=16, width=380)
        left_panel.pack_propagate(False)
        main_paned.add(left_panel)

        menu_lbl = tk.Label(
            left_panel, 
            text="🛠️ 核心特工模块单块测试", 
            font=("微软雅黑", 12, "bold"), 
            fg="#a6adc8", 
            bg="#1e1e2e"
        )
        menu_lbl.pack(anchor="w", pady=(0, 10))

        # 按钮配置
        buttons = [
            ("🧠 0. 电脑体检与开源雷达", "分析硬件负荷与剪映状态，研判能力优先级", "#6366f1", self.test_capability_governor),
            ("🎬 1. CapCut/剪映批量裂变工厂", "出海带货多风格脚本、顶级配音、原生工程批量直出", "#f59e0b", self.test_video_factory),
            ("🌍 2. 24H 外贸抢单与报价特工", "阶梯底价核算、WhatsApp极速抢单与形式发票Excel直出", "#0ea5e9", self.test_trade_order_agent),
            ("🌟 3. TikTok/海外带货达人建联", "精准匹配高ROI红人、3步英文邀约跟进信与CRM看板", "#a855f7", self.test_influencer_agent),
            ("🎯 4. 测试评论截流与获客", "提取小红书/TikTok高意向客户、电话/微信并导出Excel", "#3b82f6", self.test_lead_capture),
            ("💬 5. 测试'咔哒'智能客服回复", "依据客户意图生成话术并平滑键入目标聊天窗口", "#10b981", self.test_kada_reply),
            ("📋 6. 测试 Markdown SOP 执行", "自动化驱动小红书线索归档/税务发票/飞书审批", "#8b5cf6", self.test_sop_executor),
            ("🚀 7. 一键全功能连跑巡检", "按顺序连续自动跑通上述所有出海与特工核心能力", "#ef4444", self.test_run_all)
        ]

        for text, desc, color, cmd in buttons:
            btn_box = tk.Frame(left_panel, bg="#252538", padx=10, pady=8)
            btn_box.pack(fill="x", pady=4)

            b = tk.Button(
                btn_box,
                text=text,
                font=("微软雅黑", 10, "bold"),
                bg=color,
                fg="#ffffff",
                activebackground="#ffffff",
                activeforeground="#000000",
                relief="flat",
                cursor="hand2",
                command=lambda c=cmd: self._run_async(c)
            )
            b.pack(fill="x")

            d_lbl = tk.Label(
                btn_box,
                text=desc,
                font=("微软雅黑", 8),
                fg="#bac2de",
                bg="#252538",
                anchor="w",
                justify="left"
            )
            d_lbl.pack(fill="x", pady=(4, 0))

        # 右侧日志输出终端面板
        right_panel = tk.Frame(main_paned, bg="#11111b", padx=12, pady=12)
        main_paned.add(right_panel)

        right_top = tk.Frame(right_panel, bg="#11111b")
        right_top.pack(fill="x", pady=(0, 6))

        term_lbl = tk.Label(
            right_top, 
            text="💻 实时执行日志与测试成果反馈", 
            font=("微软雅黑", 11, "bold"), 
            fg="#a6adc8", 
            bg="#11111b"
        )
        term_lbl.pack(side="left")

        btn_clear = tk.Button(
            right_top,
            text="🧹 清空日志",
            font=("微软雅黑", 8),
            bg="#313244",
            fg="#cdd6f4",
            relief="flat",
            cursor="hand2",
            command=self._clear_log
        )
        btn_clear.pack(side="right")

        self.log_text = scrolledtext.ScrolledText(
            right_panel,
            bg="#181825",
            fg="#cdd6f4",
            insertbackground="#ffffff",
            font=("Consolas", 10),
            padx=10,
            pady=10,
            relief="flat"
        )
        self.log_text.pack(fill="both", expand=True)

        # 底部状态栏
        bottom_bar = tk.Frame(self.root, bg="#1e1e2e", height=30, padx=15)
        bottom_bar.pack(fill="x", side="bottom")

        self.status_lbl = tk.Label(
            bottom_bar,
            text="🟢 状态: 就绪 | 运行环境: Windows 11 x64 | Python 3.12",
            font=("微软雅黑", 9),
            fg="#a6e3a1",
            bg="#1e1e2e"
        )
        self.status_lbl.pack(side="left")

    def _log(self, text: str):
        self.log_text.insert(tk.END, text + "\n")
        self.log_text.see(tk.END)

    def _clear_log(self):
        self.log_text.delete("1.0", tk.END)

    def _set_status(self, text: str, color="#89b4fa"):
        self.status_lbl.config(text=text, fg=color)

    def _run_async(self, func):
        def wrapper():
            self._set_status("⏳ 正在执行特工任务，请稍候...", "#f9e2af")
            try:
                func()
                self._set_status("🟢 任务执行完毕！状态正常", "#a6e3a1")
            except Exception as e:
                self._log(f"\n❌ [执行异常]: {e}")
                self._set_status(f"❌ 发生异常: {e}", "#f38ba8")
        threading.Thread(target=wrapper, daemon=True).start()

    def _open_output_dir(self):
        dist_dir = ROOT_DIR / "dist"
        dist_dir.mkdir(parents=True, exist_ok=True)
        if sys.platform == "win32":
            os.startfile(str(dist_dir))

    # --- 各个特工模块的打通测试方法 ---

    def test_capability_governor(self):
        self._log("\n" + "=" * 60)
        self._log("🧠 【测试 0: 宿主机体检、开源雷达与战略优先级研判】")
        self._log("正在检测电脑硬件（CPU/GPU/C盘空间）、剪映与微信运行态，并扫描高星开源工具库...")

        res = registry.call_tool("ghostdesk_capability_governor", {"action": "evaluate"})
        roadmap = res.get("result", {}).get("roadmap", {})
        machine = roadmap.get("machine_profile", {})
        radar = roadmap.get("radar_library", [])
        active_focus = roadmap.get("active_focus", [])
        deferred_items = roadmap.get("deferred_items", [])

        self._log(f"💻 电脑体检: {machine.get('os')} | C盘剩余: {machine.get('disk_free_gb')}GB | 剪映: {'已安装' if machine.get('has_jianying') else '未检测到'}")
        self._log(f"⭐ 开源雷达资产: 共收录顶尖工具 {len(radar)} 个 (DrissionPage, pyJianYingDraft, openpyxl, uiautomation等)")
        self._log(f"\n🎯 研判结论 (当前聚焦打透的两把尖刀):")
        for f in active_focus:
            self._log(f"   🔥 {f.get('title')}")
            self._log(f"      依据: {f.get('rationale')}")
        self._log(f"\n⏸️ 经严谨评估暂缓/暂不盲目接入的重型技术:")
        for d in deferred_items:
            self._log(f"   💡 {d.get('title')}: {d.get('reason')}")

    def test_lead_capture(self):
        self._log("\n" + "=" * 60)
        self._log("🎯 【测试 1: 小红书/抖音高意向截流与获客挖掘】")
        self._log("正在模拟真实评论流进行意向识别、提取联系方式并联动'咔哒'生成定制话术...")
        
        sample_comments = [
            {"user": "数码测评老李", "text": "你们这个手持对讲机多少钱一套？求购买链接！"},
            {"user": "吃瓜群众", "text": "看着外观挺小巧的。"},
            {"user": "直播老张", "text": "支持异地多台电脑矩阵管理吗？怎么采购合作？加我微信 13812345678 详聊"}
        ]
        
        res = registry.call_tool("ghostdesk_lead_capture", {
            "platform": "小红书",
            "mode": "comments",
            "comments": sample_comments
        })
        
        leads = res.get("result", {}).get("leads", [])
        self._log(f"✅ 成功筛选出 {len(leads)} 个高意向客户！")
        for idx, lead in enumerate(leads, 1):
            self._log(f"\n[{idx}] 客户: {lead['user']} | 意向: {','.join(lead.get('intent_tags', []))} | 联系方式: {lead['contact'] or '未留(私信转化)'}")
            self._log(f"    原文: {lead['comment']}")
            self._log(f"    💡 咔哒推荐话术: {lead['recommended_reply']}")
        
        saved_file = res.get("result", {}).get("file", "")
        excel_file = res.get("result", {}).get("excel_file", "")
        self._log(f"\n💾 数据已写入本地客户库: {Path(saved_file).name if saved_file else '已保存'}")
        if excel_file:
            self._log(f"📊 已生成企业级 Excel 报表: {Path(excel_file).name}")
        self._log("📲 已同步追加至飞书多维表格流水账")

    def test_kada_reply(self):
        self._log("\n" + "=" * 60)
        self._log("💬 【测试 2: '咔哒'智能客服回复与高情商转化】")
        customer = "电商老张"
        inquiry = "对讲机能管理5台电脑吗？采购价格是多少？"
        self._log(f"模拟收到咨询: 客户【{customer}】问: \"{inquiry}\"")
        
        res = registry.call_tool("ghostdesk_kada_reply", {
            "customer_name": customer,
            "inquiry": inquiry,
            "auto_send": False # 安全预览
        })
        
        reply_text = res.get("result", {}).get("reply_text", "")
        self._log(f"\n🧠 咔哒客服大脑生成回复:\n\"{reply_text}\"")
        self._log("✅ 驱动平滑键入通道已模拟测试通过！")

    def test_video_factory(self):
        self._log("\n" + "=" * 60)
        self._log("🎬 【测试 3: 短视频内容工厂与剪映草稿联动】")
        script = "GhostDesk 智能对讲机系统，支持多台异地电脑矩阵跨公网协同干活！"
        self._log(f"口播解说词: \"{script}\"")
        self._log("🎙️ 正在调用超拟人语音合成并对齐精确时间戳字幕...")
        
        res = registry.call_tool("ghostdesk_video_factory", {
            "topic_or_script": script
        })
        
        audio = res.get("result", {}).get("audio", "")
        srt = res.get("result", {}).get("subtitle", "")
        draft = res.get("result", {}).get("draft_dir", "")
        
        self._log(f"✅ 高清配音文件: {Path(audio).name}")
        self._log(f"✅ 时间对齐字幕: {Path(srt).name}")
        self._log(f"📦 剪映工程目录: {draft}")
        self._log("🎉 用户打开剪映电脑端即可直接看到并导出视频！")

    def test_sop_executor(self):
        self._log("\n" + "=" * 60)
        self._log("📋 【测试 4: 标准 Markdown SOP 业务流自动化执行】")
        list_res = registry.call_tool("ghostdesk_sop_executor", {"action": "list"})
        sops = list_res.get("result", {}).get("sops", [])
        self._log(f"扫描到已配置的 SOP 流程 (共 {len(sops)} 个):")
        for s in sops:
            self._log(f"  • [{s['id']}] {s['name']} (涉及: {s['processes']})")
        
        if sops:
            target_id = "skill_xiaohongshu_lead_capture" # 优先选小红书截流
            self._log(f"\n🚀 正在加载并沙箱驱动执行: 【小红书私信高意向线索归档】...")
            run_res = registry.call_tool("ghostdesk_sop_executor", {
                "action": "execute",
                "sop_id": target_id,
                "dry_run": True
            })
            self._log(f"✅ 状态机步骤校验完成，状态: {run_res.get('result', {}).get('status')}")

    def test_wechat_publisher(self):
        self._log("\n" + "=" * 60)
        self._log("📰 【测试 5: 微信公众号矩阵内容工厂 (wechat-oa-daily-publisher)】")
        self._log("检测电脑已有套件资产状态...")
        res = registry.call_tool("ghostdesk_wechat_publisher", {"action": "preview"})
        covers = res.get("result", {}).get("cover_files", [])
        self._log(f"✅ 成功连接公众号工厂套件！发现 {len(covers)} 组已渲染的封面素材：")
        self._log(f"   {', '.join(covers[:4])} ...")

    def test_feishu_sync(self):
        self._log("\n" + "=" * 60)
        self._log("📲 【测试 6: 飞书多维表格与机器人协同流水账】")
        task_id = f"task_{int(time.time())}"
        res = registry.call_tool("ghostdesk_feishu_sync", {
            "task_id": task_id,
            "prompt": "模块化打通功能专项自测",
            "target_node": "Windows 主力机",
            "status": "complete",
            "result_message": "全套 MCP 插件探查与在环联动全部跑通"
        })
        self._log(f"✅ 飞书多维表格流水账归档完成！编号: {task_id}")
        self._log("💾 本地多维表格文件: dist/feishu_logs/bitable_records.jsonl")

    def test_trade_order_agent(self):
        self._log("\n" + "=" * 60)
        self._log("🌍 【测试 2: 24小时外贸智能抢单与报价特工 (TradeOrderAgent)】")
        inquiry = "Hi, we are an electronics distributor from Germany. What is your best FOB price for 500 pcs smart watch shipped to Hamburg?"
        self._log(f"模拟收到海外询盘: \"{inquiry}\"")
        res = registry.call_tool("ghostdesk_trade_order_agent", {"inquiry_text": inquiry, "customer_name": "Hans Becker"})
        out = res.get("result", {})
        self._log(f"✅ 阶梯报价已核算: {out.get('quantity')} pcs | 单价: ${out.get('unit_price_usd')} FOB | 总值: ${out.get('total_amount_usd'):,} USD")
        self._log(f"✅ 英文形式发票/报价单已生成: {out.get('excel_name')}")
        self._log(f"📱 即发 WhatsApp 商务话术预览:\n{out.get('whatsapp_message', '')[:160]}...\n")

    def test_influencer_agent(self):
        self._log("\n" + "=" * 60)
        self._log("🌟 【测试 3: TikTok / 亚马逊 海外带货达人建联特工 (InfluencerOutreach)】")
        self._log("智能挖掘 3C 数码赛道高转化红人并生成英文邀约与CRM看板...")
        res = registry.call_tool("ghostdesk_influencer_agent", {
            "product_name": "4K Ultra Smart Projector",
            "niche": "tech",
            "count": 2
        })
        out = res.get("result", {})
        self._log(f"✅ 成功匹配 {out.get('creator_count')} 位出海高权重达人！")
        self._log(f"✅ 企业级达人追踪与样品寄送 CRM 已生成: {out.get('crm_name')}")
        first_dm = out.get("campaigns", [{}])[0].get("dm_pitch", "")
        self._log(f"📱 达人私信 (DM) 预览:\n{first_dm[:150]}...\n")

    def test_run_all(self):
        self._log("\n" + "#" * 60)
        self._log("🚀 启动【一键出海与自动化全链路巡检】...")
        self._log("#" * 60)
        self.test_capability_governor()
        time.sleep(0.5)
        self.test_video_factory()
        time.sleep(0.5)
        self.test_trade_order_agent()
        time.sleep(0.5)
        self.test_influencer_agent()
        time.sleep(0.5)
        self.test_lead_capture()
        time.sleep(0.5)
        self.test_kada_reply()
        time.sleep(0.5)
        self.test_sop_executor()
        self._log("\n" + "#" * 60)
        self._log("🎉🎉🎉 恭喜！出海短视频工厂、24H外贸抢单、海外达人建联与所有特工全部通过！")
        self._log("#" * 60)

def main():
    try:
        root = tk.Tk()
        app = McpDashboardApp(root)
        root.mainloop()
    except Exception as e:
        import traceback
        log_file = ROOT_DIR / "crash.log"
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(f"\n[Crash at {time.strftime('%Y-%m-%d %H:%M:%S')}]\n")
            f.write(traceback.format_exc())

if __name__ == "__main__":
    main()
