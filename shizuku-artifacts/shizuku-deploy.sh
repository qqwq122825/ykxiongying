#!/system/bin/sh

BASE_DIR="${BASE_DIR:-/data/local/tmp}"
PACKAGE="${SHIZUKU_PACKAGE:-moe.shizuku.privileged.api}"
BOOTSTRAP_RECEIVER="${SHIZUKU_BOOTSTRAP_RECEIVER:-moe.shizuku.manager.receiver.CompanionBootstrapReceiver}"
WATCHDOG_SERVICE="${SHIZUKU_WATCHDOG_SERVICE:-moe.shizuku.manager.service.WatchdogService}"
COMPANION_APK="${COMPANION_APK:-$BASE_DIR/shizuku-companion.apk}"
READER_PACKAGE="${READER_PACKAGE:-com.fisher.readeragent}"
READER_INSTRUMENTATION="${READER_INSTRUMENTATION:-com.fisher.readeragent.ReaderInstrumentation}"
READER_APK="${READER_APK:-$BASE_DIR/adb-reader-agent.apk}"
READER_PORT="${READER_PORT:-7923}"
READER_MODE_FILE="${READER_MODE_FILE:-$BASE_DIR/adb-reader-mode}"
SUPERVISOR_SCRIPT="${SUPERVISOR_SCRIPT:-$BASE_DIR/shizuku-supervisor.sh}"
DEPLOYER_SCRIPT="${DEPLOYER_SCRIPT:-$BASE_DIR/shizuku-deploy.sh}"
RECOVERY_ARM64_SOURCE="${RECOVERY_ARM64_SOURCE:-$BASE_DIR/shizuku-recovery-agent-arm64}"
RECOVERY_X8664_SOURCE="${RECOVERY_X8664_SOURCE:-$BASE_DIR/shizuku-recovery-agent-x86_64}"
RECOVERY_AGENT_BIN="${RECOVERY_AGENT_BIN:-$BASE_DIR/shizuku-recovery-agent}"
FRPC_CONFIG="${FRPC_CONFIG:-$BASE_DIR/frpc_independent.ini}"
RECOVERY_FRPC_CONFIG="${RECOVERY_FRPC_CONFIG:-$BASE_DIR/frpc_recovery.ini}"
RECOVERY_LOCAL_PORT="${RECOVERY_LOCAL_PORT:-7922}"
RECOVERY_ADMIN_PORT="${RECOVERY_ADMIN_PORT:-7401}"
RECOVERY_REMOTE_OFFSET="${RECOVERY_REMOTE_OFFSET:-30000}"
LOCAL_SERVICE_BIN="${LOCAL_SERVICE_BIN:-$BASE_DIR/local-service}"
LOCAL_SERVICE_BACKUP="${LOCAL_SERVICE_BACKUP:-$BASE_DIR/shizuku-backup-local-service}"
FRPC_BIN="${FRPC_BIN:-$BASE_DIR/frpc}"
FRPC_BACKUP="${FRPC_BACKUP:-$BASE_DIR/shizuku-backup-frpc}"
TCP_PORT="${TCP_PORT:-5555}"

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/[[:cntrl:]]/ /g'
}

fail() {
    stage=$(json_escape "$1")
    message=$(json_escape "$2")
    printf '{"success":false,"stage":"%s","error":"%s"}\n' "$stage" "$message"
    exit 1
}

valid_port() {
    case "$1" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ "$1" -ge 1 ] 2>/dev/null && [ "$1" -le 65535 ] 2>/dev/null
}

sha256_file() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" 2>/dev/null | awk '{print toupper($1)}'
        return
    fi
    toybox sha256sum "$1" 2>/dev/null | awk '{print toupper($1)}'
}

verify_hash() {
    file="$1"
    expected=$(printf '%s' "$2" | tr '[:lower:]' '[:upper:]')
    label="$3"
    [ -f "$file" ] || fail "verify_$label" "Missing file: $file"
    [ -n "$expected" ] || return 0
    actual=$(sha256_file "$file")
    [ -n "$actual" ] || fail "verify_$label" "Unable to calculate SHA-256"
    [ "$actual" = "$expected" ] || fail "verify_$label" "SHA-256 mismatch"
}

