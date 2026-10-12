![Pajio](design/brand/pajio/signature.png)

<p align="center"><a href="README.md">English</a> · <strong>简体中文</strong></p>
<p align="center"><a href="PRODUCT.md">产品路线</a> · <a href="docs/roadmap.md">路线图</a> · <a href="docs/getting-started.md">本地运行</a> · <a href="docs/README.md">文档</a></p>

# Pajio

Pajio 是一套个人 Agent 底座。每位用户拥有独立的运行环境，以及专属的云电脑和云手机，Agent 可以真正替用户操作。人格以人格包的形式插拔，通过邀请码一对一分发；默认人格是睡衣小熊。

当前处于**国内邀请制小范围内测**阶段。路线和边界见 [PRODUCT.md](PRODUCT.md)。

## 仓库结构

| 路径 | 内容 |
| --- | --- |
| `src/pajio/` | Python 核心：FastAPI 服务、CLI、Hermes 集成、目标、记忆、设备、计费 |
| `src/pajio/cloud/` | 云端控制面：OIDC 网关、邀请准入、租户 Worker、PostgreSQL、设备供应与回收 |
| `src/pajio/connectors/` | 设备连接器：文件、Android、远程设备 |
| `src/pajio/web/` | 网页端（定位待定，见路线图） |
| `clients/mobile/` | 原生 App：React Native / Expo，主力客户端 |
| `clients/desktop/` | 桌面预览：Tauri 外壳，计划替换为原生实现 |
| `native/private-input/` | Android 私密输入法 |
| `deploy/` | 控制面、租户 VM、本地机房主机、Keycloak 的部署文件 |
| `design/` | Pajio 品牌文件与睡衣小熊的角色、动作资产 |
| `docs/` | 架构、能力、运维、决策与验收记录，见 [文档索引](docs/README.md) |

## 本地运行

需要 Python 3.11+ 和 uv。

```bash
uv sync --extra dev
uv run pajio serve
```

打开 **http://127.0.0.1:8765**，按连接面板的提示安装引擎并配置模型。也可以用命令行：

```bash
uv run pajio engine install
uv run pajio engine model
```

本地数据保存在 `.pajio/` 目录，不进入 Git。

## 测试

```bash
uv run pytest -q
node --test tests/*.cjs
cd clients/mobile && npm test && ./node_modules/.bin/tsc --noEmit
```

依赖已安装引擎或专用 PostgreSQL 测试集群的用例会按环境条件跳过。

上游组件与许可证见 [第三方说明](THIRD_PARTY_NOTICES.md)。

<p align="center">由 <a href="https://luckyloading.com/">Luckyloading</a> 开发</p>
