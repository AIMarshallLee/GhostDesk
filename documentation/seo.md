# FlowDesk 公开页面 SEO

公开入口是 React 单页落地页 home；构建产物提供静态 index.html，没有服务端渲染、爬虫分流或动态 metadata。

| 页面 | 可索引数据 | 当前方式 |
| --- | --- | --- |
| 落地页 | 静态产品文案 | 静态 HTML/Vite bundle |
| 工作台与 sandbox | 本地用户数据和虚构测试数据 | 不作为公开数据源 |

没有根据用户输入生成 title、description 或社交卡片，因此当前不存在动态 metadata 注入路径。发布公开站点前仍需人工检查最终静态元标签与下载链接。
