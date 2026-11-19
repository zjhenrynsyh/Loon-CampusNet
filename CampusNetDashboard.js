/**
 * 校园网助手 · Web 管理后台（Loon Request Script）
 * ============================================================
 * 原理：Sub-Store 同款「虚拟主机名 + 请求脚本直接返回」——
 *   浏览器访问 http://zjhenrynsyh.github.io/campusnet ，Loon 的 http-request 脚本在请求发出前拦截，
 *   用 $done({response:{...}}) 直接返回本脚本生成的单页 HTML，无需外部服务器、无需 MitM 证书。
 *
 * 实时数据来源：读认证脚本写入的 $persistentStore（状态/日志/在线信息/版本等）。
 * 页面每 30s 自动刷新；操作按钮通过 URL query 触发（action=*）。
 *
 * 隐私：页面不显示账号密码；userIndex / 日志在认证脚本侧已脱敏；不写文件、不上传。
 * 铁律：后台绝不主动 logout/forceReauth；「立即检测」只清退避标志让下个 cron 正常跑，不碰会话。
 *
 * 版本：v22（随 Loon 插件 v22 发布）
 */
const DASH_VERSION = "v23";

// ---- 与认证脚本一致的持久化 key ----
const K = {
  log: "campusnet_diag_log",
  result: "campusnet_last_result",
  version: "campusnet_last_version",
  userIndex: "campusnet_userindex",
  keepalive: "campusnet_last_keepalive",
  goodSvc: "campusnet_last_good_service",
  backoff: "campusnet_backoff_until",
  failStreak: "campusnet_fail_streak",
  failNotify: "campusnet_last_fail_notify",
  // 后台专用：操作指令（认证脚本 cron 读取后清除并执行）
  cmd: "campusnet_dash_cmd"
};

function read(k) {
  try { return $persistentStore.read(k) || ""; } catch (e) { return ""; }
}
function write(k, v) {
  try { return $persistentStore.write(v, k); } catch (e) { return false; }
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function mask(s) {
  s = String(s || "");
  if (!s) return "—";
  if (s.length <= 4) return s[0] + "***";
  return s.slice(0, 2) + "***" + s.slice(-2);
}
function fmtAgo(ts) {
  const t = +ts;
  if (!t) return "—";
  const d = Math.max(0, Date.now() - t);
  if (d < 60000) return Math.floor(d / 1000) + " 秒前";
  if (d < 3600000) return Math.floor(d / 60000) + " 分钟前";
  if (d < 86400000) return Math.floor(d / 3600000) + " 小时前";
  return Math.floor(d / 86400000) + " 天前";
}
function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  try {
    return d.toLocaleString("zh-CN", { hour12: false });
  } catch (e) {
    return iso;
  }
}

