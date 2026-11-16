/**
 * 校园网自动认证 · Loon 脚本（明文密码模式）
 * ============================================
 * 协议：锐捷/深澜 RG-SAM+ ePortal V3
 *
 * 认证流程：
 *   ① captive 探测（国内优先：MIUI generate_204 → 百度；国外仅兜底）
 *      → 判断在线 / 离线（被网关劫持 302 → 认证页）/ 不在校园网
 *   ② 离线（拿到带 queryString 的认证页）→ 直接 POST 登录，passwordEncrypt=false 明文密码
 *   ③ 提交成功后再探测一次，国内连通才算登录成功（门户 success ≠ 真放行）
 *   ④ 按 serviceOrder 顺序逐个服务尝试（联通→校园网→移动→电信）
 *
 * 2026-11-16 loon-v10：对齐四端「国内验收」口径；新增 [诊断] 逐探测点日志
 *   · console.log → Loon App 内置日志（仪表 → 脚本任务 / 工具 → 日志）
 *   · $persistentStore['campusnet_diag_log'] 留最近 100 行滚动副本（不含密码）
 *
 * 说明：本部署登录页的 RSA 公钥留空（由浏览器 JS 动态填充），
 *      因此直接使用门户原生支持的明文模式（页面 passwordEncrypt 默认 false），
 *      与浏览器未启用加密时的提交行为一致。2026-10-25 手机端实测可自动登录。
 *
 * 账号密码在 Loon → 配置 → 插件 → 校园网助手 → 「设置」里填写
 * 需要 iOS 14+
 */

// ======================= 配置区 =======================
const arg = (typeof $argument === "object" && $argument) ? $argument : {};
const CONFIG = {
  // 认证网关（湖北工业大学默认 172.16.54.18）
  gateway: String(arg.gateway || "172.16.54.18").trim(),
  // 学号 / 密码（插件设置里填写，仅存于本机）
  user: String(arg.user || "").trim(),
  password: String(arg.password || ""),
  // 服务尝试顺序：LT=联通 default=校园网 YD=移动 DX=电信
  serviceOrder: String(arg.serviceOrder || "LT default YD DX").trim().split(/[\s,]+/).filter(Boolean),
  // 国内验收点（与 macOS / KSU / Windows 一致的主口径）：204/200=已放行；302→认证页=离线
  // 国外点只做兜底：国内网对它们常不可达，不能拿它们当唯一验收口径
  domesticProbes: ["http://connect.rom.miui.com/generate_204", "http://www.baidu.com/"],
  foreignProbes: [
    String(arg.probeURL || "http://www.msftconnecttest.com/connecttest.txt"),
    "http://captive.apple.com/hotspot-detect.html",
  ],
  // 校园网 WiFi 名称（多个用逗号分隔；留空=不限制，任意网络都尝试）
  // Loon 通过 $config.getConfig() 暴露当前 SSID，非校园网时直接退出，零流量
  ssidList: String(arg.ssid || "iHBUT").split(/[,，\s]+/).filter(Boolean),
  // 失败是否弹通知（插件设置里的开关；$argument 布尔/字符串都兼容）
  notifyFail: String(arg.notifyFail === undefined ? true : arg.notifyFail) !== "false",
};
// ======================================================

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

/* ---------------- 诊断日志 ----------------
 * Loon 没有 Mac 那种日志文件窗口：console.log 进 App 内置日志面板，
 * 这里再往 $persistentStore 写一份滚动副本，防止 App 清日志后无证据。
 * 只记状态码 / 跳转目标（去掉 query），不记账号、密码、queryString。
 */