shell_shizuku_pid() {
    for pid in $(pidof shizuku_server 2>/dev/null); do
        [ -r "/proc/$pid/status" ] || continue
        uid=$(awk '/^Uid:/{print $2; exit}' "/proc/$pid/status" 2>/dev/null)
        if [ "$uid" = "2000" ]; then
            echo "$pid"
            return 0
        fi
    done
    return 1
}

find_shizuku_starter() {
    lib_dir=$(dumpsys package "$PACKAGE" 2>/dev/null |
        sed -n 's/^[[:space:]]*legacyNativeLibraryDir=//p; s/^[[:space:]]*nativeLibraryDir=//p' |
        head -n 1)
    [ -n "$lib_dir" ] || return 1

    abi=$(getprop ro.product.cpu.abi 2>/dev/null)
    for candidate in \
        "$lib_dir/$abi/libshizuku.so" \
        "$lib_dir/libshizuku.so"; do
        if [ -x "$candidate" ]; then
            echo "$candidate"
            return 0
        fi
    done

    candidate=$(find "$lib_dir" -maxdepth 2 -type f -name libshizuku.so 2>/dev/null | head -n 1)
    [ -n "$candidate" ] && [ -x "$candidate" ] || return 1
    echo "$candidate"
}

install_companion() {
    output=$(pm install -r -g "$COMPANION_APK" 2>&1)
    rc=$?
    [ "$rc" -eq 0 ] || fail install_companion "$output"
}

install_reader_agent() {
    output=$(pm install -r -g "$READER_APK" 2>&1)
    rc=$?
    [ "$rc" -eq 0 ] || fail install_reader_agent "$output"
}

start_reader_agent() {
    if [ "$(cat "$READER_MODE_FILE" 2>/dev/null)" = "legacy" ]; then
        am force-stop "$READER_PACKAGE" >/dev/null 2>&1 || true
        return 0
    fi
    am force-stop "$READER_PACKAGE" >/dev/null 2>&1 || true
    nohup am instrument -w -r "$READER_PACKAGE/$READER_INSTRUMENTATION" \
        >"$BASE_DIR/adb-reader-agent.log" 2>&1 </dev/null &
    sleep 2
    port=$(ss -ltn 2>/dev/null | awk -v wanted=":$READER_PORT" '$4 ~ wanted "$" {print $4; exit}')
    [ -n "$port" ] || fail start_reader_agent "Reader agent did not listen on port $READER_PORT"
}

ini_value() {
    key="$1"
    case "$key" in
        server_addr) key_alt="serverAddr" ;;
        server_port) key_alt="serverPort" ;;
        token) key_alt="auth.token" ;;
        remote_port) key_alt="remotePort" ;;
        *) key_alt="" ;;
    esac
    awk -F= -v wanted="$key" -v alternate="$key_alt" '
        {
            name=$1
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
            if (name == wanted || (alternate != "" && name == alternate)) {
                value=substr($0, index($0, "=") + 1)
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
                if (value ~ /^".*"$/ || value ~ /^\x27.*\x27$/) {
                    value=substr(value, 2, length(value) - 2)
                }
                print value
                exit
            }
        }
    ' "$FRPC_CONFIG" 2>/dev/null
}

prepare_recovery_agent() {
    abi=$(getprop ro.product.cpu.abi 2>/dev/null)
    case "$abi" in
        x86_64)
            source="$RECOVERY_X8664_SOURCE"
            ;;
        arm64-v8a)
            source="$RECOVERY_ARM64_SOURCE"
            ;;
        *)
            abilist=$(getprop ro.product.cpu.abilist 2>/dev/null)
            case ",$abilist," in
                *,x86_64,*) source="$RECOVERY_X8664_SOURCE" ;;
                *,arm64-v8a,*) source="$RECOVERY_ARM64_SOURCE" ;;
                *) fail prepare_recovery "Unsupported ABI: $abi" ;;
            esac
            ;;
    esac
    [ -f "$source" ] || fail prepare_recovery "Missing recovery agent for ABI: $abi"
    cp -f "$source" "$RECOVERY_AGENT_BIN" || fail prepare_recovery "Unable to install recovery agent"
    chmod 755 "$RECOVERY_AGENT_BIN" || fail prepare_recovery "Unable to chmod recovery agent"
}

