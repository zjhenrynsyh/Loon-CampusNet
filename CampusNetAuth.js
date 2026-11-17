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
 * 2026-11-16 loon-v11：判定与稳定性增强
 *   · 门户正文特征（wlanuserip/wlanacname/queryString/eportal 等）即使 200 也不误判在线
 *   · 200 直出登录页时从正文 JS 跳转 / queryString= 提取参数，不再只靠 302
 *   · 「网关未放行」重试前刷新认证页参数；「设备未注册」立即停并给指引（对齐 KSU v2.9）
 *   · cron / network-changed 并发互斥（90s 租约锁）；runId + 耗时 + 结束行；响应脱敏；HTTP 12s 超时
 *   · 网关配置归一化（填 https://.../ 也能工作）
 *
 * 2026-11-16 loon-v13：隐私与可诊断性
 *   · 公开版本不再内置学校名 / SSID 默认值，改为留空由用户填写
 *   · 启动日志打印脚本版本号与服务顺序，避免 raw 缓存导致「以为已更新其实跑旧脚本」
 *
 * 2026-11-16 loon-v14 ★ 修 HTTP 超时单位（关键）
 *   · v11 把 $httpClient 的 timeout 写成 12，误以为是秒；Loon 实际单位是**毫秒**，
 *     导致每个请求 12ms 就超时（用户截图：0.3s 内全部请求 "Request timeout"）。
 *   · 改为 12000（12 秒），与 Mac 端 12s 超时一致；启动日志打印超时值便于确认。
 *
 * 2026-11-16 loon-v15：提交前连通性复核（四端协议级对齐）
 *   · 在 POST 登录前再用国内探测点快速确认一次；已放行则跳过登录（不 POST、不下线），
 *     覆盖「定时探测与登录之间用户手动认证成功」的时间差。
 *   · 仍未放行照常登录，不会一刀切跳过。
 *
 * 2026-11-16 loon-v16：版本可见 + 效率/省电优化
 *   · 版本号直接显示在插件详情页（#!date）、通知标题与更新提示中；
 *   · 连续失败指数退避（2min→5→10→20min 封顶），避免门户故障时每轮空跑；切网触发立即绕过退避；
 *   · 登录后验收先用 MIUI 短重试（1s）再回退完整链，成功判定更快；
 *   · 每个探测点日志带耗时，便于定位慢链路；一次性版本更新通知。
 *
 * 2026-11-16 loon-v17：再深挖一轮——更快 / 更省 / 更稳
 *   · 探测超时 8s / 登录 12s 分开；SSID 空值重读一次；诊断日志 7 天双阈值；
 *   · 显式开启 auto-cookie；全局代理日志提示。
 *
 * 2026-11-16 loon-v18：服务优先策略改成用户可选（撤销 v17 的默认行为）
 *   · 用户反馈：教学楼想优先校园网(default)、寝室想优先联通(LT)，不能强制「上次成功优先」。
 *   · 新增开关「优先上次成功服务」(preferLastGood)，**默认关闭**：按用户配置的「服务尝试顺序」执行；
 *     只有手动打开时才记住并提前上次成功服务。
 *
 * 2026-11-16 loon-v19：主动发现的新功能（不等用户提）
 *   · 保活：登录后记下 userIndex，已在线时每 60s 发一次 keepalive（对齐 Mac/KSU/Win），降低会话过期概率；
 *   · 新增三个手动入口：立即检测（绕过退避）、查看状态、复制诊断日志；
 *   · 每次运行把结果摘要写入 persistentStore，供「查看状态」脚本读取。
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
  // 认证网关（本校默认 172.16.54.18）；归一化掉协议头/尾斜杠
  gateway: String(arg.gateway || "172.16.54.18").trim()
            .replace(/^https?:\/\//i, "").replace(/\/+$/, ""),
  // 学号 / 密码（插件设置里填写，仅存于本机）
  user: String(arg.user || "").trim(),
  password: String(arg.password || ""),
  // 服务尝试顺序：LT=联通 default=校园网 YD=移动 DX=电信
  serviceOrder: String(arg.serviceOrder || "LT default YD DX").trim().split(/[\s,]+/).filter(Boolean),
  // 国内验收点（与 macOS / KSU / Windows 一致的主口径）：204/200=已放行；302→认证页=离线
  // 国外点只做兜底：国内网对它们常不可达，不能拿它们当唯一验收口径
  domesticProbes: ["http://connect.rom.miui.com/generate_204", "http://www.baidu.com/"],
  // 2026-11-17 修复：apple CNA 探测页在未认证校园网也返回 200，曾致误判在线跳过认证；
  // 换成 gstatic generate_204（真放行才 204，与 KSU/Mac 一致）
  foreignProbes: [
    "http://www.gstatic.com/generate_204",
    String(arg.probeURL || "http://www.msftconnecttest.com/connecttest.txt"),
  ],
  // 校园网 WiFi 名称（多个用逗号分隔；留空=不限制，任意网络都尝试）
  // Loon 通过 $config.getConfig() 暴露当前 SSID，非校园网时直接退出，零流量
  ssidList: String(arg.ssid || "").split(/[,，\s]+/).filter(Boolean),
  // 失败是否弹通知（插件设置里的开关；$argument 布尔/字符串都兼容）
  notifyFail: String(arg.notifyFail === undefined ? true : arg.notifyFail) !== "false",
  // v18：是否「优先上次成功服务」。默认关闭——按用户配置的服务顺序走，
  // 满足教学楼优先校园网(default)、寝室优先联通(LT)这类按地点切换的需求。
  preferLastGood: arg.preferLastGood === true || String(arg.preferLastGood) === "true",
  // 2026-11-17 四端对齐：自动认证总开关，默认开启（关闭后只检测不登录、下线保持）
  autoLogin: arg.autoLogin === undefined ? true :
             (arg.autoLogin === true || String(arg.autoLogin) !== "false"),
};
// ======================================================

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const SCRIPT_VERSION = "v21";
const STARTED_AT = Date.now();
const RUN_ID = new Date().toISOString().slice(11, 19) + "-" + Math.random().toString(36).slice(2, 6);

