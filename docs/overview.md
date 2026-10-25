# 三端实现总览（Mac / Loon / KSU）

同一套协议（锐捷/深澜 RG-SAM+ ePortal V3）、三套平台实现。改 bug 前先看这份文档，确认**哪些改动需要三端同步**。

## 1. 三端对照

| 项目 | macOS App | iOS Loon 插件 | Android KernelSU 模块 |
|---|---|---|---|
| 语言/运行 | Swift + AppKit（菜单栏常驻） | JavaScript（Loon 脚本运行时） | POSIX sh（toybox/mksh） |
| 源码 | `Sources/*.swift` | `loon/校园网认证.js`、`loon/校园网助手.plugin` | `ksu-module/campusnet.sh` + 4 个挂载脚本 |
| 配置 | 设置窗口（钥匙串 + AES 盐存储） | 插件 `[Argument]` 设置页 | `/data/adb/campusnet/config.conf` |
| 触发 | 定时器 + 网络变化监听 + 唤醒 | `cron`（默认 */2）+ `network-changed` | 开机 `service.sh` 常驻循环（默认 60s） |
| 断线检测 | msftconnecttest 探测 | 同左 | 同左（curl） |
| SSID 判断 | 系统 WiFi 接口 | `$config.getConfig().ssid` | `cmd wifi status` / `dumpsys wifi` |
| 失败通知节流 | Toast 上限 3 条 | `$persistentStore` 10 分钟 | 日志去重（无通知，靠日志） |
| 版本标识 | `CampusNetLogin-1.4.dmg` | script `?v=9` | `versionCode=1`（v1.0） |

## 2. 协议不变量（三端一致，改一处必须改三处）

```
探测：GET http://www.msftconnecttest.com/connecttest.txt
      200 + "Microsoft Connect Test"  → 在线
      302 + Location 含 eportal|index.jsp → 离线，Location 即认证页（带 queryString）
      探测失败 → 网关根路径 302 兜底，但必须排除 302→success.jsp（网关谎报）
登录：POST http://<gateway>/eportal/InterFace.do?method=login
      userId / password / service / queryString / operatorPwd /
      operatorUserId / validcode / passwordEncrypt
      —— 所有字段「双重 URL 编码」
      —— passwordEncrypt=false（明文密码），本校门户 RSA 公钥为空，勿回退 RSA
验收：门户返回 success 后必须再探测一次，网关真放行才算成功
服务：顺序 LT → default → YD → DX；仅「服务/欠费/缴费/资费/service」类错误换下一个
```

## 3. 平台差异（不要互相搬）

| 事项 | Mac | Loon | KSU |
|---|---|---|---|
| 禁止跟随重定向 | `URLSession` 手动处理 302 | **`"auto-redirect": false`**（`redirect` 参数无效） | `curl --max-redirs 0` |
| 发送前编码 | `addingPercentEncoding` 两次 | `encodeURIComponent` 两次 | `od + awk` 按字节编码两次 |
| 数据持久化 | 钥匙串 + AES-256-GCM 文件盐 | `$persistentStore` | 普通配置文件（**行解析，不 source**） |
| 并发/单实例 | `loginQueue` 串行 + 登录代际 token | 单脚本串行 | `daemon.pid` |

## 4. 改动同步矩阵

| 改动类型 | Mac | Loon | KSU | 备注 |
|---|---|---|---|---|
| 探测逻辑 / 上线判定 | ✅ | ✅ | ✅ | 三端必须同步 |
| 登录字段 / 编码 / 明文模式 | ✅ | ✅ | ✅ | 三端必须同步 |
| 服务顺序 / 错误分类 | ✅ | ✅ | ✅ | 三端必须同步 |
| SSID 判断 | ✅ | ✅ | ✅ | 各端 API 不同，逻辑一致 |
| 通知节流 / 日志文案 | ✅ | ✅ | ✅ | 文案统一，机制各端适配 |
| UI / 菜单栏 / Toast | ✅ | — | — | Mac 独有 |
| Loon 参数体系 / `?v=N` | — | ✅ | — | Loon 独有 |
| 模块挂载 / 开机服务 / pidfile | — | — | ✅ | KSU 独有 |
| 钥匙串 / AES 盐存储 | ✅ | — | — | Mac 独有 |

## 5. 改完必做的验证

1. **Mac**：`./build.sh` 零警告 → 覆盖安装 `/Applications/校园网助手.app` → 确认进程在线、SSID 正确
2. **Loon**：`node --check loon/校园网认证.js` → 推 GitHub → **换 `?v=N+1`** → 用 `git clone` 核对远端与本地逐字节一致
3. **KSU**：`sh -n` 全部脚本 → 用假 curl 跑离线/在线/非校园网/蜂窝/服务切换/密码错误 6 场景 → 重新打包 zip
4. **测试前先下线**：在门户或浏览器点 Logout，否则探测到在线会静默跳过（不是 bug）
5. 推送后确认版本号已递增，并在交付说明里写清「改了哪几端、哪端没改及原因」

## 6. 关键路径

```
CampusNetLogin/
├── Sources/            Mac App 源码（PortalClient/AppDelegate/Connectivity/WiFiManager/Credentials…）
├── build.sh            构建 + 签名 + 安装
├── make_dmg.sh         打 DMG
├── loon/               Loon 插件与脚本
├── ksu-module/         Android 模块源码
├── CampusNetKSU-v1.0.zip
├── 代码审查报告.md       Mac 端 14 轮审查记录（54 项）
└── 三端实现总览.md      本文件
```

GitHub：<https://github.com/zjhenrynsyh/Loon-CampusNet>（Loon 插件 + `android-ksu/`）

## 7. 版本历史（协议相关）

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-10-24 | App 1.4 | 14 轮审查、54 项修复；RSA 登录（PC 页面有公钥） |
| 2026-10-25 | Loon v5 | 发现本校门户公钥为空 → 改用明文模式 |
| 2026-10-25 | Loon v6 | 移除 RSA/登录页解析链路；定时全天每 3 分钟 |
| 2026-10-25 | Loon v7 | 增加 SSID 判断（`$config.getConfig().ssid`） |
| 2026-10-25 | Loon v8 | 失败通知 10 分钟节流 |
| 2026-10-25 | Loon v9 | 请求强制 DIRECT、SSID 读不到时放行、探测失败网关兜底 |
| 2026-10-25 | KSU v1.0 | Android 模块首版（明文模式、SSID、开机守护） |
