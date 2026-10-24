/**
 * 校园网自动认证 · Loon 脚本
 * ============================================
 * 协议：锐捷/深澜 RG-SAM+ ePortal V3
 * （与桌面版「校园网助手」同源逆向，2026-10-24 实测）
 *
 * 认证流程：
 *   ① captive 探测（msftconnecttest）→ 判断是否在线 / 拿认证页 URL
 *   ② 拉登录页解析 RSA 公钥（publicKeyExponent / publicKeyModulus）
 *   ③ 密码加密 = RSA_PKCS1v1.5( reverse(密码 + ">" + mac) )，输出 hex
 *   ④ POST /eportal/InterFace.do?method=login，全部表单字段双重 URL 编码
 *   ⑤ 提交成功后再探测一次外网，网关真放行才算登录成功
 *   ⑥ 按 serviceOrder 顺序逐个服务尝试（联通→校园网→移动→电信）
 *
 * 使用前必填：在 Loon → 配置 → 插件 → 校园网助手 → 「设置」里填写学号和密码
 *   （本脚本作为插件运行时自动从 $argument 读取；单独运行时用下方兜底值）
 * 需要 iOS 14+（脚本使用原生 BigInt 做大数 RSA 运算）
 */

// ======================= 配置区 =======================
// 插件 [Argument] 传参优先；直接当独立脚本跑（$argument 为空）时用下面的默认值
const arg = (typeof $argument === "object" && $argument) ? $argument : {};
const CONFIG = {
  // 认证网关（湖北工业大学默认 172.16.54.18，其他学校按实际改）
  gateway: String(arg.gateway || "172.16.54.18").trim(),
  // 学号 / 密码（在 Loon 插件设置里填写，明文仅存于你手机本机，不会上传任何服务器）
  user: String(arg.user || "").trim(),
  password: String(arg.password || ""),
  // 服务尝试顺序：LT=联通 default=校园网 YD=移动 DX=电信
  // （第 1 个不通会按顺序自动换下一个；"服务/欠费"类错误才换，密码错误直接停）
  serviceOrder: String(arg.serviceOrder || "LT default YD DX").trim().split(/[\s,]+/).filter(Boolean),
  // captive 探测地址（微软连通性测试，被网关劫持即判定离线）
  probeURL: "http://www.msftconnecttest.com/connecttest.txt",
  // 失败是否弹通知（插件设置里的开关；$argument 布尔/字符串都兼容）
  notifyFail: String(arg.notifyFail === undefined ? true : arg.notifyFail) !== "false",
};
// ======================================================

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
           "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

/* ---------------- HTTP（$httpClient Promise 封装） ----------------
 * ⚠️ Loon 禁止跟随重定向的参数是 "auto-redirect": false（Build 660+），
 *    不是 redirect:false —— 后者会被忽略导致 302 被自动跟随、拿不到认证页地址
 */