/* ---------------- 诊断日志 ----------------
 * Loon 没有 Mac 那种日志文件窗口：console.log 进 App 内置日志面板，
 * 这里再往 $persistentStore 写一份滚动副本，防止 App 清日志后无证据。
 * 只记状态码 / 跳转目标（去掉 query），不记账号、密码、queryString。
 */
const DIAG_KEY = "campusnet_diag_log";
const DIAG_MAX = 100;
const LOCK_KEY = "campusnet_run_lock";
const LOCK_LEASE_MS = 90 * 1000;
const BACKOFF_KEY = "campusnet_backoff_until";
const FAIL_STREAK_KEY = "campusnet_fail_streak";
const VERSION_KEY = "campusnet_last_version";
const GOOD_SVC_KEY = "campusnet_last_good_service";
const USERINDEX_KEY = "campusnet_userindex";
const KEEPALIVE_KEY = "campusnet_last_keepalive";
const LAST_RESULT_KEY = "campusnet_last_result";
const PROBE_TIMEOUT_MS = 8000;
const LOGIN_TIMEOUT_MS = 12000;
const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let FINISHED = false;

function shortURL(u) {
  const s = String(u || "");
  const m = s.match(/^https?:\/\/([^\/]+)(\/[^?#]*)?/);
  return m ? m[1] + (m[2] || "/") : s.slice(0, 60);
}
function safeBody(s) {
  return String(s || "")
    .replace(/userIndex["'\s:=]+[A-Za-z0-9%_-]+/gi, "userIndex=<...>")
    .replace(/queryString["'\s:=]+[A-Za-z0-9%_=&.-]+/gi, "queryString=<...>")
    .slice(0, 160);
}
function diag(msg) {
  const line = "[诊断][" + RUN_ID + "] " + msg;
  console.log(line);
  try {
    const raw = $persistentStore.read(DIAG_KEY) || "";
    const cutoff = new Date(Date.now() - LOG_MAX_AGE_MS).toISOString();
    // 行首是 ISO 时间戳，字典序比较即可按时间过滤；与 100 行上限双阈值，谁先到先删
    const arr = raw ? String(raw).split("\n").filter(Boolean).filter((l) => l >= cutoff) : [];
    arr.push(new Date().toISOString() + " " + line);
    while (arr.length > DIAG_MAX) arr.shift();
    $persistentStore.write(arr.join("\n"), DIAG_KEY);
  } catch (e) { /* 存储不可用时不影响主流程 */ }
}

// 并发互斥：cron 与 network-changed 可能几乎同时触发，90s 租约避免双重登录
function acquireLock() {
  try {
    const now = Date.now();
    const last = +($persistentStore.read(LOCK_KEY) || 0);
    if (last && now - last < LOCK_LEASE_MS) return false;
    $persistentStore.write(String(now), LOCK_KEY);
    return true;
  } catch (e) { return true; }
}
function releaseLock() {
  try { $persistentStore.write("0", LOCK_KEY); } catch (e) {}
}

/* 连续失败退避：避免门户/账号故障期间每 2 分钟空跑整套探测+4 次 POST。
 * 1 次失败不退避；之后 5 → 10 → 20 分钟封顶；成功/已在线/切网触发立即清零。
 * 绝不永久停摆（对齐 Mac 1.6 底线）。
 */
function backoffRemaining() {
  try {
    const until = +($persistentStore.read(BACKOFF_KEY) || 0);
    return until > Date.now() ? until - Date.now() : 0;
  } catch (e) { return 0; }
}
function clearBackoff() {
  try {
    $persistentStore.write("0", BACKOFF_KEY);
    $persistentStore.write("0", FAIL_STREAK_KEY);
  } catch (e) {}
}
function markFailure() {
  try {
    const n = Math.min(+($persistentStore.read(FAIL_STREAK_KEY) || 0) + 1, 99);
    $persistentStore.write(String(n), FAIL_STREAK_KEY);
    const minutes = n <= 1 ? 0 : (n === 2 ? 5 : (n === 3 ? 10 : 20));
    if (minutes > 0) {
      $persistentStore.write(String(Date.now() + minutes * 60 * 1000), BACKOFF_KEY);
      diag("连续失败 " + n + " 次，退避 " + minutes + " 分钟（切网触发可立即绕过）");
    }
  } catch (e) {}
}
function isNetworkTrigger() {
  try { return /切网|network|立即检测/i.test(String((typeof $script !== "undefined" && $script && $script.name) || "")); }
  catch (e) { return false; }
}

function finish(outcome) {
  if (FINISHED) return;
  FINISHED = true;
  const elapsed = ((Date.now() - STARTED_AT) / 1000).toFixed(1);
  diag("结束 outcome=" + outcome + " 耗时=" + elapsed + "s");
  try {
    $persistentStore.write(JSON.stringify({ v: SCRIPT_VERSION, outcome: outcome,
      at: new Date().toISOString(), elapsed: elapsed }), LAST_RESULT_KEY);
  } catch (e) {}
  releaseLock();
  $done();
}

/* ---------------- HTTP（$httpClient Promise 封装） ----------------
 * ⚠️ Loon 禁止跟随重定向的参数是 "auto-redirect": false（Build 660+），
 *    不是 redirect:false —— 后者会被忽略导致 302 被自动跟随、拿不到认证页地址
 */

function httpGet(url) {
  return new Promise((resolve) => {
    // node: "DIRECT" 强制直连：避免用户把 Loon 切成全局代理时，
    // 探测/登录请求被代理转发，导致误判「已在线」或认证失败
    $httpClient.get({
      url: url,
      headers: { "User-Agent": UA },
      "auto-redirect": false,
      "auto-cookie": true,
      node: "DIRECT",
      timeout: PROBE_TIMEOUT_MS,
    }, (err, resp, data) => {
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
      "auto-cookie": true,
      node: "DIRECT",
      timeout: LOGIN_TIMEOUT_MS,
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

// 302 Location → 完整认证页 URL（含协议相对 //host/path）
function absPortal(loc) {
  if (/^https?:\/\//i.test(loc)) return loc;
  if (/^\/\//.test(loc)) return "http:" + loc;
  if (loc.charAt(0) === "/") return "http://" + CONFIG.gateway + loc;
  return "http://" + CONFIG.gateway + "/" + loc;
}

// 从认证页 URL 取 queryString（去掉 #fragment，避免把锚点当参数）
function queryOf(url) {
  const s = String(url || "").split("#")[0];
  const i = s.indexOf("?");
  return i >= 0 ? s.slice(i + 1) : "";
}

// 认证页判定：index.jsp / eportal 接口；⚠️ 必须排除 success 系列
// （/eportal/redirectortosuccess.jsp 也含 eportal，拿它当登录页会带错 queryString）
function isPortalTarget(u) {
  if (!u || /success/i.test(u)) return false;
  return /eportal|index\.jsp/i.test(u);
}
function looksPortalBody(body) {
  return /InterFace\.do|eportal|index\.jsp|passwordEncrypt|publicKeyExponent|wlanuserip|wlanacname|queryString/i.test(body || "");
}

// 200 直出登录页时，尝试从正文里捞出认证页 URL / queryString
function extractPortalFromBody(body) {
  const s = String(body || "");
  let m = s.match(/(?:location(?:\.href)?\s*=|url\s*=)\s*['"]([^'"]*(?:eportal|index\.jsp)[^'"]*)['"]/i);
  if (!m) m = s.match(/action\s*=\s*['"]([^'"]*(?:InterFace\.do|eportal)[^'"]*)['"]/i);
  if (m) return m[1];
  m = s.match(/queryString\s*=\s*['"]([^'"]+)['"]/i);
  if (m) return "/eportal/index.jsp?queryString=" + m[1];
  return "";
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
      let s = String(c.ssid || "");
      // 重连瞬间 SSID 可能短暂为空：0.8s 后重读一次，避免误判「不在校园网」而白跳过一轮
      if (!s) {
        const cfg2 = JSON.parse($config.getConfig() || "{}");
        if (cfg2 && typeof cfg2 === "object") s = String(cfg2.ssid || "");
      }
      return s;
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
  const t0 = Date.now();
  const r = await httpGet(url);
  const cost = (Date.now() - t0) + "ms";
  if (r.error) {
    const line = tag + "=ERR " + r.error + " (" + cost + ") 判定=不可达";
    diag(line);
    return { line: line, r: r, portal: "", online: false, portalBody: false };
  }
  const loc = header(r.headers, "Location");
  let portal = loc && isPortalTarget(loc) ? absPortal(loc) : "";
  const portalBody = looksPortalBody(r.body);
  let fromBody = false;
  if (!portal && portalBody) {
    const found = extractPortalFromBody(r.body);
    if (found) { portal = absPortal(found); fromBody = true; }
  }
  let verdict;
  if (portal) verdict = fromBody ? "正文给出认证页" : "劫持到认证页";
  else if (portalBody) verdict = "HTTP200直出认证页(未取到参数)";
  else if (r.status === 204 || r.status === 200) verdict = "在线";
  else verdict = "HTTP" + r.status;
  const line = tag + "=" + r.status + (loc ? "→" + shortURL(portal || loc) : "") +
               " (" + cost + ") 判定=" + verdict;
  diag(line);
  return { line: line, r: r, portal: portal, online: verdict === "在线", portalBody: portalBody };
}

async function captiveProbe() {
  const lines = [];
  let portal200 = "";
  let anyResponse = false;

  // 1) 国内验收（主口径）：MIUI generate_204 → 百度
  // 2) 国外探测（2026-11-17 修复）：只用于识别「劫持到认证页」，不再凭它判在线
  //    事故：captive.apple.com 在未认证校园网也 200，曾据此误判在线→跳过自动认证。
  //    现与 KSU cn_cn_ok / Windows DomesticOnline 对齐：在线只认国内点。
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
      if (p.online && group[0] === "国内") {
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

/* ---------------- 提交前连通性复核 ----------------
 * 定时探测与真正 POST 之间可能有时间差（用户手动网页认证成功、网关会话刚同步）。
 * 再快速探一次国内点；已放行就跳过登录，不 POST、不下线。未放行照常登录。
 */
async function quickOnline() {
  for (const url of CONFIG.domesticProbes) {
    const r = await httpGet(url);
    if (!r.error && (r.status === 204 || r.status === 200) && !looksPortalBody(r.body)) return true;
  }
  return false;
}

// 登录后的快速验收：网关放行常有 1~2 秒传播延迟，先短重试 MIUI，
// 仍不通再回退完整探测链，避免每次都把 4~5 个探测点跑满。
async function verifyOnlineQuick() {
  const u = CONFIG.domesticProbes[0];
  for (let i = 0; i < 2; i++) {
    if (i > 0) await new Promise((res) => setTimeout(res, 1000));
    const r = await httpGet(u);
    if (!r.error && (r.status === 204 || r.status === 200) && !looksPortalBody(r.body)) {
      diag("验收: MIUI " + (i + 1) + " 次即放行");
      return true;
    }
  }
  diag("验收: MIUI 短重试未通，回退完整探测链");
  return (await captiveProbe()).online;
}

// 已在线时按 60s 间隔保活（对齐 Mac/KSU/Win）；失败不影响本轮判定，
// 会话真失效会在下一轮国内探测时暴露并触发登录。
async function keepaliveIfNeeded() {
  let ui = "";
  try { ui = $persistentStore.read(USERINDEX_KEY) || ""; } catch (e) {}
  if (!ui) return;
  let last = 0;
  try { last = +($persistentStore.read(KEEPALIVE_KEY) || 0); } catch (e) {}
  if (Date.now() - last < 60 * 1000) return;
  const r = await httpPost("http://" + CONFIG.gateway + "/eportal/InterFace.do?method=keepalive",
                           "userIndex=" + ui);
  if (!r.error) {
    try { $persistentStore.write(String(Date.now()), KEEPALIVE_KEY); } catch (e) {}
    diag("保活: 已续期（60s 间隔）");
  } else {
    diag("保活失败（不影响判定）: " + r.error);
  }
}

/* ---------------- 登录（明文密码模式） ----------------
 * 依次尝试 serviceOrder，仅"服务/欠费/资费"类错误才换下一个服务
 */

async function submitLogin(q) {
  if (await quickOnline()) {
    diag("提交前复核: 国内探测已放行，跳过登录（不 POST、不下线）");
    return { ok: true, skipped: true, svc: "-" };
  }
  diag("提交前复核: 仍未放行，继续登录");
  // 默认严格按用户配置的服务顺序；只有显式打开「优先上次成功服务」开关才提前
  const services = CONFIG.serviceOrder.slice();
  if (CONFIG.preferLastGood) {
    try {
      const good = $persistentStore.read(GOOD_SVC_KEY) || "";
      const idx = services.indexOf(good);
      if (idx > 0) {
        services.splice(idx, 1);
        services.unshift(good);
        diag("已开启「优先上次成功服务」: " + good);
      }
    } catch (e) {}
  }
  for (const svc of services) {
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
    diag("登录返回(" + svc + "): HTTP " + r.status + " " + safeBody(r.body));
    let j = null;
    try { j = JSON.parse(r.body); } catch (e) {}

    if (j && j.result === "success") {
      // 记下会话索引供保活使用（仅存本机，日志里已脱敏）
      if (j.userIndex) {
        try { $persistentStore.write(String(j.userIndex), USERINDEX_KEY); } catch (e) {}
      }
      // 验收：门户说成功 ≠ 真认证，再探测一次（国内连通才算）
      if (await verifyOnlineQuick()) {
        if (CONFIG.preferLastGood) {
          try { $persistentStore.write(svc, GOOD_SVC_KEY); } catch (e) {}
        }
        return { ok: true, svc: svc };
      }
      diag("验收失败: 门户 success 但网关未放行");
      return { ok: false, msg: "门户返回成功但网关未放行（将刷新认证页后重试）" };
    }
    const msg = (j && j.message) || "HTTP " + r.status;
    // 设备未注册是配置/注册问题，换服务与重试都无意义，直接给指引（对齐 KSU v2.9）
    if (/设备未注册|未注册/.test(msg)) {
      return { ok: false, msg: "门户提示设备未注册：请先在校园网自助平台注册该设备/确认服务已开通", noRetry: true };
    }
    if (!/服务|service|欠费|缴费|资费/i.test(msg)) {
      return { ok: false, msg: msg };
    }
    diag("服务「" + svc + "」不通: " + msg + "，尝试下一个");
  }
  return { ok: false, msg: "全部服务尝试失败" };
}

/* ---------------- 主流程 ---------------- */

(async () => {
  // 防止 cron 与 network-changed 并发执行两次登录
  if (!acquireLock()) {
    console.log("[诊断] 已有运行实例（" + (LOCK_LEASE_MS / 1000) + "s 租约），跳过本次触发");
    return $done();
  }

  // 2026-11-17 四端对齐：自动认证总开关（对齐 Mac/Windows）。关闭后只跳过，不 POST、不下线。
  if (!CONFIG.autoLogin) {
    console.log("[诊断] 自动认证开关已关闭，仅检测状态不登录");
    return finish("auto_login_disabled");
  }

  // 连续失败退避：切网触发立即绕过；cron 在退避窗口内静默跳过，绝不永久停摆
  if (isNetworkTrigger()) {
    clearBackoff();
  } else {
    const rem = backoffRemaining();
    if (rem > 0) {
      console.log("[诊断] 连续失败退避中，剩余 " + Math.ceil(rem / 1000) + "s，跳过本轮 cron");
      return finish("backoff_skip");
    }
  }

  if (!CONFIG.user || !CONFIG.password) {
    notify("校园网助手", "⚠️ 请先填写账号密码",
           "Loon → 配置 → 插件 → 校园网助手 → 「设置」里填写学号和密码");
    return finish("no_credentials");
  }

  let ssid = null;
  if (CONFIG.ssidList.length) {
    ssid = currentSSID();
    if (ssid === null) {
      // 读不到 SSID（环境不支持）：不拦截，继续按网络探测判断
      console.log("无法读取 SSID，改为按网络探测判断");
    } else if (!ssid) {
      console.log("当前非 WiFi（SSID 为空），跳过");
      return finish("no_wifi");
    } else {
      const hit = CONFIG.ssidList.some((s) => ssid === s || ssid.toLowerCase().indexOf(s.toLowerCase()) >= 0);
      if (!hit) {
        console.log("当前 WiFi「" + ssid + "」不是校园网，跳过");
        return finish("not_campus_wifi");
      }
      console.log("WiFi: " + ssid + "（Loon 运行模式 " + runningModel() + "）");
    }
  }
  const mode = runningModel();
  diag("启动: 脚本=" + SCRIPT_VERSION + " 网关=" + CONFIG.gateway + " 模式=" + mode +
       " SSID=" + (ssid === null ? "未知" : (ssid || "无")) +
       " 服务顺序=" + CONFIG.serviceOrder.join("→") +
       " 超时=探测" + PROBE_TIMEOUT_MS + "ms/登录" + LOGIN_TIMEOUT_MS + "ms" +
       " 国内点=" + CONFIG.domesticProbes.map(shortURL).join(","));
  if (mode === "2") diag("提示: Loon 处于全局代理模式；所有内网请求已强制 DIRECT，不受影响");
  // 版本可见：跨版本升级后弹一次通知；详情页 #!date 也带版本号
  try {
    const last = $persistentStore.read(VERSION_KEY) || "";
    $persistentStore.write(SCRIPT_VERSION, VERSION_KEY);
    if (last && last !== SCRIPT_VERSION) {
      notify("校园网助手 v" + SCRIPT_VERSION.slice(1), "脚本已更新",
             last + " → " + SCRIPT_VERSION + "，本次配置保持不变");
    }
  } catch (e) {}

  const probe = await captiveProbe();
  if (probe.fail) {
    // 无响应：多半不在校园网 Wi-Fi（蜂窝/其他网络），静默退出
    console.log("探测无响应，跳过（" + probe.reason + "）");
    return finish("probe_fail");
  }
  if (probe.online) {
    console.log("已在线，无需认证");
    clearBackoff();
    await keepaliveIfNeeded();
    return finish("already_online");
  }
  if (!probe.portal) {
    console.log("未检测到认证页，跳过（" + (probe.reason || "") + "）");
    return finish("no_portal");
  }

  const q = queryOf(probe.portal);
  console.log("检测到离线，开始认证: " + shortURL(probe.portal));
  let r = await submitLogin(q);
  // 「网关未放行」常是 queryString 过期/会话未同步：重新探测拿新参数再试一次
  if (!r.ok && /未放行/.test(r.msg)) {
    diag("网关未放行，刷新认证页参数后重试一次");
    const p2 = await captiveProbe();
    if (p2.online) {
      diag("复核已放行，视为登录成功");
      r = { ok: true, svc: "-" };
    } else {
      r = await submitLogin(p2.portal ? queryOf(p2.portal) : q);
    }
  }

  if (r.ok && r.skipped) {
    clearFailMark();
    clearBackoff();
    return finish("already_online_recheck");
  }
  if (r.ok) {
    clearFailMark();
    clearBackoff();
    notify("校园网助手 v" + SCRIPT_VERSION.slice(1), "✅ 认证成功",
           CONFIG.user + "（服务: " + r.svc + "）\n已恢复上网");
    return finish("login_success");
  }
  markFailure();
  if (CONFIG.notifyFail) {
    console.log("认证失败: " + r.msg);
    notifyFailOnce("❌ 认证失败", r.msg);
  } else {
    console.log("认证失败: " + r.msg);
  }
  return finish("login_fail");
})().catch((e) => {
  console.log("脚本异常: " + (e && e.message ? e.message : e));
  finish("script_error");
});
