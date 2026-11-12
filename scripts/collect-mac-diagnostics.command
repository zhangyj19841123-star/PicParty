#!/bin/zsh
# Receiver-side diagnostics: macOS system tools only, no Python or dev tools.
emulate -L zsh
setopt NO_UNSET PIPE_FAIL
umask 077
export LC_ALL=C LANG=C

app_path='/Applications/拼图派 PicParty.app'
[[ ! -d "${0:A:h}/拼图派 PicParty.app" ]] || app_path="${0:A:h}/拼图派 PicParty.app"
output_parent="${HOME}/Library/Application Support/com.framestudio.collage/diagnostics"
dmg_path=''
usage() {
  print -r -- '摄影拼图应用启动诊断'
  print -r -- '用法：collect-mac-diagnostics.command [--app APP路径] [--dmg 镜像路径] [--output-dir 已有报告父目录]'
  print -r -- '不启动应用、不清除隔离、不重签名、不关闭安全保护、不读取项目或照片、不上传。'
  print -r -- '默认报告放在用户应用数据的 diagnostics 目录；不要求安装 Python、Node 或 Xcode。'
}
while (( $# )); do
  case "$1" in
    --app|--dmg|--output-dir)
      (( $# > 1 )) || { usage; exit 2; }
      case "$1" in
        --app) app_path="$2" ;;
        --dmg) dmg_path="$2" ;;
        --output-dir) output_parent="$2" ;;
      esac
      shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done
[[ -d "$app_path" && ! -L "$app_path" ]] || { print -r -- '找不到普通 APP 目录，请用 --app 指定已安装副本。'; exit 2; }
[[ ! -L "$output_parent" ]] || { print -r -- '报告目录不能是符号链接。'; exit 2; }
if [[ -n "$dmg_path" && ( ! -f "$dmg_path" || -L "$dmg_path" ) ]]; then
  print -r -- '镜像必须是已有的普通文件。'; exit 2
fi
for required in /usr/bin/perl /usr/bin/mktemp /usr/libexec/PlistBuddy /usr/bin/file /usr/bin/shasum; do
  [[ -x "$required" ]] || { print -r -- '缺少 macOS 系统诊断工具；本脚本不会下载安装。'; exit 2; }
