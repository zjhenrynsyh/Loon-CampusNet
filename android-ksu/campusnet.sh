#!/system/bin/sh
# ============================================================
# 校园网自动认证 · 核心函数库（KernelSU 模块）
# 协议：锐捷/深澜 RG-SAM+ ePortal V3（明文密码模式 passwordEncrypt=false）
# 纯 POSIX sh 写法，适配 Android mksh / toybox，不使用 bash 专有语法
# ============================================================

CN_DIR=/data/adb/campusnet
CN_CONF=$CN_DIR/config.conf
CN_LOG=$CN_DIR/log.txt
CN_PID=$CN_DIR/daemon.pid
CN_UA="Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"

# 默认值（可被 config.conf 覆盖）
CN_GATEWAY=172.16.54.18
CN_USER=""
CN_PASS=""
CN_SSID="iHBUT"
CN_SERVICES="LT default YD DX"
CN_INTERVAL=60
CN_VERBOSE=0

cn_log() {
  printf '%s %s\n' "$(date '+%m-%d %H:%M:%S')" "$*" >>"$CN_LOG" 2>/dev/null
  # 注意：verbose 输出必须走 stderr —— stdout 用于函数返回值（$(...) 捕获），
  # 若写 stdout 会污染 cn_login/cn_probe 的返回结果
  if [ "$CN_VERBOSE" = "1" ]; then printf '%s\n' "$*" >&2; fi
}

cn_rotate_log() {
  [ -f "$CN_LOG" ] || return 0
  _size=$(wc -c <"$CN_LOG" 2>/dev/null | tr -d ' ')
  if [ "${_size:-0}" -gt 204800 ]; then
    mv -f "$CN_LOG" "$CN_LOG.1" 2>/dev/null
  fi
}

# 读取配置项（按行解析，不执行配置文件——避免值里有空格/特殊字符时出错或被执行）
cn_conf_get() {
  sed -n "s/^[[:space:]]*$1=//p" "$CN_CONF" 2>/dev/null | head -1 |
    sed -e 's/^"//' -e 's/"[[:space:]]*$//' -e "s/^'//" -e "s/'[[:space:]]*$//" -e 's/[[:space:]]*$//'
}

# 该配置项是否出现在文件里（用于区分「未设置」与「设为空」）
cn_conf_has() {
  grep -q "^[[:space:]]*$1=" "$CN_CONF" 2>/dev/null
}

cn_load_conf() {
  if [ ! -f "$CN_CONF" ]; then
    cn_log "配置文件不存在: $CN_CONF"
    return 1
  fi

  _gw=$(cn_conf_get CFG_GATEWAY)
  [ -n "$_gw" ] && CN_GATEWAY=$_gw

  CN_USER=$(cn_conf_get CFG_USER)
  CN_PASS=$(cn_conf_get CFG_PASSWORD)
  # SSID：出现但为空 = 不限制网络；未出现 = 用默认 iHBUT
  if cn_conf_has CFG_SSID; then CN_SSID=$(cn_conf_get CFG_SSID); fi
  if cn_conf_has CFG_SERVICES; then
    _svc=$(cn_conf_get CFG_SERVICES)
    [ -n "$_svc" ] && CN_SERVICES=$_svc
  fi
  if cn_conf_has CFG_INTERVAL; then
    _iv=$(cn_conf_get CFG_INTERVAL)
    case "$_iv" in
      "" | *[!0-9]*) : ;;
      *) CN_INTERVAL=$_iv ;;
    esac
  fi

  if [ -z "$CN_USER" ] || [ -z "$CN_PASS" ]; then
    cn_log "未填写账号密码（$CN_CONF 的 CFG_USER / CFG_PASSWORD）"
    return 1
  fi
  return 0
}

# URL 编码一次（awk 按字节处理，兼容特殊字符与中文）
cn_urlencode() {
  printf '%s' "$1" | od -An -v -tu1 | awk '
    {
      for (i = 1; i <= NF; i++) {
        b = $i + 0
        if ((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) ||
            b == 45 || b == 46 || b == 95 || b == 126) {
          printf "%s", sprintf("%c", b)
        } else {
          printf "%%%02X", b
        }
      }
    }'
}

