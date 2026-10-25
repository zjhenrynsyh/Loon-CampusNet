# 校园网助手（三端同源）

校园网自动认证，覆盖 **macOS / iOS(Loon) / Android(KernelSU)** 三个平台。
协议：锐捷/深澜 RG-SAM+ ePortal V3（本校门户使用**明文密码模式** `passwordEncrypt=false`）。

## 目录

| 目录 | 内容 |
|---|---|
| `CampusNetHelper.plugin` | iOS Loon 插件（账号密码在插件设置里填写，`script-path` 指向本仓库脚本） |
| `CampusNetAuth.js` | Loon 认证脚本（自动跟随版本，URL 带 `?v=N` 防缓存） |
| `android-ksu/` | Android KernelSU 模块源码 + 安装包 `CampusNetKSU-v1.0.zip` |
| `docs/overview.md` | **三端实现总览：协议不变量、平台差异、同步矩阵、验证清单** |
| macOS App | 未公开（本地构建，DMG 分发） |

## iOS（Loon）

Loon → 配置 → 插件 → `+` → 从 URL 安装：

```
https://raw.githubusercontent.com/zjhenrynsyh/Loon-CampusNet/main/CampusNetHelper.plugin
```

安装后在插件「设置」里填写学号、密码、校园网 WiFi 名称即可。
Loon 3.5.1(983)+，iOS 14+。

## Android（KernelSU）

下载 [`android-ksu/CampusNetKSU-v1.0.zip`](android-ksu/CampusNetKSU-v1.0.zip) → 模块管理器「从本地安装」→ 重启
→ 编辑 `/data/adb/campusnet/config.conf` 填写学号密码。

## 共同特性

- WiFi 名称判断（非校园网零流量跳过）
- 掉线自动重连（切网秒级 + 定时轮询）
- 门户返回 success 后二次探测验收，避免「假成功」
- 服务顺序自动回退（联通 → 校园网 → 移动 → 电信）
- 失败通知节流，不刷屏

## 说明

账号密码只保存在设备本地，不上传任何服务器。明文密码仅在校园网内网传输，与浏览器未启用加密时的行为一致。
