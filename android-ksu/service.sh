#!/system/bin/sh
# 开机守护：常驻循环检测，断线自动重连
MODDIR=${0%/*}
. "$MODDIR/campusnet.sh"

mkdir -p "$CN_DIR"

# 单实例保护
if [ -f "$CN_PID" ]; then
  _old=$(cat "$CN_PID" 2>/dev/null)
  if [ -n "$_old" ] && kill -0 "$_old" 2>/dev/null; then
    exit 0
  fi
fi
echo $$ >"$CN_PID"

# 等系统网络与 WiFi 就绪
sleep 20

while true; do
  cn_check_once
  _rc=$?
  # 认证失败：10 秒后再试一次（多为瞬时故障/服务切换）
  if [ "$_rc" -eq 2 ]; then
    sleep 10
    cn_check_once
  fi
  sleep "${CN_INTERVAL:-60}"
done
