/**
 * 校园网助手 · 打开管理后台（Generic 手动脚本）
 * ============================================================
 * 点一下弹可点击通知 -> 打开 Web 管理后台 http://zjhenrynsyh.github.io/campusnet
 * 与 Sub-Store 详情页「主页」跳转同款体验；不写文件、不上传任何本地数据。
 * 需 Loon 已加载含 Dashboard 拦截规则的插件（插件 v22+）。
 */
const DASH_URL = "http://zjhenrynsyh.github.io/campusnet/";

$notification.post(
  "校园网助手 · 管理后台",
  "点此打开控制台",
  DASH_URL + "（显示实时状态/日志，30 秒自动刷新）",
  { openUrl: DASH_URL }
);

$done();
