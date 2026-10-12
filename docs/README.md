# Pajio 文档

先读 [PRODUCT.md](../PRODUCT.md)（路线）和 [路线图](roadmap.md)（当前状态与下一步）。

| 目录 | 内容 |
| --- | --- |
| [getting-started.md](getting-started.md) | 本地运行：引擎、模型、电脑与手机接入 |
| [decisions/](decisions/) | 已定决策，每篇一个决定 |
| [architecture/](architecture/) | 平台如何工作：SaaS 与租户、网关、数据库、引擎、身份、设备、客户端 |
| [features/](features/) | Agent 能力：目标、记忆、主动跟进、生活工具、确认卡、结果交付 |
| [design/](design/) | 各端的设计记录；App 设计系统见 [clients/mobile/DESIGN.md](../clients/mobile/DESIGN.md) |
| [contracts/](contracts/) | 接口与数据合同 |
| [operations/](operations/) | 部署、供应、运维与迁移 |
| [evidence/](evidence/) | 真实验收记录，按日期保存，不改写 |
| [archive/](archive/) | 已被取代的计划、研究、交接和进度日志；只作历史参考 |

## 写文档的约定

- 当前事实写进 `PRODUCT.md`、`roadmap.md` 或对应的参考文档，并直接改写；不按日期往下追加。
- 新的决定写成 `decisions/` 下的新文件；被推翻时新增一篇，并在旧篇中注明被哪篇取代。
- 验收记录写进 `evidence/`，文件名带日期，写完不再修改。
- 计划完成或被放弃后移入 `archive/`。