# 双重 URL 编码（ePortal 表单字段要求）
cn_urlencode2() {
  _once=$(cn_urlencode "$1")
  cn_urlencode "$_once"
}

# 当前 WiFi 名称；非 WiFi 输出空
cn_ssid() {
  _s=""
  if command -v cmd >/dev/null 2>&1; then
    _s=$(cmd wifi status 2>/dev/null | sed -n 's/.*SSID: *\([^,]*\).*/\1/p' | head -1)
  fi
  if [ -z "$_s" ] && command -v dumpsys >/dev/null 2>&1; then
    _s=$(dumpsys wifi 2>/dev/null | sed -n 's/.*SSID: *\([^,]*\).*/\1/p' | head -1)
  fi
  case "$_s" in
    "" | "null" | "<unknown ssid>" | '""') printf '' ;;
    *) printf '%s' "$_s" ;;
  esac
}

# SSID 是否在允许列表（逗号分隔、子串匹配；配置留空=不限制）
cn_ssid_match() {
  _ssid=$1
  [ -z "$CN_SSID" ] && return 0
  [ -z "$_ssid" ] && return 1
  _list=$(printf '%s' "$CN_SSID" | tr -d ' ')
  _oldifs=$IFS
  IFS=','
  set -f
  set -- $_list
  set +f
  IFS=$_oldifs
  for _want in "$@"; do
    [ -z "$_want" ] && continue
    case "$_ssid" in
      *"$_want"*) return 0 ;;
    esac
  done
  return 1
}

# 检查 HTTP 客户端可用性
cn_http_ready() {
  if command -v curl >/dev/null 2>&1; then
    CN_CURL=curl
    return 0
  fi
  for _p in /data/adb/ksu/bin/busybox /data/adb/magisk/busybox /system/xbin/busybox; do
    if [ -x "$_p" ]; then
      CN_CURL="$_p curl"
      return 0
    fi
  done
  CN_CURL=""
  return 1
}

cn_abs_portal() {
  case "$1" in
    http://* | https://*) printf '%s' "$1" ;;
    /*) printf 'http://%s%s' "$CN_GATEWAY" "$1" ;;
    *) printf 'http://%s/%s' "$CN_GATEWAY" "$1" ;;
  esac
}

cn_location() {
  sed -n 's/^[Ll]ocation: *//p' "$1" 2>/dev/null | tr -d '\r' | head -1
}

# 网关 302 兜底（只有命中 eportal 才算离线，避开 success.jsp 谎报）
cn_gateway_fallback() {
  _h2=$CN_DIR/.hdr2
  rm -f "$_h2"
  # shellcheck disable=SC2086
  ${CN_CURL} -s -m 6 --max-redirs 0 -A "$CN_UA" -D "$_h2" -o /dev/null \
    "http://$CN_GATEWAY/" 2>/dev/null
  _l2=$(cn_location "$_h2")
  rm -f "$_h2"
  case "$_l2" in
    *eportal* | *index.jsp*) printf 'offline %s' "$(cn_abs_portal "$_l2")" ;;
    *) printf '' ;;
  esac
}

# captive 探测
# 输出：online | offline <portalUrl> | noPortal <reason> | fail <reason>
cn_probe() {
  _h=$CN_DIR/.hdr
  _b=$CN_DIR/.body
  rm -f "$_h" "$_b"
  # shellcheck disable=SC2086
  ${CN_CURL} -s -m 6 --max-redirs 0 -A "$CN_UA" -D "$_h" -o "$_b" \
    "http://www.msftconnecttest.com/connecttest.txt" 2>/dev/null
  _rc=$?

  if [ "$_rc" -ne 0 ]; then
    _fb=$(cn_gateway_fallback)
    if [ -n "$_fb" ]; then _out=$_fb; else _out="fail curl-rc=$_rc"; fi
  else
    _code=$(awk 'NR==1{print $2}' "$_h" 2>/dev/null)
    _loc=$(cn_location "$_h")
    _body=$(cat "$_b" 2>/dev/null)
    case "$_code" in
      200)
        case "$_body" in
          *"Microsoft Connect Test"*) _out=online ;;
          *eportal* | *InterFace.do* | *publicKeyExponent*) _out="noPortal HTTP200-认证页无地址" ;;
          *) _out="noPortal HTTP200" ;;
        esac ;;
      302)
        case "$_loc" in
          *eportal* | *index.jsp*) _out="offline $(cn_abs_portal "$_loc")" ;;
          *) _out="noPortal 302:$_loc" ;;
        esac ;;
      *)
        _fb=$(cn_gateway_fallback)
        if [ -n "$_fb" ]; then _out=$_fb; else _out="noPortal HTTP$_code"; fi ;;
    esac
  fi

  rm -f "$_h" "$_b"
  printf '%s' "$_out"
}

