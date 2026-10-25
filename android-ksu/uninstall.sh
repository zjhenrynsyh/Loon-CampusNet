#!/system/bin/sh
# 卸载时执行：停掉守护进程（保留配置与日志，便于重装后继续用）
CN_DIR=/data/adb/campusnet

if [ -f "$CN_DIR/daemon.pid" ]; then
  _pid=$(cat "$CN_DIR/daemon.pid" 2>/dev/null)
  [ -n "$_pid" ] && kill "$_pid" 2>/dev/null
  rm -f "$CN_DIR/daemon.pid"
fi

# 兜底：杀掉本模块的 service.sh 进程
pkill -f "campusnet.*service.sh" 2>/dev/null
echo "已停止守护进程；配置与日志保留在 $CN_DIR"
