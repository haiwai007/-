# 旺财模板库(采集与发布)

[返回首页](../README.md) · [开发说明](DEVELOPMENT.zh-CN.md) · [管理后台](ADMIN_CMS.zh-CN.md)

本仓库的 `模版/wangcai/` 收录了从 **旺财作图** 客户端内置页面采集并转换好的模板,**201 套**、共 **1179 个可编辑参数**,已发布到线上共享目录。

## 1. 模板内容

每套模板是一个标准的 `.haishen.json` 模板包:

| 组成 | 说明 |
| --- | --- |
| 背景图层 | 整页截图,锁定、不可编辑,作为画面底图 |
| 文字图层 | 每个可编辑字段一个,带坐标、字号、颜色、对齐 |
| 参数 | 与字段一一绑定,含纯色 `cleanup` 遮罩用于覆盖背景中的示例文字 |
| 日期参数 | 交易时间、水印时间等转换为 `date` 类型(精确到分钟) |

覆盖场景:国内银行回单与网页版、支付宝/微信/云闪付/数字钱包、话费充值、OkPay、短信、社交聊天、定制模拟等。

## 2. 分类与排序

模板按旺财一级分类映射到海神分类,`position = 分类顺序 × 10000 + 分类内序号`,因此模板库“最热门”排序即为分类聚合顺序:

| 分类 | 标识 | 模板数 |
| --- | --- | --- |
| 国内银行 | `yinhang` | 55 |
| 网络钱包 | `wangluoqianbao` | 83 |
| 加密货币 | `jiamihuobi` | 10 |
| 海外银行 | `haiwaiyinhang` | 2 |
| 聊天生成 | `liaotian` | 19 |
| 定制模拟 | `zhongguo` | 32 |

分类在模板库中的显示位置由 `cms_categories.position` 决定,当前为 100–108,排在原有内置分类之后。

## 3. 使用

模板库和批量页面可直接选择这些模板;进入作图后可修改每个字段并批量生成。模板库的分类标签会显示每类数量,支持按名称、最新、最热门排序。

## 4. 维护

| 操作 | 命令 |
| --- | --- |
| 重新采集 | `node scripts/wangcai/harvest.mjs <输出目录> [数量]` |
| 规范化 + 校验 + 生成预览 | `python scripts/wangcai/post.py 模版/wangcai/packages scripts/wangcai/catalog.json <输出目录>` |
| 发布到生产 D1 + R2 | `node scripts/wangcai/publish.mjs` |
| 走后台接口上传 | `node scripts/wangcai/bulk-upload-wangcai.mjs --base https://xiaohai.uk --user admin --password '…'` |

采集与发布细节见 [`模版/wangcai/README.md`](../模版/wangcai/README.md)。发布前请备份生产库:

```bash
npx wrangler d1 execute haishen-catalog --remote --command "SELECT * FROM cms_templates" --json > backup.json
```

## 5. 已知限制

- 少数页面(19 套)的可编辑内容来自列表数据,没有独立字段,仅作为底图模板收录。
- 桌面浏览器样式页面按浏览器窗口比例渲染,画布较大(如 3420×2391)。
- 生成时使用思源黑体替换原有系统字体,字号与位置按采集值还原,细微字宽差异属正常现象。
- 模板仅用于娱乐、学习与研究,请勿用于任何违法用途;来源与许可见[来源与许可](ATTRIBUTIONS.zh-CN.md)。