function httpGet(url) {
  return new Promise((resolve) => {
    $httpClient.get({ url: url, headers: { "User-Agent": UA }, "auto-redirect": false },
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

/* ---------------- 工具 ---------------- */

// 等价 JS encodeURIComponent 的双重编码（门户表单字段全部要双重编码）
function dEnc(s) { return encodeURIComponent(encodeURIComponent(s)); }

// JS split("").reverse().join("") —— 与门户 login_bch.js 一致
function strReverse(s) { return s.split("").reverse().join(""); }

// UTF-8 编码为字节数组（密码场景基本是 ASCII，此处完整实现以防万一）
function utf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.codePointAt(i);
    if (c > 0xffff) i++;                       // 跳过代理对低位
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

// 从登录页 HTML 抓隐藏域（id 或 name 匹配，value 为 hex；value 在前在后都兼容）
function grab(html, id) {
  const m = html.match(new RegExp('(?:id|name)\\s*=\\s*["\']?' + id + '["\']?[^>]*?value\\s*=\\s*["\']?([0-9a-fA-F]+)', "i"))
        || html.match(new RegExp('value\\s*=\\s*["\']?([0-9a-fA-F]+)["\']?[^>]*?(?:id|name)\\s*=\\s*["\']?' + id, "i"));
  return m ? m[1] : "";
}

// 页面内跳转检测（meta refresh / JS location，仅对跳转壳小页面有意义）
function pageRedirect(html) {
  if (html.length > 3000) return null;           // 真登录页很大，不误判
  let m = html.match(/http-equiv\s*=\s*["']?refresh["']?[^>]*?url\s*=\s*([^"'>\s]+)/i);
  if (m) return m[1].replace(/['"]$/, "").trim();
  m = html.match(/location\.(?:href|replace)\s*[\(=]\s*["']([^"']+)["']/i);
  if (m) return m[1];
  m = html.match(/window\.location\s*=\s*["']([^"']+)["']/i);
  if (m) return m[1];
  return null;
}

// 从 query string 取参数（单次解码足够，mac 是 hex 值）
function queryParam(q, name) {
  if (!q) return null;
  for (const kv of q.split("&")) {
    const i = kv.indexOf("=");
    if (i < 0) continue;
    if (kv.slice(0, i) === name) return decodeURIComponent(kv.slice(i + 1));
  }
  return null;
}

// 302 Location → 完整认证页 URL
function absPortal(loc) {
  if (/^https?:\/\//i.test(loc)) return loc;
  if (loc.charAt(0) === "/") return "http://" + CONFIG.gateway + loc;
  return "http://" + CONFIG.gateway + "/" + loc;
}

function notify(title, subtitle, body) {
  $notification.post(title, subtitle || "", body || "");
}

/* ---------------- RSA（PKCS#1 v1.5 type 2，原生 BigInt 实现） ----------------
 * 输出 hex 不补前导零 —— 与门户 login_bch.js 内 jsbn 的 BigInteger.toString(16) 一致
 */

function modPow(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = result * base % mod;
    base = base * base % mod;
    exp >>= 1n;
  }
  return result;
}

function rsaEncryptHex(bytes, expHex, modHex) {
  const n = BigInt("0x" + modHex);
  const e = BigInt("0x" + expHex);
  const k = (modHex.length + 1) >> 1;          // 模数字节长度
  if (bytes.length > k - 11) return null;       // PKCS#1 v1.5 最少 11 字节开销
  // EM = 0x00 || 0x02 || PS(非零随机) || 0x00 || M
  const psLen = k - 3 - bytes.length;
  const EM = [0x00, 0x02];
  for (let i = 0; i < psLen; i++) {
    EM.push(1 + Math.floor(Math.random() * 255));   // 1..255 非零
  }
  EM.push(0x00);
  for (const b of bytes) EM.push(b);
  let m = 0n;
  for (const b of EM) m = (m << 8n) | BigInt(b);
  return modPow(m, e, n).toString(16);
}

/* ---------------- captive 探测 ----------------
 * 只信外网探测（实测网关自身 GET / 可能对已下线网口谎报 success）
 */

async function captiveProbe() {
  const r = await httpGet(CONFIG.probeURL);
  if (r.error) return { fail: true, reason: r.error };
  const loc = header(r.headers, "Location");
  const body = r.body || "";
  if (r.status === 200 && /Microsoft Connect Test/i.test(body)) return { online: true };

  let portal = null;
  if (r.status === 302 && loc && /eportal|index\.jsp/i.test(loc)) {
    portal = absPortal(loc);                       // 被网关劫持 → Location 就是认证页
  } else if (r.status === 200 && /eportal|InterFace\.do|publicKeyExponent/i.test(body)) {
    // 200 直出认证页（auto-redirect 失效或部署不 302）：确认离线，但拿不到重定向地址
    return { online: false, reason: "HTTP 200 直出认证页（缺少 queryString）" };
  } else {
    // 状态异常 → 从网关 302 兜底拿认证页（注意网关可能谎报 302→success.jsp，正则已排除）
    const g = await httpGet("http://" + CONFIG.gateway + "/");
    const gloc = header(g.headers, "Location");
    if (g.status === 302 && gloc && /eportal|index\.jsp/i.test(gloc)) portal = absPortal(gloc);
  }
  if (portal) return { online: false, portal: portal };
  return { online: false, reason: "HTTP " + r.status };
}

// 手动跟随重定向拉登录页（3xx Location + 页面内 meta refresh / JS 跳转都跟）
async function fetchLoginPage(portal) {
  let url = portal;
  for (let i = 0; i < 3; i++) {
    const page = await httpGet(url);
    if (page.error) return { error: page.error };
    if (page.status >= 300 && page.status < 400) {
      const loc = header(page.headers, "Location");
      if (loc) { url = absPortal(loc); continue; }
    }
    const redir = pageRedirect(page.body || "");
    if (redir) { url = absPortal(redir); continue; }
    return { status: page.status, html: page.body || "" };
  }
  return { error: "重定向次数过多" };
}

/* ---------------- 登录 ---------------- */

async function login(portal) {
  const q = portal.indexOf("?") >= 0 ? portal.slice(portal.indexOf("?") + 1) : "";

  // 拉登录页解析 RSA 公钥（失败自动重试一次；portal 偶发返回 88 字节的
  // GBK 弹窗页「WEB认证设备未注册…」，重试通常可恢复）
  let exp = "", mod = "";
  for (let attempt = 1; attempt <= 2 && (!exp || !mod); attempt++) {
    const page = await fetchLoginPage(portal);
    if (page.error) { console.log("登录页请求失败(" + attempt + "): " + page.error); continue; }
    exp = grab(page.html, "publicKeyExponent");
    mod = grab(page.html, "publicKeyModulus");
    if (!exp || !mod) {
      const text = (page.html || "(空)").replace(/\s+/g, " ");
      console.log("登录页未含公钥(" + attempt + "), HTTP " + page.status + ", 长度 " + text.length);
      const bodyIdx = text.search(/<body/i);
      const dump = bodyIdx >= 0 ? text.slice(bodyIdx) : text;
      for (let i = 0; i < dump.length && i < 2400; i += 400) {
        console.log("页面[" + i + "]: " + dump.slice(i, i + 400));
      }
    }
  }
  if (!exp || !mod) return { ok: false, msg: "登录页解析失败（未取到 RSA 公钥，详见日志）" };

  // mac 取认证页 URL 参数（缺省 111111111，与门户前端一致）
  const mac = queryParam(q, "mac") || queryParam(q, "wlanparameter") || "111111111";
  const pwd = rsaEncryptHex(utf8Bytes(strReverse(CONFIG.password + ">" + mac)), exp, mod);
  if (!pwd) return { ok: false, msg: "RSA 加密失败（密码过长？）" };

  for (const svc of CONFIG.serviceOrder) {
    const body = [
      ["userId", dEnc(CONFIG.user)],
      ["password", dEnc(pwd)],
      ["service", dEnc(svc)],
      ["queryString", dEnc(q)],
      ["operatorPwd", ""],
      ["operatorUserId", ""],
      ["validcode", ""],
      ["passwordEncrypt", dEnc("true")],
    ].map((kv) => kv[0] + "=" + kv[1]).join("&");

    const r = await httpPost("http://" + CONFIG.gateway + "/eportal/InterFace.do?method=login", body);
    if (r.error) { console.log("登录请求失败(" + svc + "): " + r.error); continue; }
    console.log("登录返回(" + svc + "): " + (r.body || "").slice(0, 200));
    let j = null;
    try { j = JSON.parse(r.body); } catch (e) {}

    if (j && j.result === "success") {
      // 验收：门户说成功 ≠ 真认证，再探测一次外网
      const v = await captiveProbe();
      if (v.online) return { ok: true, svc: svc };
      return { ok: false, msg: "门户返回成功但网关未放行（queryString 可能过期，稍后自动重试）" };
    }
    const msg = (j && j.message) || "HTTP " + r.status;
    // 仅"服务类"错误（服务/欠费/资费）才继续换下一个；密码错误等直接停
    if (!/服务|service|欠费|缴费|资费/i.test(msg)) {
      return { ok: false, msg: msg };
    }
    console.log("服务「" + svc + "」不通: " + msg + "，尝试下一个");
  }
  return { ok: false, msg: "全部服务尝试失败" };
}

/* ---------------- 主流程 ---------------- */

(async () => {
  if (typeof BigInt === "undefined") {
    notify("校园网助手", "", "运行环境不支持 BigInt，请升级到 iOS 14+");
    return $done();
  }

  if (!CONFIG.user || !CONFIG.password) {
    notify("校园网助手", "⚠️ 请先填写账号密码",
           "Loon → 配置 → 插件 → 校园网助手 → 「设置」里填写学号和密码");
    return $done();
  }

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

  console.log("检测到离线，开始认证: " + probe.portal.slice(0, 120));
  let r = await login(probe.portal);
  // 「设备未注册 / 网关未放行」多为瞬时故障（或深夜断网时段），等 3 秒重试一次
  if (!r.ok && /未注册|未放行/.test(r.msg)) {
    console.log("疑似瞬时故障，3 秒后重试一次");
    await new Promise((res) => setTimeout(res, 3000));
    r = await login(probe.portal);
  }
  if (r.ok) {
    notify("校园网助手", "✅ 认证成功",
           CONFIG.user + "（服务: " + r.svc + "）\n手机已恢复上网");
  } else if (CONFIG.notifyFail) {
    console.log("认证失败: " + r.msg);
    notify("校园网助手", "❌ 认证失败", r.msg);
  } else {
    console.log("认证失败: " + r.msg);
  }
  $done();
})().catch((e) => {
  console.log("脚本异常: " + (e && e.message ? e.message : e));
  $done();
});
