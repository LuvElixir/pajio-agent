![Pajio](design/brand/pajio/signature.png)

<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>
<p align="center"><a href="PRODUCT.md">Product route</a> · <a href="docs/roadmap.md">Roadmap</a> · <a href="docs/getting-started.md">Run locally</a> · <a href="docs/README.md">Docs</a></p>

# Pajio

Pajio is a personal Agent platform. Each user gets an isolated runtime plus a dedicated cloud computer and cloud phone, so the Agent can operate on the user's behalf. Personas are pluggable packs distributed one-to-one through invitation codes; the default persona is the pajama bear.

Pajio is in a **small, invitation-only closed test in mainland China**. The route and its boundaries are defined in [PRODUCT.md](PRODUCT.md) (Chinese).

## Repository layout

| Path | Contents |
| --- | --- |
| `src/pajio/` | Python core: FastAPI service, CLI, Hermes integration, goals, memory, devices, usage |
| `src/pajio/cloud/` | Cloud control plane: OIDC gateway, invitations, tenant workers, PostgreSQL, device provisioning |
| `src/pajio/connectors/` | Device connectors: filesystem, Android, remote devices |
| `src/pajio/web/` | Web client (role under review, see the roadmap) |
| `clients/mobile/` | Native app: React Native / Expo, the primary client |
| `clients/desktop/` | Desktop preview: a Tauri shell, to be replaced by a native implementation |
| `native/private-input/` | Android private input method |
| `deploy/` | Control plane, tenant VM, on-prem host and Keycloak deployment files |
| `design/` | Pajio brand files and the pajama bear character and motion assets |
| `docs/` | Architecture, features, operations, decisions and acceptance records — see the [docs index](docs/README.md) |

## Run locally

Python 3.11+ and uv are required.

```bash
uv sync --extra dev
uv run pajio serve
```

Open **http://127.0.0.1:8765** and follow the connection panel to install the engine and configure a model, or use the CLI:

```bash
uv run pajio engine install
uv run pajio engine model
```

Local state lives in `.pajio/` and is excluded from Git.

## Tests

```bash
uv run pytest -q
node --test tests/*.cjs
cd clients/mobile && npm test && ./node_modules/.bin/tsc --noEmit
```

Tests that need an installed engine or a disposable PostgreSQL cluster are skipped when those are unavailable.

Upstream components and licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<p align="center">Built at <a href="https://luckyloading.com/">Luckyloading</a></p>
