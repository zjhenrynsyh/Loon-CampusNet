# 更新记录

## loon-v13 · 2026-11-16 ★ 隐私清理 + 运行版本可见

- **隐私清理（公开仓库）**：移除内置学校名称与校园网 SSID 默认值，插件设置改为空白由用户填写；
  公开库提交历史中的真实姓名与设备主机名统一改为 GitHub 账号 `zjhenrynsyh` / `users.noreply` 邮箱。
- **可诊断性**：启动 `[诊断]` 行新增 `脚本=v13` 与服务顺序，一眼能确认手机是否真的拉到了新脚本
  （用户截图里出现旧版日志：raw 缓存未更新、`redirectortosuccess.jsp` 被当认证页、`userIndex` 未脱敏）。
- 认证逻辑不变；raw 缓存破坏 `?v=12` → `?v=13`。
- 验证：`node --check` + 10 场景 mock 通过；公开仓库文件与提交历史 grep 无真实姓名/学校名/SSID。

## loon-v12 · 2026-11-16 ★ 插件详情页主页 + 查看更新日志

- **主页功能**：插件头新增 `#!homepage`，指向 GitHub 仓库 README
  （`https://github.com/zjhenrynsyh/Loon-CampusNet/blob/main/README.md`），Loon 插件详情页可直接点开。
- **查看更新日志**：新增 Generic 手动脚本「查看更新日志」
  （`CampusNetChangelog.js?v=12`），在插件里手动触发后弹通知，点通知用 Safari 打开 GitHub `CHANGELOG.md`。
  两项都通过 GitHub 仓库实现，不写本地文件、不上传数据。
- **插件信息补齐**：`#!system = iOS,iPadOS,macOS`、`#!system_version = 14.0`，详情页显示支持平台。
- 认证脚本无逻辑改动，但 raw 缓存破坏统一 `?v=11` → `?v=12`，保证用户拉到新插件/新脚本。
- 验证：`node --check` + 通知 attach.openUrl 断言通过。

## loon-v11 · 2026-11-16 ★ 判定与稳定性增强

- **判定更严**：门户正文特征（`wlanuserip` / `wlanacname` / `queryString` / `eportal` / `InterFace.do` 等）
  即使返回 HTTP 200 也不再算「在线」，避免 200 直出登录页被误判放行。
- **200 直出登录页也能救**：从页面正文的 JS 跳转（`location.href=...`）或 `queryString=` 提取认证页参数，
  不再只依赖 302 Location；取不到参数时才回退网关 302。
- **重试前刷新参数**：「网关未放行」不再拿旧 q 白试——重新探测拿新认证页 queryString 再登录；
  若复核已放行则直接判成功。
- **设备未注册立即停**：识别「设备未注册」直接给自助平台注册/服务开通指引，不再换服务或重试（对齐 KSU v2.9）。
- **并发互斥**：cron 与 `network-changed` 可能同时触发，加 90 秒租约锁（`campusnet_run_lock`），避免双重登录互相打架。
- **诊断增强**：每次运行带 runId + 结束 outcome + 耗时；登录响应里的 `userIndex` 脱敏；
  所有 HTTP 请求加 12s 超时；网关配置归一化（填 `https://.../` 也能工作）。
- **验证**：`node --check` 通过；10 场景 mock 全过（v10 的 6 个 + 正文提取/未注册/刷新 q/并发锁 4 个）；
  请求均强制 `DIRECT` + `auto-redirect:false` + `timeout:12`，日志不出现 `userIndex` 原值。
- 插件 raw 缓存破坏 `?v=10` → `?v=11`。

## loon-v10 · 2026-11-16 ★ 国内验收口径对齐 + 诊断日志

- **协议级对齐**：验收口径从「只探国外 msftconnecttest」改为 **国内优先**
  （`connect.rom.miui.com/generate_204` 204 → `www.baidu.com` 200 → 国外兜底），
  与 macOS 1.5 / KSU / Windows 一致；国外被墙不再误报「门户成功但网关未放行」。