done
/bin/mkdir -p "$output_parent" || exit 2
app_path="${app_path:A}"
output_parent="${output_parent:A}"
[[ "$output_parent" != "$app_path" && "$output_parent" != "$app_path"/* ]] || { print -r -- '报告不能写入 APP 内部。'; exit 2; }
report_dir=$(/usr/bin/mktemp -d "${output_parent}/frame-studio-diagnostics-XXXXXXXX") || exit 2
report_file="${report_dir}/diagnostics.txt"
typeset -g capture_output='' capture_code=0
run_check() {
  capture_output=$(/usr/bin/perl -e 'alarm 20; exec @ARGV; exit 127' "$@" 2>&1)
  capture_code=$?
}
record() { print -r -- "$1: $2" >> "$report_file"; }
print -r -- '摄影拼图应用 · macOS 只读诊断' > "$report_file"
print -r -- '不收集用户名、地址、硬件UUID、密钥、照片或项目；不修改输入、来源属性、签名或系统保护。' >> "$report_file"
for item in system_version system_build chip model; do
  case "$item" in
    system_version) run_check /usr/bin/sw_vers -productVersion ;;
    system_build) run_check /usr/bin/sw_vers -buildVersion ;;
    chip) run_check /usr/sbin/sysctl -n machdep.cpu.brand_string ;;
    model) run_check /usr/sbin/sysctl -n hw.model ;;
  esac
  if (( capture_code == 0 )) && [[ "$capture_output" =~ '^[A-Za-z0-9 .,_-]{1,80}$' ]]; then record "$item" "$capture_output"; else record "$item" 'blocked'; fi
done
for item in CFBundleShortVersionString LSMinimumSystemVersion; do
  run_check /usr/libexec/PlistBuddy -c "Print :${item}" "${app_path}/Contents/Info.plist"
  if (( capture_code == 0 )) && [[ "$capture_output" =~ '^[A-Za-z0-9.+-]{1,64}$' ]]; then record "$item" "$capture_output"; else record "$item" 'blocked'; fi
done
run_check /usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "${app_path}/Contents/Info.plist"
executable_name="$capture_output"
if (( capture_code != 0 )) || [[ ! "$executable_name" =~ '^[A-Za-z0-9_.-]{1,100}$' ]]; then record 'bundle' 'fail_invalid_executable'; print -r -- '诊断已完成。报告在本次新建目录中。'; exit 1; fi
executable="${app_path}/Contents/MacOS/${executable_name}"
if [[ ! -f "$executable" || -L "$executable" ]]; then record 'bundle' 'fail_missing_or_linked_executable'; exit 1; fi
if [[ -x "$executable" ]]; then record 'executable_permission' 'pass'; else record 'executable_permission' 'fail'; fi
run_check /usr/bin/file -b "$executable"
if [[ "$capture_output" == *arm64* ]]; then record 'main_architecture' 'arm64'; elif [[ "$capture_output" == *x86_64* ]]; then record 'main_architecture' 'x86_64'; else record 'main_architecture' 'unknown'; fi
run_check /usr/bin/shasum -a 256 "$executable"
digest="${capture_output%% *}"
if (( capture_code == 0 )) && [[ "$digest" =~ '^[a-f0-9]{64}$' ]]; then record 'executable_sha256' "$digest"; else record 'executable_sha256' 'blocked'; fi
run_check /usr/bin/codesign --verify --deep --strict "$app_path"
if (( capture_code == 0 )); then record 'signature_integrity' 'pass'; else record 'signature_integrity' 'fail_or_blocked'; fi
run_check /usr/bin/codesign -d --verbose=4 "$app_path"
if [[ "$capture_output" == *'Signature=adhoc'* ]]; then record 'signature_kind' 'ad_hoc'; elif [[ "$capture_output" == *'Developer ID Application'* ]]; then record 'signature_kind' 'developer_id'; else record 'signature_kind' 'unknown'; fi
run_check /usr/sbin/spctl --assess --type execute --verbose=4 "$app_path"
if (( capture_code == 0 )); then record 'gatekeeper' 'accepted_on_this_mac'; elif [[ "$capture_output" == *rejected* || "$capture_output" == *'not allowed'* ]]; then record 'gatekeeper' 'rejected'; else record 'gatekeeper' 'blocked'; fi
check_quarantine() {
  local label="$1" input="$2" decoded='' flags=''
  run_check /usr/bin/xattr -p com.apple.quarantine "$input"
  if (( capture_code == 0 )); then
    flags="${capture_output%%;*}"
    if [[ "$flags" =~ '^[a-fA-F0-9]{1,8}$' ]]; then
      if (( (16#$flags & 4) != 0 )); then record "$label" 'hard_quarantine'; else record "$label" 'ordinary_quarantine'; fi
    else record "$label" 'blocked_unrecognized_attribute'; fi
  elif [[ "$capture_output" == *'No such xattr'* || "$capture_output" == *'Attribute not found'* || "$capture_output" == *'No such attribute'* ]]; then
    record "$label" 'no_direct_attribute_inherited_state_unknown'
  else record "$label" 'blocked'; fi
}
check_quarantine 'app_quarantine' "$app_path"
check_quarantine 'main_quarantine' "$executable"
if [[ -n "$dmg_path" ]]; then
  check_quarantine 'dmg_quarantine' "$dmg_path"
  run_check /usr/bin/shasum -a 256 "$dmg_path"
  digest="${capture_output%% *}"
  if (( capture_code == 0 )) && [[ "$digest" =~ '^[a-f0-9]{64}$' ]]; then record 'dmg_sha256' "$digest"; else record 'dmg_sha256' 'blocked'; fi
fi
record 'full_native_architecture_and_minos_audit' 'not_run_receiver_tools_only_use_development_preflight'
record 'notarization' 'not_run_not_inferred_from_signature'
record 'gui_launch_and_editing' 'not_run_read_only_diagnostics'
record 'startup_log' 'app_data/logs/startup.jsonl_available_if_app_reached_entry'
print -r -- '说明：ad-hoc签名完整性不等于Apple信任；没有直接隔离属性不排除DMG继承。此报告不证明其他Mac已经测试。' >> "$report_file"
print -r -- "诊断已完成：${report_file}"
print -r -- '发送前请先查看报告。本工具不会自动发送。'
