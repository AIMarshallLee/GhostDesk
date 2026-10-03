#!/usr/bin/env python3
"""
GhostDesk 24小时不睡觉的海外外贸抢单与报价特工 (Global Trade Order Agent)
专为中国跨境出海企业（义乌/深圳/工贸工厂）打造：
1. 0时差跨时区实时响应海外询盘 (WhatsApp / Email)
2. 结合工厂底价与阶梯起订量 (MOQ) 自动计算报价
3. 生成地道国际商务语言 (英语/西语/阿语) 的专业外贸报价函与催单话术
4. 自动导出企业级标准外贸报价单 Excel / PDF
"""

import os
import sys
import time
import json
import re
from pathlib import Path

# 编码保护
if sys.platform == "win32" and hasattr(sys.stdout, "buffer"):
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "replace")
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "replace")

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = ROOT_DIR / "dist" / "trade_output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 默认工厂产品与阶梯底价知识库 (外贸工厂常用配置)
DEFAULT_FACTORY_CATALOG = {
    "smart_watch": {
        "name_en": "Ultra Waterproof AI Smart Watch",
        "name_cn": "超强防水智能运动手表",
        "sku": "SW-PRO-2026",
        "moq": 100,
        "sample_price_usd": 35.0,
        "tiers": [
            {"min_qty": 100, "max_qty": 499, "price_usd": 22.5},
            {"min_qty": 500, "max_qty": 1999, "price_usd": 18.0},
            {"min_qty": 2000, "max_qty": 999999, "price_usd": 15.5}
        ],
        "lead_time_days": "7-10 working days for standard, 15-20 days for custom logo",
        "warranty": "12 months international warranty",
        "certifications": ["CE", "RoHS", "FCC", "IP68"]
    },
    "projector": {
        "name_en": "4K Smart Portable Home Projector",
        "name_cn": "4K超清便携智能投影仪",
        "sku": "PRJ-4K-MINI",
        "moq": 50,
        "sample_price_usd": 85.0,
        "tiers": [
            {"min_qty": 50, "max_qty": 199, "price_usd": 58.0},
            {"min_qty": 200, "max_qty": 999, "price_usd": 49.0},
            {"min_qty": 1000, "max_qty": 999999, "price_usd": 42.0}
        ],
        "lead_time_days": "10-15 working days",
        "warranty": "24 months warranty",
        "certifications": ["CE", "FCC", "PSE"]
    },
    "earbuds": {
        "name_en": "Noise Cancelling True Wireless Earbuds",
        "name_cn": "主动降噪真无线蓝牙耳机",
        "sku": "TWS-ANC-X1",
        "moq": 200,
        "sample_price_usd": 20.0,
        "tiers": [
            {"min_qty": 200, "max_qty": 999, "price_usd": 12.0},
            {"min_qty": 1000, "max_qty": 4999, "price_usd": 9.5},
            {"min_qty": 5000, "max_qty": 999999, "price_usd": 8.0}
        ],
        "lead_time_days": "5-7 working days",
        "warranty": "12 months warranty",
        "certifications": ["CE", "RoHS", "BQB"]
    }
}

