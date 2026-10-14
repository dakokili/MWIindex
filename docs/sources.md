# 数据源核验（2026-10-13）

| 来源 | 核实到的数据 | 处理 |
| --- | --- | --- |
| [Iceking233/mwi-market-data](https://github.com/Iceking233/mwi-market-data) | 今日仍更新，官方 `a/b/p/v` 快照；按物品/强化等级分片；最近 60 天日内，更早每日中位数 | 默认源，仅使用强化 0 的原始日内行 |
| [官方 marketplace.json](https://www.milkywayidle.com/game_data/marketplace.json) | `timestamp`、`marketData[item][level]`，`a` 卖一、`b` 买一、`p` 成交均价、`v` 小时成交量 | 使用以上归档读取同结构数据，避免让每个用户自己积累第一份历史 |
| [Polokikiki/Milkonomy](https://github.com/Polokikiki/Milkonomy) | `public/CNAME` 指向 `www.milkonomy.top`；公开配方、默认装备、公式、税率 | 固定 commit 导入最小需要字段，保留 MIT 许可 |
| [Milkonomy 的 update-market 工作流](https://github.com/Polokikiki/Milkonomy/blob/f0b9b315b70c0e2394be7ee1a57d2e9d86556d93/.github/workflows/update-market.yml) | 每小时快照；`vol-history.json` 只保留 25 条、`price-history.json` 每天首条保留 14 天 | 历史不足以做可靠日内/月线，不作为默认历史源 |
| [holychikenz/MWIApi](https://github.com/holychikenz/MWIApi) | `market.db` SQLite，ask/bid 两个表、time 秒级时间戳、英文物品名列；无成交量。核验文件 4,718 行，时间范围 2024-12-11 至 2025-07-23 | 记录来源，不下载进用户浏览器；不以旧数据伪装当前行情 |
| [prozhong/MWIApiCharts](https://github.com/prozhong/MWIApiCharts/blob/main/src/data/download.cjs) | 仍从 holychikenz 同一个 market.db 下载 | 没有新增价格或成交量来源 |
| [Q7 histories](https://q7.nainai.eu.org/api/market/histories) | 搜索找到其它市场脚本引用；本次未验证契约或连通性 | 未接入，避免猜测请求参数与数据含义 |

## 默认接口

- [历史目录](https://raw.githubusercontent.com/Iceking233/mwi-market-data/main/docs/history/official/manifest.json)
- [最新原始格式快照](https://raw.githubusercontent.com/Iceking233/mwi-market-data/main/docs/market/api.json)
- [神圣牛奶分片示例](https://raw.githubusercontent.com/Iceking233/mwi-market-data/main/docs/history/official/items/items_holy_milk__0.json)
- [上游归档说明](https://github.com/Iceking233/mwi-market-status/blob/main/docs/official-history-source.md)
- [上游中位数压缩实现](https://github.com/Iceking233/mwi-market-status/blob/main/bakcend/history-compaction.mjs)

目录提供 `items[hrid].variants['0'].path`、`latestTime`、`rows`、`hourlyRetentionDays`。分片为 `{itemHrid, variant:0, rows:[{time,a,b,p,v}]}`。不将成交均价 `p` 用作卖出价格；用户要求用买一 `b` 估算收入。

2026-10-13 实际下载核验了全部 149 个所需物品分片（原材料、成品、饮品、开箱材料）。过滤掉每日中位数后获得 556 个原始时间戳，覆盖北京时间 2026-08-14 至 2026-10-13；八个技能及三个综合指数均有 61 个自然日桶（两端可能不完整）。样本已用于计算和界面验证，不嵌入生产脚本作为行情兜底。

`tests/fixtures/official-snapshots.json` 取上述原始行情末尾三天，转换成脚本内部结构，用于离线回归测试。使用该 fixture 的浏览器截图属于集成测试结果，不是实际登录游戏后的截图。