# 提交登录（明文模式）
# 输出：ok <service> | fail <message>
cn_login() {
  _portal=$1
  case "$_portal" in
    *\?*) _q=${_portal#*\?} ;;
    *) _q="" ;;
  esac

  _user=$(cn_urlencode2 "$CN_USER")
  _pass=$(cn_urlencode2 "$CN_PASS")
  _qs=$(cn_urlencode2 "$_q")
  _enc_false=$(cn_urlencode2 false)

  _svcs=$(printf '%s' "$CN_SERVICES" | tr -d ',')
  _oldifs=$IFS
  IFS=' '
  set -f
  set -- $_svcs
  set +f
  IFS=$_oldifs

  for _svc in "$@"; do
    [ -z "$_svc" ] && continue
    _svcenc=$(cn_urlencode2 "$_svc")
    _body="userId=${_user}&password=${_pass}&service=${_svcenc}&queryString=${_qs}&operatorPwd=&operatorUserId=&validcode=&passwordEncrypt=${_enc_false}"
    # shellcheck disable=SC2086
    _resp=$(${CN_CURL} -s -m 10 --max-redirs 0 -A "$CN_UA" \
      -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
      --data-binary "$_body" \
      "http://$CN_GATEWAY/eportal/InterFace.do?method=login" 2>/dev/null)
    cn_log "登录返回[$_svc]: $(printf '%s' "$_resp" | cut -c1-160)"

    case "$_resp" in
      *'"result":"success"'*)
        case "$(cn_probe)" in
          online*) printf 'ok %s' "$_svc"; return 0 ;;
          *) printf 'fail 门户返回成功但网关未放行'; return 0 ;;
        esac ;;
    esac

    _msg=$(printf '%s' "$_resp" | sed -n 's/.*"message":"\([^"]*\)".*/\1/p')
    [ -z "$_msg" ] && _msg="HTTP异常"
    case "$_msg" in
      *服务* | *service* | *欠费* | *缴费* | *资费*)
        cn_log "服务[${_svc}]不通: ${_msg}，尝试下一个" ;;
      *)
        printf 'fail %s' "$_msg"; return 0 ;;
    esac
  done
  printf 'fail 全部服务尝试失败'
}

# 一次完整检查（返回 0=无需处理/成功，1=配置或环境问题，2=认证失败）
cn_check_once() {
  cn_rotate_log
  if ! cn_http_ready; then
    cn_log "缺少 curl，无法认证。请安装 busybox 模块（或含 curl 的模块）"
    return 1
  fi
  if ! cn_load_conf; then return 1; fi

  _ssid=$(cn_ssid)
  if ! cn_ssid_match "$_ssid"; then
    cn_log "WiFi「${_ssid}」不是校园网，跳过"
    return 0
  fi
  cn_log "WiFi: $_ssid"

  _r=$(cn_probe)
  case "$_r" in
    online)
      cn_log "已在线，无需认证"
      return 0 ;;
    offline\ *)
      _portal=${_r#offline }
      cn_log "检测到离线，开始认证: $(printf '%s' "$_portal" | cut -c1-90)"
      _res=$(cn_login "$_portal")
      case "$_res" in
        ok\ *)
          cn_log "认证成功（服务: ${_res#ok }）"
          return 0 ;;
        *)
          cn_log "认证失败: ${_res#fail }"
          return 2 ;;
      esac ;;
    *)
      cn_log "跳过: ${_r#noPortal }"
      return 0 ;;
  esac
}
