#!/system/bin/sh
# 在 KernelSU / Magisk 管理器里点「操作」时执行：立即检测并认证一次
MODDIR=${0%/*}
. "$MODDIR/campusnet.sh"

CN_VERBOSE=1
mkdir -p "$CN_DIR"

cn_check_once
_rc=$?

# 尝试发一条系统通知（Android 11+，失败不影响主流程）
_msg="无需处理"
case "$_rc" in
  0) _msg="完成（详见日志）" ;;
  1) _msg="配置或环境异常，请查看日志" ;;
  2) _msg="认证失败，请查看日志" ;;
esac
cmd notification post -S bigtext -t "校园网助手" campusnet "$_msg" >/dev/null 2>&1

echo "---- 最近日志 ----"
tail -n 15 "$CN_LOG" 2>/dev/null
