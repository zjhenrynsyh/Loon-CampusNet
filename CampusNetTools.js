/**
 * 校园网助手 · 手动小工具（Generic Script）
 * 用法：在插件里点对应入口，脚本按 $script.name 分流，不写文件、不上传。
 */
const VER = "v23";
const LOG_KEY = "campusnet_diag_log";
const RESULT_KEY = "campusnet_last_result";

function read(key) {
  try { return $persistentStore.read(key) || ""; } catch (e) { return ""; }
}
function scriptName() {
  try { return String((typeof $script !== "undefined" && $script && $script.name) || ""); }
  catch (e) { return ""; }
}

const name = scriptName();
if (/查看状态/.test(name)) {
  let text = "暂无检测记录，先跑一次定时检测或点「立即检测」";
  try {
    const o = JSON.parse(read(RESULT_KEY) || "{}");
    if (o && o.v) {
      text = "脚本 " + o.v + "\n结果: " + o.outcome + "\n时间: " + o.at + "\n耗时: " + o.elapsed + "s";
    }
  } catch (e) {}
  $notification.post("校园网助手 " + VER + " · 状态", "上次检测结果", text);
} else if (/复制诊断日志/.test(name)) {
  const lines = read(LOG_KEY).split("\n").filter(Boolean).slice(-30).join("\n");
  $notification.post("校园网助手 " + VER + " · 诊断日志",
                     "点此复制最近 30 行",
                     "日志只含状态码/跳转/耗时，不含账号密码",
                     { clipboard: lines || "（暂无日志）" });
} else {
  $notification.post("校园网助手 " + VER, "未知工具入口", name || "无脚本名");
}
$done();