// ---- 解析当前请求 URL：路径 + query ----
function currentURL() {
  try { return String(($request && $request.url) || ""); } catch (e) { return ""; }
}
function parseURL(u) {
  let path = "/", query = {};
  try {
    const qi = u.indexOf("?");
    const before = qi >= 0 ? u.slice(0, qi) : u;
    const q = qi >= 0 ? u.slice(qi + 1) : "";
    const mi = before.match(/^https?:\/\/[^/]+(\/[^#]*)?/);
    path = mi && mi[1] ? mi[1] : "/";
    q.split("&").forEach(function (kv) {
      if (!kv) return;
      const p = kv.indexOf("=");
      const k = p >= 0 ? kv.slice(0, p) : kv;
      const v = p >= 0 ? kv.slice(p + 1) : "";
      try { query[decodeURIComponent(k)] = decodeURIComponent(v); }
      catch (e) { query[k] = v; }
    });
  } catch (e) {}
  return { path: path, query: query };
}

// ---- 汇总实时数据 ----
function collect() {
  let last = {};
  try { last = JSON.parse(read(K.result) || "{}") || {}; } catch (e) {}
  const outcome = String(last.outcome || "等待首次检测");
  const online = /online|成功|放行|already|skip/i.test(outcome);
  const backoffUntil = +read(K.backoff) || 0;
  const lines = read(K.log).split("\n").filter(Boolean);
  return {
    dashVersion: DASH_VERSION,
    scriptVersion: last.v || read(K.version) || "未知",
    generatedAt: new Date().toISOString(),
    online: online,
    outcome: outcome,
    lastAt: last.at || "",
    lastAtText: fmtTime(last.at),
    elapsed: last.elapsed != null ? last.elapsed : "—",
    userIndex: mask(read(K.userIndex)),
    keepaliveAgo: fmtAgo(read(K.keepalive)),
    goodSvc: read(K.goodSvc) || "—",
    backoffLeft: backoffUntil > Date.now() ? Math.ceil((backoffUntil - Date.now()) / 60000) + " 分钟" : "无",
    failStreak: read(K.failStreak) || "0",
    logs: lines.slice(-40),
    loon: (function () { try { return String(typeof $loon !== "undefined" ? $loon : ""); } catch (e) { return ""; } })()
  };
}

// ---- JSON 接口：给前端 JS 定时拉取，实现不整页刷新的实时更新 ----
function jsonResponse(data) {
  const body = JSON.stringify({
    dash: data.dashVersion,
    script: data.scriptVersion,
    updated: data.generatedAt,
    online: data.online,
    outcome: data.outcome,
    lastAt: data.lastAtText,
    elapsed: data.elapsed,
    userIndex: data.userIndex,
    keepalive: data.keepaliveAgo,
    goodSvc: data.goodSvc,
    backoff: data.backoffLeft,
    failStreak: data.failStreak,
    logs: data.logs,
    loon: data.loon
  });
  return {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    },
    body: body
  };
}

// ---- 单页 HTML ----
function htmlPage(d) {
  const statusColor = d.online ? "#34c759" : "#ff9f0a";
  const statusText = d.online ? "已放行 · 在线" : "未放行 / 待检测";
  const logHtml = d.logs.length
    ? d.logs.map(function (l) { return "<div class='logline'>" + esc(l) + "</div>"; }).join("")
    : "<div class='logline muted'>暂无诊断日志</div>";
  const rows = [
    ["脚本版本", esc(d.scriptVersion)],
    ["后台版本", esc(d.dashVersion)],
    ["上次检测", esc(d.lastAtText)],
    ["检测耗时", esc(d.elapsed) + (d.elapsed !== "—" ? " s" : "")],
    ["上次服务", esc(d.goodSvc)],
    ["在线设备索引", esc(d.userIndex)],
    ["最近保活", esc(d.keepaliveAgo)],
    ["失败退避", esc(d.backoffLeft)],
    ["连续失败", esc(d.failStreak) + " 次"],
    ["运行环境", esc(d.loon || "Loon")]
  ].map(function (r) {
    return "<div class='kv'><span class='k'>" + r[0] + "</span><span class='v'>" + r[1] + "</span></div>";
  }).join("");

  return "<!doctype html><html lang='zh-CN'><head>" +
    "<meta charset='utf-8'>" +
    "<meta name='viewport' content='width=device-width,initial-scale=1,viewport-fit=cover'>" +
    "<title>校园网助手 · 控制台</title>" +
    "<style>" +
    ":root{color-scheme:dark}" +
    "*{box-sizing:border-box;margin:0;padding:0}" +
    "body{background:#0e0e11;color:#e8e8ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px 16px 40px;line-height:1.5}" +
    "h1{font-size:20px;font-weight:600;letter-spacing:.5px}" +
    ".sub{color:#8e8e96;font-size:12px;margin-top:4px}" +
    ".card{background:#1c1c20;border:1px solid #2c2c33;border-radius:14px;padding:16px;margin-top:16px}" +
    ".status{display:flex;align-items:center;gap:12px}" +
    ".dot{width:12px;height:12px;border-radius:50%;background:" + statusColor + ";flex:none}" +
    ".status b{font-size:17px;font-weight:600}" +
    ".outcome{color:#b9b9c0;font-size:13px;margin-top:8px;word-break:break-all}" +
    ".grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px}" +
    ".kv{display:flex;flex-direction:column;gap:2px;min-width:0}" +
    ".k{color:#8e8e96;font-size:11px}" +
    ".v{color:#f2f2f5;font-size:14px;word-break:break-all}" +
    ".sec-title{font-size:13px;color:#8e8e96;margin:18px 2px 8px;text-transform:uppercase;letter-spacing:.6px}" +
    ".logline{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#c9c9d1;padding:2px 0;border-bottom:1px solid #232329;word-break:break-all}" +
    ".muted{color:#6e6e76}" +
    ".btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}" +
    "a.btn{display:inline-block;text-decoration:none;background:#2c2c33;color:#f2f2f5;border:1px solid #3a3a43;border-radius:10px;padding:10px 14px;font-size:13px;font-weight:500}" +
    "a.btn.primary{background:#0b84ff;border-color:#0b84ff;color:#fff}" +
    ".note{color:#7e7e87;font-size:11px;margin-top:12px;line-height:1.6}" +
    ".flash{background:#12331f;border:1px solid #1d6b3a;color:#9ff0b8;border-radius:10px;padding:10px 12px;font-size:13px;margin-top:12px;display:none}" +
    "</style></head><body>" +
    "<h1>校园网助手 · 控制台</h1>" +
    "<div class='sub'>Sub-Store 式本地后台 · 每 30 秒自动更新 · " + esc(d.generatedAt.slice(11, 19)) + " UTC</div>" +
    "<div id='flash' class='flash'></div>" +
    "<div class='card'><div class='status'><span class='dot' id='dot'></span><b id='statusText'>" + esc(statusText) + "</b></div>" +
    "<div class='outcome' id='outcome'>" + esc(d.outcome) + "</div></div>" +
    "<div class='card'><div class='sec-title' style='margin-top:0'>实时数据</div><div class='grid'>" + rows + "</div></div>" +
    "<div class='sec-title'>操作</div><div class='btns'>" +
    "<a class='btn primary' href='http://zjhenrynsyh.github.io/campusnet/?action=check'>立即检测</a>" +
    "<a class='btn' href='javascript:location.href=location.pathname'>刷新</a>" +
    "<a class='btn' href='#' onclick='copyLog();return false'>复制日志</a>" +
    "</div><div class='note'>「立即检测」仅清除失败退避、让下个定时任务正常执行，不会主动下线或强制重新认证。账号密码由插件设置保存，页面不显示。</div>" +
    "<div class='sec-title'>诊断日志（最近 40 行）</div><div class='card' id='logs'>" + logHtml + "</div>" +
    "<script>" +
    "function apply(d){" +
    "var on=d.online;document.getElementById('dot').style.background=on?'#34c759':'#ff9f0a';" +
    "document.getElementById('statusText').textContent=on?'已放行 · 在线':'未放行 / 待检测';" +
    "document.getElementById('outcome').textContent=d.outcome;" +
    "var map={'脚本版本':d.script,'后台版本':d.dash,'上次检测':d.lastAt,'检测耗时':d.elapsed+' s','上次服务':d.goodSvc,'在线设备索引':d.userIndex,'最近保活':d.keepalive,'失败退避':d.backoff,'连续失败':d.failStreak+' 次','运行环境':d.loon};" +
    "document.querySelectorAll('.kv').forEach(function(el){var k=el.querySelector('.k').textContent;if(map[k]!=null)el.querySelector('.v').textContent=map[k];});" +
    "document.getElementById('logs').innerHTML=(d.logs&&d.logs.length)?d.logs.map(function(l){return '<div class=\"logline\">'+l.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</div>';}).join(''):'<div class=\"logline muted\">暂无诊断日志</div>';" +
    "}" +
    "function tick(){fetch('http://zjhenrynsyh.github.io/campusnet/api/status',{cache:'no-store'}).then(function(r){return r.json();}).then(apply).catch(function(){});}" +
    "function copyLog(){var t=Array.prototype.map.call(document.querySelectorAll('#logs .logline'),function(e){return e.textContent;}).join('\\n');if(navigator.clipboard)navigator.clipboard.writeText(t);var f=document.getElementById('flash');f.textContent='日志已复制到剪贴板';f.style.display='block';setTimeout(function(){f.style.display='none';},2000);}" +
    "setInterval(tick,30000);" +
    "</script></body></html>";
}

function respond(response) {
  $done({ response: response });
}

// ---- 主流程 ----
(function () {
  const parsed = parseURL(currentURL());
  const action = parsed.query.action || "";
  let notice = "";

  if (action === "check") {
    // 安全操作：只清除失败退避、写入检测指令，绝不 logout / forceReauth
    write(K.backoff, "0");
    write(K.failStreak, "0");
    write(K.cmd, String(Date.now()));
    notice = "已清除失败退避，下次定时任务将立即检测（未触碰当前会话）。";
  } else if (action === "clear") {
    write(K.cmd, "");
    notice = "已清除待执行指令。";
  }

  // JSON 接口（前端定时拉取）：兼容有无 /campusnet 路径前缀
  if (/\/api\/status(?:\?|$)/.test(parsed.path) || parsed.path.indexOf("/api/status") === 0) {
    respond(jsonResponse(collect()));
    return;
  }

  // 页面：action 处理后用脚本内刷新跳回根路径，避免重复触发
  const html = htmlPage(collect());
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  };
  if (action) {
    headers["Refresh"] = "2; url=http://zjhenrynsyh.github.io/campusnet/";
  }
  respond({ status: 200, headers: headers, body: html });
})();
