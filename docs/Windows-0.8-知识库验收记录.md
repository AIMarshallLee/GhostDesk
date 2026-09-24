# FlowDesk 0.8 知识库本地验收

日期：2026-09-19。平台：Windows 11 x64；固件维持 Pico 1 / RP2040 0.5.0、协议 4。当前版本是供本地与第二台电脑验收的测试包，不代表实体硬件、真实模型或客户现场已验收。

## 已实现

- XLSX、DOCX、文本 PDF、CSV、JSON、TXT、Markdown 和明确角色聊天文本的本地解析；文档解析在可超时终止的 worker 中执行。最多 5 个文件、单个 8MB、编码合计 12MB、300 条；超限要求分批，避免截断业务口径。扫描件需先 OCR，旧 XLS/DOC 需另存。
- 导入预览可编辑、选择条目、保留文件/工作表/行/页来源；提交只新增停用、待审核知识，按规范化问题、答案、场景精确去重。小数、负数、价格区间均参与指纹。
- 新增知识即使传入 enabled:true 也仍是待审核；审核入口才启用。编辑事实撤回审批，同问题冲突答案拒绝同时启用。旧版已启用条目保留状态，客户上线前仍应人工复核。
- 相似问法、标签、场景检索与离线问题集评估；显示命中来源，CSV 导入问题集，报告可导出。分数只用于关键词排序，不是模型正确率；同义词、复杂语义与真实回复质量仍需客户问题集检查。
- 普通任务与持续回复共用本地检索。持续回复默认保持原有手选范围；明确选择按消息检索后，空条目范围表示授权使用本工作区的全部已审核启用知识。任务保存实际命中 ID 与上下文快照。
- 预置话术和聊天整理均先待审核；已移除模板内虚构折扣、退款时效、客户效果等承诺。
- 生产桌面构建关闭开发硬件绕过，实体桌面任务仍要求匹配的 Pico；本轮未改固件。

## 验证证据

| 项目 | 结果与证据 |
| --- | --- |
| 全量 Node 测试 | 315/315，artifacts/knowledge-0.8-tests.log。随后只对数字指纹和生成中知识变更增加/复测 10/10，artifacts/knowledge-final-edge-cases.log |
| 解析专项 | XLSX、DOCX、PDF 真实内存文件；多行聊天例外、Markdown 正文、JSON 数组标签；超时终止与坏文件拒绝，artifacts/knowledge-focused.log 与相应测试文件 |
| 浏览器交互 | 独立目录 artifacts/knowledge-browser-data；CSV 8 条预览、勾选、提交、审核门槛、CSV 问题集 10/10（8 命中、2 无匹配），artifacts/knowledge-browser-verification.json |
| 构建 | npm run build 与 build:desktop 通过；Vite 提示主包略超 500kB，不影响构建 |
| 打包检查 | 7 组：渲染/IPC、知识文件 worker、虚拟 USB、Computer Use SDK、Gemini 单任务、Gemini 持续回复、普通持续回复；artifacts/knowledge-package-0.8.log |
| ZIP 新目录复验 | 通过：341 个运行时文件逐项一致、553 个归档条目，7 组新目录检查通过 |

所有模型请求使用本机假模型；USB 使用虚拟传输和自建候选输入框；只在 FlowDesk 自有虚构窗口内操作。未调用真实模型，未访问微信或真实客户账号。界面的输入法样式测试不代表各品牌输入法已实机适配验收。

## 依赖与剩余事项

复用 ExcelJS、Mammoth、unpdf/PDF.js 和 csv-parse。CSV 解析已更新到 7.0.2；ExcelJS 的 unzipper 固定为 0.12.3，移除许可证不完整的旧 binary/chainsaw/buffers 链。分发包包含许可清单及 PDF.js 内嵌许可记录。

npm audit --omit=dev 仍报告 22 个 moderate（无 high/critical），主要来自原有 UI-TARS/Jimp/file-type 与 uuid 链；本轮未跨版本替换这些桌面依赖。见 artifacts/knowledge-audit-final.json。这不是安全审计通过结论。

下一步验收：Pico H 真机烧录/HID、Windows 11 第二台电脑、实际输入法、真实 Gemini/兼容 API 质量与时延、客户授权范围内的长时间多会话回复。每客户独立 Windows 用户或部署数据目录；当前无应用内多客户切换、SaaS 计费或客户验收记录管理。

客户适配文件随 ZIP 提供：《客户知识库适配指南.md》、knowledge-template.csv、knowledge-evaluation-template.csv。5–7 天试用与 3–5 天适配为目标排期，3000–5000 元年费为拟定报价，未宣称成交或收益。

## 已验证 ZIP 收据

- 软件版本：0.8.0
- 文件：release/FlowDesk-win32-x64.zip
- 大小：165610905 字节
- SHA-256：`922149741b9a8f7d9bbca72a60de9c86dcf2d5beda815437749a6319503ac538`
- 核验时间（UTC）：2026-09-19T14:54:14.015Z
- 固件 SHA-256：`722545026e55cc8a3c89ed02c7e598cf4b40a8620915c9d3e2435d863f32ec8d`（仍为 0.5.0 / 协议 4）
- 证据：artifacts/portable-verification.json、artifacts/knowledge-portable-0.8.log。旧 ZIP 和旧收据已按原打包流程留存备份。