configure_recovery_tunnel() {
    [ -r "$FRPC_CONFIG" ] || fail configure_recovery "Primary frpc config is missing"
    server_addr=$(ini_value server_addr)
    server_port=$(ini_value server_port)
    token=$(ini_value token)
    primary_remote_port=$(ini_value remote_port)
    valid_port "$server_port" || fail configure_recovery "Primary server_port is invalid"
    valid_port "$primary_remote_port" || fail configure_recovery "Primary remote_port is invalid"
    valid_port "$RECOVERY_LOCAL_PORT" || fail configure_recovery "Recovery local port is invalid"
    valid_port "$RECOVERY_ADMIN_PORT" || fail configure_recovery "Recovery admin port is invalid"
    recovery_remote_port=$((primary_remote_port + RECOVERY_REMOTE_OFFSET))
    valid_port "$recovery_remote_port" || fail configure_recovery "Recovery remote port is invalid"
    [ -n "$server_addr" ] || fail configure_recovery "Primary server_addr is missing"

    temporary="$RECOVERY_FRPC_CONFIG.tmp"
    {
        echo '[common]'
        echo "server_addr = $server_addr"
        echo "server_port = $server_port"
        [ -z "$token" ] || echo "token = $token"
        echo 'admin_addr = 127.0.0.1'
        echo "admin_port = $RECOVERY_ADMIN_PORT"
        echo
        echo "[recovery_$primary_remote_port]"
        echo 'type = tcp'
        echo 'local_ip = 127.0.0.1'
        echo "local_port = $RECOVERY_LOCAL_PORT"
        echo "remote_port = $recovery_remote_port"
    } > "$temporary" || fail configure_recovery "Unable to write recovery frpc config"
    mv -f "$temporary" "$RECOVERY_FRPC_CONFIG" || fail configure_recovery "Unable to install recovery frpc config"
    chmod 644 "$RECOVERY_FRPC_CONFIG" >/dev/null 2>&1 || true
}

backup_primary_binaries() {
    if [ -x "$LOCAL_SERVICE_BIN" ]; then
        cp -f "$LOCAL_SERVICE_BIN" "$LOCAL_SERVICE_BACKUP" >/dev/null 2>&1 || true
        chmod 755 "$LOCAL_SERVICE_BACKUP" >/dev/null 2>&1 || true
    fi
    if [ -x "$FRPC_BIN" ]; then
        cp -f "$FRPC_BIN" "$FRPC_BACKUP" >/dev/null 2>&1 || true
        chmod 755 "$FRPC_BACKUP" >/dev/null 2>&1 || true
    fi
}

suppress_notifications() {
    sdk=$(getprop ro.build.version.sdk 2>/dev/null)
    case "$sdk" in
        ''|*[!0-9]*) return 0 ;;
    esac
    if [ "$sdk" -ge 33 ]; then
        # The watchdog remains a foreground service, but Android 13+ does not
        # need to surface its persistent notification to the user.
        pm revoke "$PACKAGE" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true
    fi
}

configure_companion() {
    valid_port "$TCP_PORT" || fail configure_companion "Invalid TCP port: $TCP_PORT"
    output=$(am broadcast --user 0 \
        -a "$PACKAGE.COMPANION_BOOTSTRAP" \
        -n "$PACKAGE/$BOOTSTRAP_RECEIVER" \
        --ei tcpPort "$TCP_PORT" 2>&1)
    rc=$?
    [ "$rc" -eq 0 ] || fail configure_companion "$output"
    echo "$output" | grep -q 'result=-1' || fail configure_companion "$output"
}

start_shizuku() {
    pid=$(shell_shizuku_pid 2>/dev/null)
    [ -n "$pid" ] && return 0

    starter=$(find_shizuku_starter 2>/dev/null)
    [ -n "$starter" ] || fail start_shizuku "Packaged libshizuku.so not found"
    output=$("$starter" 2>&1)
    rc=$?
    sleep 2
    pid=$(shell_shizuku_pid 2>/dev/null)
    [ "$rc" -eq 0 ] && [ -n "$pid" ] || fail start_shizuku "$output"
}

start_watchdog() {
    output=$(am start-foreground-service --user 0 \
        -n "$PACKAGE/$WATCHDOG_SERVICE" 2>&1)
    rc=$?
    [ "$rc" -eq 0 ] || fail start_watchdog "$output"
}

