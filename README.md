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

装好后进插件「设置」填：学号、密码、你的校园网 WiFi 名称（留空则不限制）。

要求：Loon 3.5.1(983)+、iOS 14+。当前脚本 `?v=13`（loon v13：隐私清理 + 运行版本可见；功能同 v12 加主页/更新日志）。

## 文件

| 文件 | 说明 |
|---|---|
| `CampusNetHelper.plugin` | 插件本体（`[Argument]` 设置项、`[Rule]` 直连规则、`[Script]` 触发，`#!homepage` 指向本 README） |
| `CampusNetAuth.js` | 认证脚本（插件通过 `script-path` 引用，URL 带 `?v=N` 防缓存） |
| `CampusNetChangelog.js` | Generic 手动脚本「查看更新日志」，点通知打开 GitHub `CHANGELOG.md` |
| `CHANGELOG.md` | 更新记录（也可以看仓库右侧的 Releases） |

## 主页与更新日志

- 插件详情页的「主页」来自插件头 `#!homepage`，指向本仓库 README（GitHub）。
- Loon 插件头没有官方 changelog 字段，所以「查看更新日志」做成了插件里的 **Generic 手动脚本**：
  在插件详情/脚本里点「查看更新日志」→ 弹一条通知 → 点通知用 Safari 打开本仓库 `CHANGELOG.md`。
- 两条路径都在 GitHub 仓库，不写本地文件、不上传任何数据。

## 认证方式

本校门户登录页的 `passwordEncrypt` 为 `false`（RSA 公钥字段为空、由浏览器 JS 动态填充），
因此脚本使用门户原生支持的**明文密码模式**提交，与浏览器未启用加密时的行为一致。
密码仅在校园网内网 HTTP 中传输，不会上传任何服务器。

## 触发策略

| 触发 | 频率 | 行为 |
|---|---|---|
| `network-changed` | 切网瞬间 | 连上校园网 WiFi 立即认证 |
| `cron` | 全天每 2 分钟 | 检测掉线并重连（不在校园网时零请求） |

失败通知 10 分钟最多一条，避免刷屏。`cron` 与 `network-changed` 同时触发时有 90 秒租约锁互斥，不会重复登录。

## 日志在哪看

- 脚本 `console.log`（含 `[诊断]` 逐探测点行）在 Loon App 的日志面板：
  「仪表 → 脚本任务」或「工具 → 日志」（不同版本入口名称略有差异）。
- 另外最近 100 行诊断记录写在本机 `$persistentStore['campusnet_diag_log']`，
  App 清日志后仍留底；只含状态码 / 跳转目标，**不含账号、密码、queryString**。
- 不写文件、不上传服务器。Mac 端的日志窗口/留存设置是桌面 App 独有功能，插件没有对应 UI。

## 说明

macOS 版与 Android 版为本项目同源实现，但都是本地安装（不需远程 URL），不在此仓库公开。

隐私：本公开仓库（含提交历史）不含真实姓名、学校名称、校园网 SSID、账号或密码；提交身份统一使用 GitHub 账号 `zjhenrynsyh`。
