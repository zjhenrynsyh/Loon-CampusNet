# 校园网自动认证 · KernelSU 模块

Android 上自动登录校园网（锐捷/深澜 RG-SAM+ ePortal V3，明文密码模式 `passwordEncrypt=false`）。
开机常驻守护进程：**WiFi 名称匹配 → 探测是否掉线 → 自动重新认证**。

> 与桌面版「校园网助手」、Loon 插件同源，协议一致；2026-10-25 手机端实测可用。

## 前提

- 手机已 root，并安装 **KernelSU / Magisk**（模块管理器）
- 系统自带 `curl`（多数机型自带；若没有，请装一个带 busybox 的模块，本模块会自动尝试 `/data/adb/ksu/bin/busybox curl`）

## 安装

1. 把 `CampusNetKSU-v1.0.zip` 传到手机
2. KernelSU / Magisk 管理器 → 模块 → **从本地安装** → 选这个 zip → 重启
3. 编辑配置（见下）后无需重启，下一轮检测自动生效；也可以立即在管理器里点模块的「**操作**」按钮测试一次

## 配置

安装时会自动生成 `/data/adb/campusnet/config.conf`（权限 600）：

```sh
# 认证网关
CFG_GATEWAY=172.16.54.18

# 学号 / 密码（密码含 & # 空格 等特殊字符无需转义，原样填写）
CFG_USER=你的学号
CFG_PASSWORD=你的密码

# 校园网 WiFi 名称（多个用逗号分隔、子串匹配；留空 = 不限网络）
CFG_SSID=iHBUT

# 服务尝试顺序：LT=联通 default=校园网 YD=移动 DX=电信
CFG_SERVICES=LT default YD DX

# 检测间隔（秒）
CFG_INTERVAL=60
```

改配置的两种方式：

- 用 MT 管理器 / 文件管理器（需 root）直接编辑
- 或用命令行：
  ```sh
  su -c 'vi /data/adb/campusnet/config.conf'
  ```

## 查看日志

```sh
su -c 'tail -n 50 /data/adb/campusnet/log.txt'
```

日志超 200 KB 自动轮转为 `log.txt.1`。

典型日志：

```
10-25 11:07:55 WiFi: iHBUT
10-25 11:07:56 检测到离线，开始认证: http://172.16.54.18/eportal/index.jsp?wlanuserip=...
10-25 11:07:56 登录返回[LT]: {"result":"fail","message":"您未开通该服务"}
10-25 11:07:56 服务[LT]不通: 您未开通该服务，尝试下一个
10-25 11:07:57 登录返回[default]: {"result":"success"}
10-25 11:07:57 认证成功（服务: default）
```

## 工作原理

| 步骤 | 说明 |
|---|---|
| 1. WiFi 判断 | `cmd wifi status` / `dumpsys wifi` 读 SSID，不在 `CFG_SSID` 里就跳过（不发任何请求） |
| 2. 掉线检测 | `GET http://www.msftconnecttest.com/connecttest.txt`：返回微软测试页=在线；302 到认证页=掉线 |
| 3. 认证 | 把认证页 URL 里的 queryString 一起 POST 到 `/eportal/InterFace.do?method=login`，`passwordEncrypt=false` |
| 4. 验收 | 认证后再探测一次外网，网关真放行才算成功（门户说成功但没放行会记失败） |
| 5. 服务切换 | 只有「服务未开通/欠费/资费」类错误才换下一个服务；密码错误立即停止 |

## 常见问题

**Q：日志提示「缺少 curl」**
装一个 busybox 模块即可（本模块会自动找 `/data/adb/ksu/bin/busybox`、`/data/adb/magisk/busybox`）。

**Q：一直显示「WiFi「xxx」不是校园网，跳过」**
把 `CFG_SSID` 改成你实际的校园网 WiFi 名（区分大小写，支持子串，如 `iHBUT` 可匹配 `iHBUT-5G`）。留空则不限网络。

**Q：为什么用明文密码而不是 RSA 加密？**
本校门户登录页的 RSA 公钥字段是空的（由浏览器 JS 动态填充），页面里 `passwordEncrypt` 默认为 `false`，浏览器在无公钥时就是明文提交。实测明文模式可正常认证。密码仅在校园网内网 HTTP 中传输，与浏览器行为一致。

**Q：会不会很耗电？**
不在校园网 WiFi 时只读一次 SSID（几毫秒）就退出，不发网络请求；在校园网且已在线时，每次只发一个几 KB 的探测请求。

**Q：怎么临时停用？**
KernelSU 管理器里关闭模块开关并重启，或 `su -c 'kill $(cat /data/adb/campusnet/daemon.pid)'`。

## 卸载

管理器里卸载模块即可，`/data/adb/campusnet/` 下的配置和日志会保留（方便重装后继续用），要彻底清除可手动删除该目录。

## 已知限制

- 网关启用验证码/二次验证时无法自动通过（日志会记录失败原因）
- 学校若改掉明文登录（强制 RSA），需要改脚本
- iOS 上的 Loon 版本见仓库另一个目录 `loon/`
