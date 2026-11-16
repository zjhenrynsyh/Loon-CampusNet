/**
 * 校园网助手 · 查看更新日志（Generic 手动脚本）
 * ============================================
 * 在 Loon 插件详情里手动触发「查看更新日志」后，弹一条可点击通知；
 * 点通知打开 GitHub 仓库里的 CHANGELOG.md（不写文件、不上传任何本地数据）。
 */

const URL_CHANGELOG = "https://github.com/zjhenrynsyh/Loon-CampusNet/blob/main/CHANGELOG.md";
const URL_HOMEPAGE = "https://github.com/zjhenrynsyh/Loon-CampusNet/blob/main/README.md";

$notification.post(
  "校园网助手 v18 · 更新日志",
  "点此打开 GitHub CHANGELOG",
  "主页：" + URL_HOMEPAGE,
  { openUrl: URL_CHANGELOG }
);

$done();
