---
id: skill_tax_invoice_export
name: 增值税发票批量下载导出
description: 自动登录电子税务局/开票软件，批量导出指定日期内的增值税发票与对账明细表
version: 1.0.0
processes:
  - chrome.exe
  - excel.exe
---

### Step 1: 进入开票明细查询页
- Target: chrome.exe
- Channel: fast
- Action: 点击电子税务局顶部导航【开票业务】->【发票查询及开具】->【已开具发票查询】
- Expect: 页面加载出筛选表单（开票起始日期、截止日期、发票类型）

### Step 2: 设定查询区间与查询
- Target: chrome.exe
- Channel: fast
- Action: 输入上月 1 日至末日日期，发票类型选择【全部数电发票】，点击【查询】
- Expect: 表格渲染出查询结果列表，分页控件显示总记录数

### Step 3: 执行发票批量打包下载
- Target: chrome.exe
- Channel: ghost
- Action: 勾选表头【全选】复选框，点击右上角【批量下载】->【PDF及OFD版式文件】
- Expect: 浏览器底部弹出下载通知条，保存至本地 Downloads/TaxInvoices 目录

### Step 4: 导出对账明细并更新 Excel
- Target: chrome.exe
- Channel: fast
- Action: 点击【导出Excel明细】，待文件生成后通过快捷键在 Excel 中打开
- Expect: Excel 自动打开下载的开票清单

### Step 5: 格式化财务底表
- Target: excel.exe
- Channel: ghost
- Action: 快捷键 Ctrl+Home，选中全部数据区域，设置单元格边框并按【开票金额】列降序排序，Ctrl+S 保存
- Expect: Excel 文件格式化完成并安全保存