- **认证页识别收严**：`isPortalTarget()` 排除 `success` 系列（`redirectortosuccess.jsp` 谎报在线不再被当登录页）；
  200 直出门户正文单独识别，改从网关 302 取带 queryString 的认证页。
- **诊断日志**：新增 `[诊断]` 逐探测点行（状态码 / 跳转目标 / 判定），query 与 userIndex 脱敏；
  `console.log` 进 Loon 内置日志（仪表 → 脚本任务 / 工具 → 日志）；
  同时写 `$persistentStore['campusnet_diag_log']` 最近 100 行滚动副本，防 App 清日志后无证据。
  **不记账号、密码、queryString**。
- **插件**：raw 脚本缓存破坏 `?v=9` → `?v=10`；国内探测域名加入 `[Rule]` 直连；插件日期更新。
- **验证**：`node --check` 通过；6 场景本地 mock 全过
  （MIUI 204 在线 / 302 认证页登录 / 百度国内兜底 / 国外兜底 / 服务欠费换下一个 / success.jsp 谎报跳过）。

## loon-v9 · 2026-10-25

- **请求强制直连**：所有探测/登录请求加 `node: "DIRECT"`，Loon 切到全局代理时不再误判「已在线」
- **SSID 读不到时放行**：区分「读取失败」与「确实无 WiFi」，避免某些触发环境下插件静默失效
- **探测失败兜底**：探测请求本身失败（DNS 异常）时改试网关 302，仍避开 `success.jsp` 谎报
- 日志附带 Loon 运行模式，便于诊断代理干扰
- 插件头增加 `#!loon_version = 3.5.1(983)`

## loon-v8 · 2026-10-25

- **失败通知节流**：`$persistentStore` 记录时间戳，10 分钟内最多一条（定时器 2 分钟一轮，避免刷屏）
- 认证成功后清零节流标记

## loon-v7 · 2026-10-25

- **新增 WiFi 名称判断**：通过 `$config.getConfig().ssid` 读取当前 SSID，非校园网直接退出（零流量）
- 插件新增「校园网 WiFi 名称」设置项（支持多个、子串匹配、留空不限）
- 定时器改为全天每 2 分钟（有 SSID 闸门，开销可忽略）

## loon-v6 · 2026-10-25

- **精简认证链路**：移除 RSA 加密与登录页抓取（本校门户公钥为空，用不上），只保留明文模式
- 代码量 8.5KB → 7KB，失败点更少、速度更快

## loon-v5 · 2026-10-25 ★ 关键修复

- **改用明文密码模式**（`passwordEncrypt=false`）：日志显示本校门户 `publicKeyExponent/Modulus` 的 value 为空（由浏览器 JS 动态填充），解析页面永远拿不到公钥
- 公钥可用时仍走 RSA，公钥为空自动退回明文

## loon-v4 · 2026-10-25

- 改用桌面 UA 拉取登录页（portal 按 UA 返回不同页面）
- 增加 JS 变量形式公钥的兜底解析
- 诊断改为打印页面中 `publickey` 字样的上下文

## loon-v3 · 2026-10-25 ★ 关键修复

- **修正重定向参数**：Loon 禁止跟随重定向的参数是 `"auto-redirect": false`，此前误用 `redirect: false` 被忽略，导致 302 被自动跟随、拿不到认证页地址
- 增加页面内跳转跟随（meta refresh / JS location）
- 公钥解析失败时把页面内容分块打入日志

## loon-v2 · 2026-10-25

- 账号密码改为插件「设置」页填写（`[Argument]` + `$argument`），无需改脚本
- 服务顺序、检测频率、失败通知均可配置

## loon-v1 · 2026-10-25

- 首个版本：ePortal V3 协议移植（captive 探测 → 解析公钥 → RSA 加密 → 登录 → 二次验收）
- 多服务依次尝试（联通 / 校园网 / 移动 / 电信）
- 定时 + 切网触发
