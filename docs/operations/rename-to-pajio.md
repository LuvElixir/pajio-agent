# 技术名称统一为 pajio：已部署环境迁移

2026-10-12。代码、协议、数据库对象、服务名和安装包标识里的旧技术名称已全部改为 `pajio`。改名前构建并部署的环境**不能直接升级到这一版**：下表里的名字都会变，旧客户端、旧连接器和旧数据库对象与新代码互不识别。本次改动没有登录或修改任何线上主机。

## 变更范围

| 范围 | 新名称 | 对已部署环境的影响 |
| --- | --- | --- |
| Python 包与命令 | `pajio`（`src/pajio`，`uv run pajio …`） | 主机上的 venv、systemd `ExecStart` 需按新模板重装 |
| 本机数据目录 | `.pajio/`，主库 `pajio.sqlite3` | 开发机需迁移目录（见下文） |
| 安装路径与系统用户 | `/opt/pajio`、`/var/lib/pajio`、用户/组 `pajio` | 租户 VM 需按 `deploy/tenant/bootstrap.py` 重建 |
| systemd 单元 | `pajio-tenant.service`、`pajio-device-relay.service` 等 | 旧单元需停用并移除 |
| HTTP 头与 Cookie | `X-Pajio-Identity`、`X-Pajio-Token`、`X-Pajio-Tenant`、`X-Pajio-CSRF`、`__Host-pajio-session` | 旧客户端请求会被拒绝，已登录会话失效 |
| PostgreSQL | schema `pajio_control`、表 `pajio_*`、角色 `pajio_*`、会话变量 `pajio.*` | 见下文，不能原地改名 |
| Agent 工具名 | `pajio_list_devices`、`pajio_computer_observe` 等 | 引擎 profile 在下次启动时重写 |
| 设备连接器 | `com.pajio.connector.*`，`/opt/pajio-native` | 旧连接器需重新配对 |
| App 标识 | iOS/Android `io.luckyloading.pajio.mobile`，深链只保留 `pajio://` | 新的 App ID，测试设备需重新安装 |
| 桌面标识 | `io.luckyloading.pajio.desktop` | 重新安装 |

## PostgreSQL：重建，不做原地改名

RLS 策略表达式和 `SECURITY DEFINER` 函数体以文本形式写死了 schema 名和会话变量名，`ALTER SCHEMA … RENAME` 不会改写它们。原地改名的结果会表现为默认拒绝，而且很难排查。迁移方式：

1. 停止网关、注册、激活和清理服务。
2. 导出需要保留的数据（成员、邀请、实例路由），只导出行数据，不导出对象定义。
3. 新建控制库，执行 `deploy/control/postgres-roles.sql`，再执行 `pajio gateway database upgrade`。
4. 按新表名导入行数据，执行 `pajio gateway database check`。
5. 确认无误后删除旧库和旧角色。

当前只有内部测试账号，**建议直接重建并重新发邀请**，不迁移旧数据。

## 租户 VM 与设备

- 租户 VM：用新代码按 `deploy/tenant/bootstrap.py` 重新供应；它会拒绝在已存在 `/opt/pajio` 或 `/var/lib/pajio` 的主机上重复执行。
- Linux 云电脑、云手机：按 `deploy/on-prem/` 中新的单元重新安装设备运行包，再重新配对连接器。
- 迁移完成前，旧环境继续运行旧版本；不要把新旧版本混部到同一个租户。

## 开发机本地数据

`.pajio/` 被 Git 忽略。旧目录迁移后，内部文件也要一并改名（`pajio.sqlite3`、`hermes/pajio-profile.json`、`hermes/pajio-research.sqlite3`、`hermes/pajio-backups/`）。目录移动后，本机引擎的虚拟环境路径会失效，需要执行 `uv run pajio engine install` 重新安装固定版本的引擎；模型配置保留在数据目录中。