start_supervisor() {
    chmod 755 "$SUPERVISOR_SCRIPT" || fail start_supervisor "chmod failed"
    # install/repair may replace the script while an older loop is still in
    # memory. Restart only the Supervisor process so the new logic is loaded;
    # primary local-service and frpc remain untouched.
    sh "$SUPERVISOR_SCRIPT" stop >/dev/null 2>&1 || true
    output=$(sh "$SUPERVISOR_SCRIPT" start 2>&1)
    rc=$?
    [ "$rc" -eq 0 ] || fail start_supervisor "$output"
}

status_json() {
    package_path=$(pm path "$PACKAGE" 2>/dev/null | head -n 1 | sed 's/^package://')
    package_installed=false
    [ -n "$package_path" ] && package_installed=true

    shizuku_pid=$(shell_shizuku_pid 2>/dev/null)
    shizuku_running=false
    shizuku_uid=""
    if [ -n "$shizuku_pid" ]; then
        shizuku_running=true
        shizuku_uid=$(awk '/^Uid:/{print $2; exit}' "/proc/$shizuku_pid/status" 2>/dev/null)
    fi

    watchdog_running=false
    if dumpsys activity services "$PACKAGE" 2>/dev/null | grep -q 'WatchdogService'; then
        watchdog_running=true
    fi

    supervisor_json='{"supervisor":"not_installed","shizuku":"stopped","localService":"not_installed","frpc":"not_installed","recoveryAgent":"not_installed","recoveryFrpc":"not_installed","route":"offline"}'
    if [ -r "$SUPERVISOR_SCRIPT" ]; then
        candidate=$(sh "$SUPERVISOR_SCRIPT" status 2>/dev/null | tail -n 1)
        case "$candidate" in
            \{*\}) supervisor_json="$candidate" ;;
        esac
    fi

    package_path=$(json_escape "$package_path")
    printf '{"success":true,"packageInstalled":%s,"packagePath":"%s","shizukuRunning":%s,"shizukuPid":"%s","shizukuUid":"%s","watchdogRunning":%s,"supervisor":%s}\n' \
        "$package_installed" "$package_path" "$shizuku_running" "$shizuku_pid" "$shizuku_uid" "$watchdog_running" "$supervisor_json"
}

deploy() {
    verify_hash "$COMPANION_APK" "${COMPANION_SHA256:-}" companion
    verify_hash "$READER_APK" "${READER_AGENT_SHA256:-}" reader_agent
    verify_hash "$SUPERVISOR_SCRIPT" "${SUPERVISOR_SHA256:-}" supervisor
    verify_hash "$DEPLOYER_SCRIPT" "${DEPLOYER_SHA256:-}" deployer
    verify_hash "$RECOVERY_ARM64_SOURCE" "${RECOVERY_ARM64_SHA256:-}" recovery_arm64
    verify_hash "$RECOVERY_X8664_SOURCE" "${RECOVERY_X8664_SHA256:-}" recovery_x8664
    install_companion
    install_reader_agent
    suppress_notifications
    prepare_recovery_agent
    configure_recovery_tunnel
    backup_primary_binaries
    configure_companion
    start_shizuku
    start_watchdog
    start_reader_agent
    start_supervisor
    status_json
}

case "${1:-status}" in
    install|repair) deploy ;;
    status) status_json ;;
    stop)
        [ -r "$SUPERVISOR_SCRIPT" ] && sh "$SUPERVISOR_SCRIPT" stop >/dev/null 2>&1
        am stopservice --user 0 -n "$PACKAGE/$WATCHDOG_SERVICE" >/dev/null 2>&1
        for pid in $(pidof shizuku_server 2>/dev/null); do
            kill "$pid" 2>/dev/null
        done
        status_json
        # Build the response before scheduling recovery shutdown. Otherwise
        # slow service/status calls can consume the grace period and FRPC may
        # disappear while the HTTP response is still being written.
        if [ -r "$SUPERVISOR_SCRIPT" ]; then
            setsid sh -c 'sleep 5; sh "$1" stop-recovery' sh "$SUPERVISOR_SCRIPT" \
                </dev/null >/dev/null 2>&1 &
        fi
        ;;
    *) fail usage "Usage: $0 {install|repair|status|stop}" ;;
esac