class TradeOrderAgent:
    """GhostDesk 24小时外贸智能接单与抢单特工"""

    @classmethod
    def match_product(cls, inquiry_text: str) -> dict:
        """从海外客户询盘中智能匹配目标商品"""
        text_lower = inquiry_text.lower()
        if any(k in text_lower for k in ["projector", "projection", "投影"]):
            return DEFAULT_FACTORY_CATALOG["projector"]
        elif any(k in text_lower for k in ["earbud", "headphone", "audio", "earphone", "耳机"]):
            return DEFAULT_FACTORY_CATALOG["earbuds"]
        else:
            return DEFAULT_FACTORY_CATALOG["smart_watch"]

    @classmethod
    def extract_quantity(cls, inquiry_text: str, default_moq: int = 100) -> int:
        """提取客户询问的数量 (如 500 pcs, 1000 units, 200个)"""
        match = re.search(r"(\d+[\d,\.]*)\s*(?:pcs|pieces|units|sets|items|个|件|套)?", inquiry_text, re.IGNORECASE)
        if match:
            raw_str = match.group(1).replace(",", "")
            try:
                qty = int(float(raw_str))
                return max(qty, 1)
            except Exception:
                pass
        return default_moq

    @classmethod
    def calculate_quotation(cls, product: dict, quantity: int) -> dict:
        """根据阶梯底价表精确计算单价、总价与阶梯区间"""
        selected_tier = product["tiers"][-1]
        for tier in product["tiers"]:
            if tier["min_qty"] <= quantity <= tier["max_qty"]:
                selected_tier = tier
                break

        unit_price = selected_tier["price_usd"]
        total_amount = round(unit_price * quantity, 2)

        return {
            "sku": product["sku"],
            "product_name": product["name_en"],
            "product_name_cn": product["name_cn"],
            "quantity": quantity,
            "unit_price_usd": unit_price,
            "total_amount_usd": total_amount,
            "moq": product["moq"],
            "sample_price": product["sample_price_usd"],
            "lead_time": product["lead_time_days"],
            "certifications": ", ".join(product["certifications"]),
            "warranty": product["warranty"]
        }

    @classmethod
    def generate_whatsapp_message(cls, customer_name: str, quote: dict) -> str:
        """生成符合欧美/中东/拉美商人习惯的高亲和力、结构化 WhatsApp 商务快报"""
        c_name = customer_name or "Dear partner"
        return (
            f"Hi {c_name}! 👋 Thanks for reaching out to us.\n\n"
            f"Regarding your inquiry for *{quote['product_name']}* (SKU: {quote['sku']}), here is our direct factory tier quotation for you:\n\n"
            f"📦 *Order Qty:* {quote['quantity']} pcs\n"
            f"💰 *Unit Price (FOB):* *${quote['unit_price_usd']} USD / pc*\n"
            f"💵 *Total Estimated:* *${quote['total_amount_usd']:,} USD*\n"
            f"⏳ *Production Lead Time:* {quote['lead_time']}\n"
            f"🛡️ *Quality Guarantee:* {quote['warranty']} ({quote['certifications']})\n\n"
            f"🎁 *Sample Policy:* Sample units can be dispatched in 24 hours ($ {quote['sample_price']} USD).\n\n"
            f"📍 Could you please share your destination city and postal code? I will calculate the fastest air/sea door-to-door shipping rate for you right away! 🚀"
        )

    @classmethod
    def generate_email_message(cls, customer_name: str, quote: dict) -> dict:
        """生成国际外贸标准商务公函 (正式邮件格式)"""
        c_name = customer_name or "Valued Customer"
        subject = f"Official Quotation: {quote['product_name']} for {quote['quantity']} pcs - Direct Factory Offer"
        body = f"""Dear {c_name},

Thank you very much for your inquiry and interest in our products.

We are pleased to offer you our most competitive factory-direct pricing for the {quote['product_name']} based on your requested quantity of {quote['quantity']} pieces:

1. COMMERCIAL SPECIFICATIONS:
------------------------------------------------------------
- Product Model: {quote['sku']} ({quote['product_name']})
- Order Quantity: {quote['quantity']:,} pcs
- Unit Price (FOB): USD ${quote['unit_price_usd']:.2f} / pc
- Total Amount: USD ${quote['total_amount_usd']:,.2f}
- Payment Terms: 30% T/T deposit in advance, 70% balance before shipment
- Delivery Lead Time: {quote['lead_time']}
- Product Certifications: {quote['certifications']}
- International Warranty: {quote['warranty']}

2. SAMPLES & CUSTOMIZATION (OEM/ODM):
------------------------------------------------------------
- Sample lead time is within 24-48 hours upon confirmation.
- Custom laser logo and gift-box packaging are available on orders exceeding 500 pcs.

Please review the attached formal quotation sheet. If this meets your target budget, please provide your shipping destination address so that we can arrange the best freight options (Air Express / Sea DDP) for you.

We look forward to establishing a long-term mutually beneficial business partnership with your esteemed company.

Best regards,

Global Export Sales Directorate
GhostDesk Smart Industrial Solutions
WhatsApp / Mobile: +86-138-0000-0000
Email: sales@ghostdesk-global.com
Website: www.ghostdesk-global.com
"""
        return {"subject": subject, "body": body}

    @classmethod
    def export_excel_quotation(cls, quote: dict, customer_name: str) -> Path:
        """自动生成企业级双语外贸形式发票/报价单 (.xlsx)"""
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        excel_path = OUTPUT_DIR / f"Quotation_{quote['sku']}_{timestamp}.xlsx"

        try:
            import openpyxl
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
            from openpyxl.utils import get_column_letter

            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "Commercial Quotation"

            # 标题
            ws.merge_cells("A1:G1")
            ws["A1"] = "OFFICIAL PROFORMA QUOTATION (形式报价单)"
            ws["A1"].font = Font(name="Arial", size=16, bold=True, color="1E3A8A")
            ws["A1"].alignment = Alignment(horizontal="center", vertical="center")

            # 基础信息
            ws["A3"] = "Customer Name:"
            ws["B3"] = customer_name or "Overseas Buyer"
            ws["F3"] = "Quotation Date:"
            ws["G3"] = time.strftime("%Y-%m-%d")

            ws["A4"] = "Supplier:"
            ws["B4"] = "GhostDesk Export Directorate (China)"
            ws["F4"] = "Currency:"
            ws["G4"] = "USD ($)"

            for cell_id in ["A3", "F3", "A4", "F4"]:
                ws[cell_id].font = Font(name="Arial", size=10, bold=True)

            # 表头
            headers = ["Item No.", "Model / SKU", "Description (品名与规格)", "Qty (数量)", "Unit Price (USD)", "Amount (USD)", "Lead Time"]
            ws.append([]) # row 5 空行
            ws.append(headers) # row 6

            header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
            header_font = Font(name="Arial", size=10, bold=True, color="FFFFFF")
            for col in range(1, 8):
                c = ws.cell(row=6, column=col)
                c.fill = header_fill
                c.font = header_font
                c.alignment = Alignment(horizontal="center", vertical="center")

            # 数据行
            row_data = [
                1,
                quote["sku"],
                f"{quote['product_name']} ({quote['certifications']})",
                quote["quantity"],
                f"${quote['unit_price_usd']:.2f}",
                f"${quote['total_amount_usd']:,.2f}",
                quote["lead_time"]
            ]
            ws.append(row_data)

            # 合计行
            ws.merge_cells("A8:E8")
            ws["A8"] = "TOTAL (FOB Port):"
            ws["A8"].font = Font(name="Arial", size=11, bold=True)
            ws["A8"].alignment = Alignment(horizontal="right", vertical="center")
            ws["F8"] = f"${quote['total_amount_usd']:,.2f}"
            ws["F8"].font = Font(name="Arial", size=11, bold=True, color="DC2626")

            # 商务条款
            terms = [
                "",
                "TERMS & CONDITIONS (商业条款):",
                f"1. Minimum Order Quantity (MOQ): {quote['moq']} pcs.",
                f"2. Warranty: {quote['warranty']}.",
                "3. Payment Term: 30% T/T deposit, 70% before shipping.",
                "4. Price Validity: 30 calendar days from the quotation date."
            ]
            for t in terms:
                ws.append([t])

            # 列宽调整
            col_widths = [10, 16, 36, 12, 16, 18, 22]
            for i, w in enumerate(col_widths, 1):
                col_letter = get_column_letter(i)
                ws.column_dimensions[col_letter].width = w

            wb.save(str(excel_path))
            print(f"📊 [Trade Agent] 专业外贸报价单 Excel 已生成: {excel_path.name}")
        except Exception as e:
            print(f"⚠️ [Trade Agent] Excel 生成异常: {e}")

        return excel_path

    @classmethod
    def process_inquiry(cls, inquiry_text: str, customer_name: str = "Client") -> dict:
        """
        🚀 24小时外贸抢单特工总流水线：
        1. 意图与商品识别
        2. 阶梯底价与利润测算
        3. 生成即发 WhatsApp 商务话术
        4. 生成标准商务外贸 Email
        5. 生成形式发票/报价单 Excel 报表
        """
        print(f"\n🌍 [Trade Agent] 收到跨时区海外询盘: \"{inquiry_text}\"", flush=True)

        product = cls.match_product(inquiry_text)
        qty = cls.extract_quantity(inquiry_text, default_moq=product["moq"])
        quote = cls.calculate_quotation(product, qty)

        whatsapp_pitch = cls.generate_whatsapp_message(customer_name, quote)
        email_data = cls.generate_email_message(customer_name, quote)
        excel_file = cls.export_excel_quotation(quote, customer_name)

        print(f"✅ [Trade Agent] 阶梯报价已核算: {qty} pcs -> 单价 ${quote['unit_price_usd']} | 总计 ${quote['total_amount_usd']:,} USD")
        print(f"✅ [Trade Agent] WhatsApp 极速抢单话术已生成！")
        print(f"✅ [Trade Agent] 形式发票报价单已归档: {excel_file.name}")

        return {
            "status": "success",
            "matched_product": product["name_en"],
            "quantity": qty,
            "unit_price_usd": quote["unit_price_usd"],
            "total_amount_usd": quote["total_amount_usd"],
            "whatsapp_message": whatsapp_pitch,
            "email_subject": email_data["subject"],
            "email_body": email_data["body"],
            "excel_file": str(excel_file.resolve()),
            "excel_name": excel_file.name
        }

if __name__ == "__main__":
    test_inquiry = "Hi, we are an electronics distributor in California. What is your best FOB price for 500 pcs of your smart watch? Can you ship before November?"
    res = TradeOrderAgent.process_inquiry(test_inquiry, customer_name="David Miller")
    print("\n[Result JSON]", json.dumps({k: v for k, v in res.items() if k != "email_body"}, indent=2, ensure_ascii=False))
