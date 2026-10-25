# 校园网助手 · Loon 插件

iPhone 上自动登录校园网（锐捷/深澜 RG-SAM+ ePortal V3）。

- 连上校园网 WiFi → 自动认证；掉线后定时检测 → 自动重连
- 非校园网 WiFi / 蜂窝数据 → 直接跳过（零流量）
- 账号密码在插件「设置」里填写，只存本机

## 安装

Loon → 配置 → 插件 → 右上角 `+` → 从 URL 安装：

```
https://raw.githubusercontent.com/zjhenrynsyh/Loon-CampusNet/main/CampusNetHelper.plugin
```

装好后进插件「设置」填：学号、密码、校园网 WiFi 名称（默认 `iHBUT`）。

要求：Loon 3.5.1(983)+、iOS 14+。

## 文件

| 文件 | 说明 |
|---|---|
| `CampusNetHelper.plugin` | 插件本体（`[Argument]` 设置项、`[Rule]` 直连规则、`[Script]` 触发） |
| `CampusNetAuth.js` | 认证脚本（插件通过 `script-path` 引用，URL 带 `?v=N` 防缓存） |
| `CHANGELOG.md` | 更新记录（也可以看仓库右侧的 Releases） |

## 认证方式

本校门户登录页的 `passwordEncrypt` 为 `false`（RSA 公钥字段为空、由浏览器 JS 动态填充），
因此脚本使用门户原生支持的**明文密码模式**提交，与浏览器未启用加密时的行为一致。
密码仅在校园网内网 HTTP 中传输，不会上传任何服务器。

## 触发策略

| 触发 | 频率 | 行为 |
|---|---|---|
| `network-changed` | 切网瞬间 | 连上校园网 WiFi 立即认证 |
| `cron` | 全天每 2 分钟 | 检测掉线并重连（不在校园网时零请求） |

失败通知 10 分钟最多一条，避免刷屏；日志可在 Loon 脚本页面查看。

## 说明

macOS 版与 Android 版为本项目同源实现，但都是本地安装（不需远程 URL），不在此仓库公开。
