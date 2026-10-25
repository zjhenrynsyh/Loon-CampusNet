#!/system/bin/sh
# KernelSU / Magisk 安装时执行：初始化配置目录
CN_DIR=/data/adb/campusnet

mkdir -p "$CN_DIR"

if [ ! -f "$CN_DIR/config.conf" ] && [ -f "$MODPATH/config.conf.example" ]; then
  cp -f "$MODPATH/config.conf.example" "$CN_DIR/config.conf"
  chmod 600 "$CN_DIR/config.conf"
  echo "已生成配置模板: $CN_DIR/config.conf（请填写学号密码后重启生效）"
else
  echo "保留已有配置: $CN_DIR/config.conf"
fi

# 赋予脚本可执行权限
for f in campusnet.sh service.sh action.sh uninstall.sh; do
  [ -f "$MODPATH/$f" ] && chmod 0755 "$MODPATH/$f"
done

echo "安装完成：填写 $CN_DIR/config.conf 后重启，或重启后在管理器里点「操作」测试"
