# 验证主机恢复与云手机内核崩溃 · 2026-10-12

## 现象

宿主机 pve01 于 14:33 重启后，5 台 VM 全部未启动；`pajio-lab-network` 与 `pajio-health-watch` 失败。手动启动后，云手机 1412 每次开机约 5 分钟就失联：网卡不应答 ARP，来宾代理无响应，宿主机上该 VM 的 CPU 持续约 80%。

## 原因

1. **VM 未启动**：`pajio-lab-network` 只排在 `local-fs.target` 之后。开机时 pmxcfs 尚未就绪（`ipcc_send_rec ... Connection refused`），设备网络归属校验失败，按设计拒绝替换防火墙；`pve-guests` 依赖该单元，于是没有启动任何 VM。
2. **云手机崩溃**：10-11 06:10，unattended-upgrades 安装内核 6.8.0-146，只装了 `linux-modules`，没有装含 binder 驱动的 `linux-modules-extra`（`linux-virtual` 元包不依赖它）。重启后以新内核启动，没有 binder，Android 的 `servicemanager` 反复等待、崩溃；关键服务崩溃次数超限后，容器内的 Android init（特权容器，PID 1551 `init`）写入 `/proc/sysrq-trigger`，触发 `Kernel panic - not syncing: sysrq triggered crash`，导致整台 VM 崩溃，CPU 空转。

## 处理

- 单元增加 `After=/Requires=pve-cluster.service`，同步到主机（旧文件备份为 `/root/pajio-lab-network.service.bak-20261012`），重新应用网络隔离后按 1100 → 1401 → 1411/1412 顺序启动。健康检查恢复为 `healthy: true`。
- 云手机：重启后先停止 Android 容器，安装 `linux-modules-extra-6.8.0-146-generic` 与 `linux-image-extra-virtual`，加载 `binder_linux`，再启动容器。Android 约 10 秒完成启动（`sys.boot_completed=1`），连续观察 7 分钟网络与代理正常，无新的 panic。云电脑和云手机均重新连上核心实例的 8444 通道。
- 仓库：云手机的 cloud-init 包清单与 `setup-android-phone.sh` 增加 `linux-image-extra-virtual`，保证以后每次内核升级都带上 binder。
- 核心实例 1401 调整为 2 vCPU / 4GB；当时没有进行中的任务。KSM 阈值调整为 35%（旧配置备份为 `/root/ksmtuned.conf.bak-20261012`）。

## 未完成

- 特权 Android 容器仍能写 `/proc/sysrq-trigger`，一旦 Android 再次出现致命错误，仍会拖垮整台 VM。需要在不破坏 redroid 的前提下屏蔽该入口，并验证现有容器的迁移路径。
- `pajio-lab-network` 的新启动顺序要等下一次真实开机才能验证；本次没有为测试而重启主机。
- 云电脑 1411 授权的运维密钥与核心实例不同，本次未登录检查。
