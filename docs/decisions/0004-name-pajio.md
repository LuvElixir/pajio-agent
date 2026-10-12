# 0004 · 统一名称为 Pajio，小熊是唯一角色

2026-10-12 · 已决定

## 决定

- 产品名、代码包名、命令、协议、数据库对象、服务名和安装包标识统一为 `pajio`。旧的开发代号及其角色、品牌资产全部移除，只在 Git 历史中保留。
- 仓库目录名同步改为 `pajio`。
- 睡衣小熊是唯一角色，作为默认人格包存在。

## 影响

改名前部署的测试环境不能原地升级：HTTP 头、Cookie、PostgreSQL schema 与角色、systemd 单元、连接器标识和 App bundle id 都已改变。迁移方式见 [改名迁移](../operations/rename-to-pajio.md)。