const DIAG_KEY = "campusnet_diag_log";
const DIAG_MAX = 100;
function shortURL(u) {
  const s = String(u || "");
  const m = s.match(/^https?:\/\/([^\/]+)(\/[^?#]*)?/);
  return m ? m[1] + (m[2] || "/") : s.slice(0, 60);
}
function diag(msg) {
  const line = "[诊断] " + msg;
  console.log(line);
  try {
    const raw = $persistentStore.read(DIAG_KEY) || "";
    const arr = raw ? String(raw).split("\n").filter(Boolean) : [];
    arr.push(new Date().toISOString() + " " + line);
    while (arr.length > DIAG_MAX) arr.shift();
    $persistentStore.write(arr.join("\n"), DIAG_KEY);
  } catch (e) { /* 存储不可用时不影响主流程 */ }
}

/* ---------------- HTTP（$httpClient Promise 封装） ----------------
 * ⚠️ Loon 禁止跟随重定向的参数是 "auto-redirect": false（Build 660+），
 *    不是 redirect:false —— 后者会被忽略导致 302 被自动跟随、拿不到认证页地址
 */

function httpGet(url) {
  return new Promise((resolve) => {
    // node: "DIRECT" 强制直连：避免用户把 Loon 切成全局代理时，
    // 探测/登录请求被代理转发，导致误判「已在线」或认证失败
    $httpClient.get({ url: url, headers: { "User-Agent": UA }, "auto-redirect": false, node: "DIRECT" },
      (err, resp, data) => {
        if (err) return resolve({ error: String(err) });
        resolve({ status: +(resp.status || 0), headers: resp.headers || {}, body: data || "" });
      });
  });
}

function httpPost(url, body) {
  return new Promise((resolve) => {
    $httpClient.post({
      url: url,
      headers: { "User-Agent": UA,
                 "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: body,
      "auto-redirect": false,
      node: "DIRECT",
    }, (err, resp, data) => {
      if (err) return resolve({ error: String(err) });
      resolve({ status: +(resp.status || 0), headers: resp.headers || {}, body: data || "" });
    });
  });
}

function header(headers, name) {
  if (headers[name]) return headers[name];
  const lower = name.toLowerCase();
  for (const k in headers) if (k.toLowerCase() === lower) return headers[k];
  return "";
}

// 等价 JS encodeURIComponent 的双重编码（门户表单字段全部要双重编码）
function dEnc(s) { return encodeURIComponent(encodeURIComponent(s)); }

// 302 Location → 完整认证页 URL
function absPortal(loc) {
  if (/^https?:\/\//i.test(loc)) return loc;
  if (loc.charAt(0) === "/") return "http://" + CONFIG.gateway + loc;
  return "http://" + CONFIG.gateway + "/" + loc;
}

// 认证页判定：index.jsp / eportal 接口；⚠️ 必须排除 success 系列
// （/eportal/redirectortosuccess.jsp 也含 eportal，拿它当登录页会带错 queryString）
function isPortalTarget(u) {
  if (!u || /success/i.test(u)) return false;
  return /eportal|index\.jsp/i.test(u);
}
function looksPortalBody(body) {
  return /InterFace\.do|eportal\/index\.jsp|passwordEncrypt|publicKeyExponent/i.test(body || "");
}

function notify(title, subtitle, body) {
  $notification.post(title, subtitle || "", body || "");
}

// 失败通知节流：定时器每 2 分钟跑一次，密码错等情况避免刷屏（10 分钟最多一条）
const FAIL_KEY = "campusnet_last_fail_notify";
function notifyFailOnce(subtitle, body) {
  try {
    const now = Date.now();
    const last = +($persistentStore.read(FAIL_KEY) || 0);
    if (now - last < 10 * 60 * 1000) {
      console.log("失败通知已节流（10 分钟内只弹一次），本次原因: " + body);
      return;
    }
    $persistentStore.write(String(now), FAIL_KEY);
  } catch (e) { /* 存储不可用时照常通知 */ }
  notify("校园网助手", subtitle, body);
}

function clearFailMark() {
  try { $persistentStore.write("0", FAIL_KEY); } catch (e) {}
}

// 读取当前 WiFi 名称
// 返回 null = 环境不支持/读取失败（不据此拦截，继续按网络探测判断）
// 返回 "" = 确认没有 WiFi（蜂窝数据）
function currentSSID() {
  try {
    if (typeof $config === "object" && $config !== null && typeof $config.getConfig === "function") {
      const c = JSON.parse($config.getConfig() || "{}");
      if (!c || typeof c !== "object") return null;
      return String(c.ssid || "");
    }
    return null;
  } catch (e) {
    console.log("读取 SSID 失败: " + (e && e.message ? e.message : e));
    return null;
  }
}

// Loon 运行模式（0=全局直连 1=分流 2=全局代理），仅用于日志诊断
function runningModel() {
  try {
    if (typeof $config === "object" && $config !== null && typeof $config.getConfig === "function") {
      const c = JSON.parse($config.getConfig() || "{}");
      return c && c.running_model !== undefined ? String(c.running_model) : "?";
    }
  } catch (e) {}
  return "?";
}

/* ---------------- captive 探测 ----------------
 * 只信外网探测（实测网关自身 GET / 会对离线网口谎报 302→success.jsp）
 * 顺序：国内 204/200 → 国内 302→认证页 → 国外兜底 → 网关兜底（排除 success 谎报）
 * 返回：{ online:true } / { online:false, portal } / { online:false, reason } / { fail:true }
 */

async function probeOne(url, label) {
  const tag = label + "[" + shortURL(url) + "]";
  const r = await httpGet(url);
  if (r.error) {
    const line = tag + "=ERR " + r.error + " 判定=不可达";
    diag(line);
    return { line: line, r: r, portal: "", online: false, portalBody: false };
  }
  const loc = header(r.headers, "Location");
  const portal = loc && isPortalTarget(loc) ? absPortal(loc) : "";
  const portalBody = looksPortalBody(r.body);
  let verdict;
  if (portal) verdict = "劫持到认证页";
  else if (portalBody) verdict = "HTTP200直出认证页";
  else if (r.status === 204 || r.status === 200) verdict = "在线";
  else verdict = "HTTP" + r.status;
  const line = tag + "=" + r.status + (loc ? "→" + shortURL(portal || loc) : "") + " 判定=" + verdict;
  diag(line);
  return { line: line, r: r, portal: portal, online: verdict === "在线", portalBody: portalBody };
}

async function captiveProbe() {
  const lines = [];
  let portal200 = "";
  let anyResponse = false;

  // 1) 国内验收（主口径）：MIUI generate_204 → 百度
  // 2) 国外兜底：国内点全不可达时才用，且 200 才算在线
  const groups = [["国内", CONFIG.domesticProbes], ["国外", CONFIG.foreignProbes]];
  for (const group of groups) {
    for (const url of group[1]) {
      const p = await probeOne(url, group[0]);
      lines.push(p.line);
      if (!p.r.error) anyResponse = true;
      if (p.portal) {
        diag("状态判定: 离线(劫持到认证页) | " + lines.join(" | "));
        return { online: false, portal: p.portal, detail: lines.join(" | ") };
      }
      if (p.online) {
        diag("状态判定: 已放行(online) | " + lines.join(" | "));
        return { online: true, detail: lines.join(" | ") };
      }
      if (p.portalBody) portal200 = url;
    }
  }

  // 3) 网关兜底取认证页；网关 success.jsp 是谎报，绝不当在线
  const g = await httpGet("http://" + CONFIG.gateway + "/");
  const gloc = header(g.headers, "Location");
  const target = gloc && isPortalTarget(gloc) ? absPortal(gloc) : "";
  const gLine = "网关根=" + (g.error ? "ERR" : g.status) +
                (gloc ? "→" + shortURL(target || gloc) : "") +
                " 判定=" + (target ? "认证页" : (/success/i.test(gloc || "") ? "success谎报(不采信)" : "无认证页"));
  lines.push(gLine);
  diag(gLine);
  if (!anyResponse && g.error) return { fail: true, reason: "探测点与网关均无响应", detail: lines.join(" | ") };
  if (target) {
    diag("状态判定: 离线(网关给认证页) | " + lines.join(" | "));
    return { online: false, portal: target, detail: lines.join(" | ") };
  }
  const reason = portal200 ? "HTTP200直出认证页但网关未给 queryString" : "探测点全不可达";
  diag("状态判定: 跳过 | " + reason + " | " + lines.join(" | "));
  return { online: false, reason: reason, detail: lines.join(" | ") };
}

/* ---------------- 登录（明文密码模式） ----------------
 * 依次尝试 serviceOrder，仅"服务/欠费/资费"类错误才换下一个服务
 */

async function submitLogin(q) {
  for (const svc of CONFIG.serviceOrder) {
    const body = [
      ["userId", dEnc(CONFIG.user)],
      ["password", dEnc(CONFIG.password)],
      ["service", dEnc(svc)],
      ["queryString", dEnc(q)],
      ["operatorPwd", ""],
      ["operatorUserId", ""],
      ["validcode", ""],
      ["passwordEncrypt", dEnc("false")],
    ].map((kv) => kv[0] + "=" + kv[1]).join("&");

    const r = await httpPost("http://" + CONFIG.gateway + "/eportal/InterFace.do?method=login", body);
    if (r.error) { diag("登录请求失败(" + svc + "): " + r.error); continue; }
    diag("登录返回(" + svc + "): HTTP " + r.status + " " + (r.body || "").slice(0, 120));
    let j = null;
    try { j = JSON.parse(r.body); } catch (e) {}

    if (j && j.result === "success") {
      // 验收：门户说成功 ≠ 真认证，再探测一次（国内连通才算）
      const v = await captiveProbe();
      if (v.online) return { ok: true, svc: svc };
      diag("验收失败: 门户 success 但网关未放行 | " + (v.detail || ""));
      return { ok: false, msg: "门户返回成功但网关未放行（稍后自动重试）" };
    }
    const msg = (j && j.message) || "HTTP " + r.status;
    if (!/服务|service|欠费|缴费|资费/i.test(msg)) {
      return { ok: false, msg: msg };
    }
    diag("服务「" + svc + "」不通: " + msg + "，尝试下一个");
  }
  return { ok: false, msg: "全部服务尝试失败" };
}

/* ---------------- 主流程 ---------------- */

(async () => {
  let ssid = null;
  if (CONFIG.ssidList.length) {
    ssid = currentSSID();
    if (ssid === null) {
      // 读不到 SSID（环境不支持）：不拦截，继续按网络探测判断
      console.log("无法读取 SSID，改为按网络探测判断");
    } else if (!ssid) {
      console.log("当前非 WiFi（SSID 为空），跳过");
      return $done();
    } else {
      const hit = CONFIG.ssidList.some((s) => ssid === s || ssid.toLowerCase().indexOf(s.toLowerCase()) >= 0);
      if (!hit) {
        console.log("当前 WiFi「" + ssid + "」不是校园网，跳过");
        return $done();
      }
      console.log("WiFi: " + ssid + "（Loon 运行模式 " + runningModel() + "）");
    }
  }
  diag("启动: 网关=" + CONFIG.gateway + " 模式=" + runningModel() +
       " SSID=" + (ssid === null ? "未知" : (ssid || "无")) +
       " 国内点=" + CONFIG.domesticProbes.map(shortURL).join(","));

  const probe = await captiveProbe();
  if (probe.fail) {
    // 无响应：多半不在校园网 Wi-Fi（蜂窝/其他网络），静默退出
    console.log("探测无响应，跳过（" + probe.reason + "）");
    return $done();
  }
  if (probe.online) {
    console.log("已在线，无需认证");
    return $done();
  }
  if (!probe.portal) {
    console.log("未检测到认证页，跳过（" + (probe.reason || "") + "）");
    return $done();
  }

  const q = probe.portal.indexOf("?") >= 0 ? probe.portal.slice(probe.portal.indexOf("?") + 1) : "";
  console.log("检测到离线，开始认证: " + shortURL(probe.portal));
  let r = await submitLogin(q);
  // 「设备未注册 / 网关未放行」多为瞬时故障，等 3 秒重试一次
  if (!r.ok && /未注册|未放行/.test(r.msg)) {
    console.log("疑似瞬时故障，3 秒后重试一次");
    await new Promise((res) => setTimeout(res, 3000));
    r = await submitLogin(q);
  }

  if (r.ok) {
    clearFailMark();
    notify("校园网助手", "✅ 认证成功",
           CONFIG.user + "（服务: " + r.svc + "）\n已恢复上网");
  } else if (CONFIG.notifyFail) {
    console.log("认证失败: " + r.msg);
    notifyFailOnce("❌ 认证失败", r.msg);
  } else {
    console.log("认证失败: " + r.msg);
  }
  $done();
})().catch((e) => {
  console.log("脚本异常: " + (e && e.message ? e.message : e));
  $done();
});
