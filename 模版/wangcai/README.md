# 旺财作图模板采集与发布

本目录保存从 **旺财作图** 客户端/网页版采集并转换好的 `.haishen.json` 模板,以及与海神作图模板格式互转、批量发布的工具。

模板来源为旺财作图公开客户端内置页面,已转换为海神作图模板包格式(背景图 + 可编辑参数),可直接在海神后台上传使用。

## 目录

| 路径 | 内容 |
| --- | --- |
| `模版/wangcai/packages/*.haishen.json` | 201 套模板包(含背景图与参数) |
| `模版/wangcai/thumbs/*.png` | 与模板一一对应的预览图(边长 ≤ 2048) |
| `模版/wangcai/manifest.json` | 索引:名称、分组、分类、画布尺寸、参数数量、校验值 |
| `scripts/wangcai/` | 采集、转换、发布脚本 |
| `docs/WANGCAI_TEMPLATES.zh-CN.md` | 使用说明 |

## 模板构成

每套模板 = 一张整页背景截图(锁定)+ 若干可编辑文字参数:

- 背景图层固定在最底层,不参与编辑。
- 每个参数都有对应的文字图层,并带 `cleanup`(纯色遮罩),生成时先盖掉背景里的示例文字,再绘制新内容。
- 参数类型与旺财编辑菜单一致:户名、卡号、金额、手续费、合计、回单编号、指令序号、交易时间、水印时间等。
- 日期字段转换为海神 `date` 参数(精确到分钟)。

## 分类与排序

采集结果按旺财一级分类映射到海神分类,模板 `position` 按“分类顺序 × 10000 + 分类内序号”生成,前台“最热门”排序即为分类聚合顺序:

| 分类 | 模板数 |
| --- | --- |
| 国内银行 | 55 |
| 网络钱包 | 83 |
| 加密货币 | 10 |
| 海外银行 | 2 |
| 聊天生成 | 19 |
| 定制模拟 | 32 |

## 重新采集

需要本机安装 Chrome,并让页面在 `http://127.0.0.1:9222` 暴露 DevTools:

```bash
chrome --remote-debugging-port=9222 --user-data-dir=<临时目录>
node scripts/wangcai/harvest.mjs <输出目录> [数量]
```

采集流程:`catalog.json`(旺财模板索引)→ 打开客户端内置页面 → 读取页面 `dataConfig` 得到字段与当前值 → 在预览里按文本匹配字段位置、字号、颜色、底色 → 截图作为背景 → 生成模板包。

## 重新发布

```bash
# 直接写生产 D1 + R2(使用本机 Wrangler 凭据)
node scripts/wangcai/publish.mjs --manifest 模版/wangcai/manifest.json \
  --dir 模版/wangcai/packages --thumbs 模版/wangcai/thumbs

# 或走后台接口(需要管理员密码)
node scripts/wangcai/bulk-upload-wangcai.mjs --base https://xiaohai.uk --user admin --password '…'
```

`publish.mjs` 只做两件事:把模板包与预览图写入 R2,再向 D1 插入 `cms_templates` 记录(发布状态)。执行前建议先备份生产库:

```bash
npx wrangler d1 execute haishen-catalog --remote --command "SELECT * FROM cms_templates" --json > backup.json
```

## 校验

```bash
python scripts/wangcai/post.py 模版/wangcai/packages scripts/wangcai/catalog.json <输出目录>
```

会按海神模板 schema 逐项检查图层、参数、素材,并重新生成预览图与 `manifest.json`。
