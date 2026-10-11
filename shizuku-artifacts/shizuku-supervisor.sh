#!/system/bin/sh

BASE_DIR="${BASE_DIR:-/data/local/tmp}"
SCRIPT_PATH="${SCRIPT_PATH:-$BASE_DIR/shizuku-supervisor.sh}"
CONFIG_FILE="${CONFIG_FILE:-$BASE_DIR/shizuku-supervisor.conf}"
PID_FILE="${PID_FILE:-$BASE_DIR/shizuku-supervisor.pid}"
LOCK_DIR="${LOCK_DIR:-$BASE_DIR/.shizuku-supervisor.lock}"
LOG_FILE="${LOG_FILE:-$BASE_DIR/shizuku-supervisor.log}"

SHIZUKU_PACKAGE="${SHIZUKU_PACKAGE:-moe.shizuku.privileged.api}"
READER_PACKAGE="${READER_PACKAGE:-com.fisher.readeragent}"
READER_INSTRUMENTATION="${READER_INSTRUMENTATION:-com.fisher.readeragent.ReaderInstrumentation}"
READER_PORT="${READER_PORT:-7923}"
READER_LOG="${READER_LOG:-$BASE_DIR/adb-reader-agent.log}"
READER_MODE_FILE="${READER_MODE_FILE:-$BASE_DIR/adb-reader-mode}"
LOCAL_SERVICE_BIN="${LOCAL_SERVICE_BIN:-$BASE_DIR/local-service}"
LOCAL_SERVICE_BACKUP="${LOCAL_SERVICE_BACKUP:-$BASE_DIR/shizuku-backup-local-service}"
LOCAL_SERVICE_PORT="${LOCAL_SERVICE_PORT:-7912}"
FRPC_BIN="${FRPC_BIN:-$BASE_DIR/frpc}"
FRPC_BACKUP="${FRPC_BACKUP:-$BASE_DIR/shizuku-backup-frpc}"
FRPC_CONFIG="${FRPC_CONFIG:-$BASE_DIR/frpc_independent.ini}"
FRPC_ADMIN_PORT="${FRPC_ADMIN_PORT:-7400}"
FRPC_LOG="${FRPC_LOG:-$BASE_DIR/frpc.log}"
RECOVERY_AGENT_BIN="${RECOVERY_AGENT_BIN:-$BASE_DIR/shizuku-recovery-agent}"
RECOVERY_AGENT_PORT="${RECOVERY_AGENT_PORT:-7922}"
RECOVERY_AGENT_LOG="${RECOVERY_AGENT_LOG:-$BASE_DIR/shizuku-recovery-agent.log}"
RECOVERY_FRPC_CONFIG="${RECOVERY_FRPC_CONFIG:-$BASE_DIR/frpc_recovery.ini}"
RECOVERY_FRPC_ADMIN_PORT="${RECOVERY_FRPC_ADMIN_PORT:-7401}"
RECOVERY_FRPC_LOG="${RECOVERY_FRPC_LOG:-$BASE_DIR/frpc_recovery.log}"

CHECK_INTERVAL="${CHECK_INTERVAL:-10}"
FAIL_THRESHOLD="${FAIL_THRESHOLD:-3}"
MAX_BACKOFF="${MAX_BACKOFF:-60}"
MAX_LOG_BYTES="${MAX_LOG_BYTES:-262144}"

shizuku_backoff=5
shizuku_next_retry=0
local_failures=0
local_backoff=5
local_next_retry=0
frpc_failures=0
frpc_backoff=5
frpc_next_retry=0
recovery_agent_failures=0
recovery_agent_backoff=5
recovery_agent_next_retry=0
recovery_frpc_failures=0
recovery_frpc_backoff=5
recovery_frpc_next_retry=0
reader_failures=0
reader_backoff=5
reader_next_retry=0

if [ -r "$CONFIG_FILE" ]; then
    # The configuration is installed by the same authorized shell deployment.
    . "$CONFIG_FILE"
fi

now() {
    date +%s
}

rotate_log() {
    [ -f "$LOG_FILE" ] || return 0
    size=$(wc -c < "$LOG_FILE" 2>/dev/null)
    [ -n "$size" ] || return 0
    if [ "$size" -gt "$MAX_LOG_BYTES" ] 2>/dev/null; then
        mv -f "$LOG_FILE" "$LOG_FILE.1" 2>/dev/null
    fi
}

log() {
    rotate_log
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

valid_number() {
    case "$1" in
        ''|*[!0-9]*) return 1 ;;
        *) return 0 ;;
    esac
}

sanitize_config() {
    valid_number "$CHECK_INTERVAL" || CHECK_INTERVAL=10
    valid_number "$FAIL_THRESHOLD" || FAIL_THRESHOLD=3
    valid_number "$MAX_BACKOFF" || MAX_BACKOFF=60
    valid_number "$LOCAL_SERVICE_PORT" || LOCAL_SERVICE_PORT=7912
    valid_number "$FRPC_ADMIN_PORT" || FRPC_ADMIN_PORT=7400
    valid_number "$RECOVERY_AGENT_PORT" || RECOVERY_AGENT_PORT=7922
    valid_number "$RECOVERY_FRPC_ADMIN_PORT" || RECOVERY_FRPC_ADMIN_PORT=7401
    [ "$CHECK_INTERVAL" -ge 2 ] 2>/dev/null || CHECK_INTERVAL=2
    [ "$FAIL_THRESHOLD" -ge 1 ] 2>/dev/null || FAIL_THRESHOLD=1
    [ "$MAX_BACKOFF" -ge 5 ] 2>/dev/null || MAX_BACKOFF=5
}

pid_alive() {
    [ -n "$1" ] && [ -d "/proc/$1" ]
}

named_process_alive() {
    for pid in $(pidof "$1" 2>/dev/null); do
        pid_alive "$pid" && return 0
    done
    return 1
}

local_service_pids() {
    candidates="$(pidof local-service 2>/dev/null) $(pidof houdini64 2>/dev/null)"
    for pid in $candidates; do
        cmdline_file="/proc/$pid/cmdline"
        [ -r "$cmdline_file" ] || continue
        cmdline=$(tr '\000' ' ' < "$cmdline_file" 2>/dev/null)
        case " $cmdline " in
            *" $LOCAL_SERVICE_BIN "*)
                uid=$(awk '/^Uid:/{print $2; exit}' "/proc/$pid/status" 2>/dev/null)
                pid_alive "$pid" && [ "$uid" = "2000" ] && echo "$pid"
                ;;
        esac
    done
}

# Match the executable path from /proc instead of relying on the process name.
# MuMu may report translated ARM binaries as "houdini64", while real devices
# usually report "frpc"; the command line is stable on both runtimes.
frpc_pids() {
    candidates="$(pidof frpc 2>/dev/null) $(pidof houdini64 2>/dev/null)"
    for pid in $candidates; do
        cmdline_file="/proc/$pid/cmdline"
        [ -r "$cmdline_file" ] || continue
        cmdline=$(tr '\000' ' ' < "$cmdline_file" 2>/dev/null)
        case " $cmdline " in
            *" $FRPC_BIN "*)
                case " $cmdline " in
                    *" $FRPC_CONFIG "*)
                        uid=$(awk '/^Uid:/{print $2; exit}' "/proc/$pid/status" 2>/dev/null)
                        if pid_alive "$pid" && [ "$uid" = "2000" ]; then
                            echo "$pid"
                        fi
                        ;;
                esac
                ;;
        esac
    done
}

recovery_agent_pids() {
    candidates="$(pidof shizuku-recovery-agent 2>/dev/null) $(pidof houdini64 2>/dev/null)"
    for pid in $candidates; do
        cmdline_file="/proc/$pid/cmdline"
        [ -r "$cmdline_file" ] || continue
        cmdline=$(tr '\000' ' ' < "$cmdline_file" 2>/dev/null)
        case " $cmdline " in
            *" $RECOVERY_AGENT_BIN "*)
                uid=$(awk '/^Uid:/{print $2; exit}' "/proc/$pid/status" 2>/dev/null)
                pid_alive "$pid" && [ "$uid" = "2000" ] && echo "$pid"
                ;;
        esac
    done
}

recovery_frpc_pids() {
    candidates="$(pidof frpc 2>/dev/null) $(pidof houdini64 2>/dev/null)"
    for pid in $candidates; do
        cmdline_file="/proc/$pid/cmdline"
        [ -r "$cmdline_file" ] || continue
        cmdline=$(tr '\000' ' ' < "$cmdline_file" 2>/dev/null)
        case " $cmdline " in
            *" $FRPC_BIN "*)
                case " $cmdline " in
                    *" $RECOVERY_FRPC_CONFIG "*)
                        uid=$(awk '/^Uid:/{print $2; exit}' "/proc/$pid/status" 2>/dev/null)
                        pid_alive "$pid" && [ "$uid" = "2000" ] && echo "$pid"
                        ;;
                esac
                ;;
        esac
    done
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

port_listening() {
    port="$1"
    valid_number "$port" || return 1
    hex_port=$(printf '%04X' "$port" 2>/dev/null) || return 1
    awk -v suffix=":$hex_port" '
        NR > 1 && $2 ~ suffix "$" && $4 == "0A" { found=1; exit }
        END { exit found ? 0 : 1 }
    ' /proc/net/tcp /proc/net/tcp6 2>/dev/null
}

find_shizuku_starter() {
    lib_dir=$(dumpsys package "$SHIZUKU_PACKAGE" 2>/dev/null |
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

increase_backoff() {
    value=$(( $1 * 2 ))
    [ "$value" -le "$MAX_BACKOFF" ] || value="$MAX_BACKOFF"
    echo "$value"
}

ensure_shizuku() {
    pid=$(shell_shizuku_pid 2>/dev/null)
    if [ -n "$pid" ]; then
        shizuku_backoff=5
        shizuku_next_retry=0
        return 0
    fi

    current=$(now)
    [ "$current" -ge "$shizuku_next_retry" ] || return 1
    starter=$(find_shizuku_starter 2>/dev/null)
    if [ -z "$starter" ]; then
        log "Shizuku starter unavailable; package=$SHIZUKU_PACKAGE"
        shizuku_next_retry=$((current + shizuku_backoff))
        shizuku_backoff=$(increase_backoff "$shizuku_backoff")
        return 1
    fi

    log "Starting Shizuku with $starter"
    output=$("$starter" 2>&1)
    rc=$?
    [ -n "$output" ] && log "Shizuku starter: $output"
    sleep 2
    pid=$(shell_shizuku_pid 2>/dev/null)
    if [ "$rc" -eq 0 ] && [ -n "$pid" ]; then
        log "Shizuku healthy; pid=$pid uid=2000"
        shizuku_backoff=5
        shizuku_next_retry=0
        return 0
    fi

    log "Shizuku start failed; rc=$rc"
    shizuku_next_retry=$((current + shizuku_backoff))
    shizuku_backoff=$(increase_backoff "$shizuku_backoff")
    return 1
}

local_service_healthy() {
    [ -n "$(local_service_pids)" ] && port_listening "$LOCAL_SERVICE_PORT"
}

stop_named_process() {
    name="$1"
    for pid in $(pidof "$name" 2>/dev/null); do
        kill "$pid" 2>/dev/null
    done
    sleep 1
    for pid in $(pidof "$name" 2>/dev/null); do
        kill -9 "$pid" 2>/dev/null
    done
}

stop_frpc() {
    for pid in $(frpc_pids); do
        kill "$pid" 2>/dev/null
    done
    sleep 1
    for pid in $(frpc_pids); do
        kill -9 "$pid" 2>/dev/null
    done
}

stop_recovery_agent() {
    for pid in $(recovery_agent_pids); do
        kill "$pid" 2>/dev/null
    done
    sleep 1
    for pid in $(recovery_agent_pids); do
        kill -9 "$pid" 2>/dev/null
    done
}

stop_recovery_frpc() {
    for pid in $(recovery_frpc_pids); do
        kill "$pid" 2>/dev/null
    done
    sleep 1
    for pid in $(recovery_frpc_pids); do
        kill -9 "$pid" 2>/dev/null
    done
}

stop_local_service() {
    for pid in $(local_service_pids); do
        kill "$pid" 2>/dev/null
    done
    sleep 1
    for pid in $(local_service_pids); do
        kill -9 "$pid" 2>/dev/null
    done
}

ensure_local_service() {
    if [ ! -x "$LOCAL_SERVICE_BIN" ] && [ -x "$LOCAL_SERVICE_BACKUP" ]; then
        cp -f "$LOCAL_SERVICE_BACKUP" "$LOCAL_SERVICE_BIN" >/dev/null 2>&1
        chmod 755 "$LOCAL_SERVICE_BIN" >/dev/null 2>&1
        log "Restored missing local-service from deployment backup"
    fi
    [ -x "$LOCAL_SERVICE_BIN" ] || return 0
    if local_service_healthy; then
        local_failures=0
        local_backoff=5
        local_next_retry=0
        return 0
    fi

    local_failures=$((local_failures + 1))
    [ "$local_failures" -ge "$FAIL_THRESHOLD" ] || return 1
    current=$(now)
    [ "$current" -ge "$local_next_retry" ] || return 1

    log "Restarting local-service after $local_failures failed health checks"
    stop_local_service
    # The Supervisor is already the daemon owner. Keeping local-service in its
    # foreground server mode avoids a second fork and translated-ABI bind race.
    nohup "$LOCAL_SERVICE_BIN" server < /dev/null > /dev/null 2>&1 &
    sleep 3
    if local_service_healthy; then
        log "local-service healthy; pid=$(local_service_pids | tr '\n' ' ') port=$LOCAL_SERVICE_PORT"
        local_failures=0
        local_backoff=5
        local_next_retry=0
        return 0
    fi

    log "local-service restart did not pass health check"
    local_next_retry=$((current + local_backoff))
    local_backoff=$(increase_backoff "$local_backoff")
    return 1
}

recovery_agent_healthy() {
    [ -n "$(recovery_agent_pids)" ] && port_listening "$RECOVERY_AGENT_PORT"
}

ensure_recovery_agent() {
    [ -x "$RECOVERY_AGENT_BIN" ] || return 0
    if recovery_agent_healthy; then
        recovery_agent_failures=0
        recovery_agent_backoff=5
        recovery_agent_next_retry=0
        return 0
    fi

    recovery_agent_failures=$((recovery_agent_failures + 1))
    [ "$recovery_agent_failures" -ge "$FAIL_THRESHOLD" ] || return 1
    current=$(now)
    [ "$current" -ge "$recovery_agent_next_retry" ] || return 1

    log "Restarting recovery-agent after $recovery_agent_failures failed health checks"
    stop_recovery_agent
    RECOVERY_AGENT_LISTEN="127.0.0.1:$RECOVERY_AGENT_PORT" nohup "$RECOVERY_AGENT_BIN" >> "$RECOVERY_AGENT_LOG" 2>&1 &
    sleep 2
    if recovery_agent_healthy; then
        log "recovery-agent healthy; pid=$(recovery_agent_pids | tr '\n' ' ') port=$RECOVERY_AGENT_PORT"
        recovery_agent_failures=0
        recovery_agent_backoff=5
        recovery_agent_next_retry=0
        return 0
    fi

    log "recovery-agent restart did not pass health check"
    recovery_agent_next_retry=$((current + recovery_agent_backoff))
    recovery_agent_backoff=$(increase_backoff "$recovery_agent_backoff")
    return 1
}

reader_agent_pids() {
    pidof "$READER_PACKAGE" 2>/dev/null
}

reader_agent_healthy() {
    [ -n "$(reader_agent_pids)" ] && port_listening "$READER_PORT"
}

ensure_reader_agent() {
    if [ "$(cat "$READER_MODE_FILE" 2>/dev/null)" = "legacy" ]; then
        if [ -n "$(reader_agent_pids)" ]; then
            log "Stopping ADB reader agent for legacy reader mode"
            am force-stop "$READER_PACKAGE" >/dev/null 2>&1 || true
        fi
        reader_failures=0
        reader_backoff=5
        reader_next_retry=0
        return 0
    fi
    pm path "$READER_PACKAGE" >/dev/null 2>&1 || return 0
    if reader_agent_healthy; then
        reader_failures=0
        reader_backoff=5
        reader_next_retry=0
        return 0
    fi

    reader_failures=$((reader_failures + 1))
    [ "$reader_failures" -ge "$FAIL_THRESHOLD" ] || return 1
    current=$(now)
    [ "$current" -ge "$reader_next_retry" ] || return 1

    log "Restarting ADB reader agent after $reader_failures failed health checks"
    am force-stop "$READER_PACKAGE" >/dev/null 2>&1 || true
    nohup am instrument -w -r "$READER_PACKAGE/$READER_INSTRUMENTATION" \
        >> "$READER_LOG" 2>&1 </dev/null &
    sleep 2
    if reader_agent_healthy; then
        log "ADB reader agent healthy; pid=$(reader_agent_pids | tr '\n' ' ') port=$READER_PORT"
        reader_failures=0
        reader_backoff=5
        reader_next_retry=0
        return 0
    fi

    log "ADB reader agent restart did not pass health check"
    reader_next_retry=$((current + reader_backoff))
    reader_backoff=$(increase_backoff "$reader_backoff")
    return 1
}

frpc_admin_expected() {
    [ -r "$FRPC_CONFIG" ] || return 1
    grep -Eq "(^|[.=[:space:]])(webServer[.]port|admin_port)[[:space:]]*=[[:space:]]*['\"]?$FRPC_ADMIN_PORT(['\"]|[[:space:]]|$)" "$FRPC_CONFIG" 2>/dev/null
}

frpc_healthy() {
    [ -n "$(frpc_pids)" ] || return 1
    if frpc_admin_expected; then
        port_listening "$FRPC_ADMIN_PORT"
        return $?
    fi
    return 0
}

ensure_frpc() {
    if [ ! -x "$FRPC_BIN" ] && [ -x "$FRPC_BACKUP" ]; then
        cp -f "$FRPC_BACKUP" "$FRPC_BIN" >/dev/null 2>&1
        chmod 755 "$FRPC_BIN" >/dev/null 2>&1
        log "Restored missing frpc from deployment backup"
    fi
    [ -x "$FRPC_BIN" ] && [ -r "$FRPC_CONFIG" ] || return 0
    if frpc_healthy; then
        frpc_failures=0
        frpc_backoff=5
        frpc_next_retry=0
        return 0
    fi

    frpc_failures=$((frpc_failures + 1))
    [ "$frpc_failures" -ge "$FAIL_THRESHOLD" ] || return 1
    current=$(now)
    [ "$current" -ge "$frpc_next_retry" ] || return 1

    log "Restarting frpc after $frpc_failures failed health checks"
    stop_frpc
    LD_LIBRARY_PATH="$BASE_DIR" nohup "$FRPC_BIN" -c "$FRPC_CONFIG" >> "$FRPC_LOG" 2>&1 &
    sleep 3
    if frpc_healthy; then
        log "frpc healthy; pid=$(frpc_pids | tr '\n' ' ')"
        frpc_failures=0
        frpc_backoff=5
        frpc_next_retry=0
        return 0
    fi

    log "frpc restart did not pass health check"
    frpc_next_retry=$((current + frpc_backoff))
    frpc_backoff=$(increase_backoff "$frpc_backoff")
    return 1
}

recovery_frpc_healthy() {
    [ -n "$(recovery_frpc_pids)" ] || return 1
    port_listening "$RECOVERY_FRPC_ADMIN_PORT"
}

ensure_recovery_frpc() {
    [ -x "$FRPC_BIN" ] && [ -r "$RECOVERY_FRPC_CONFIG" ] || return 0
    if recovery_frpc_healthy; then
        recovery_frpc_failures=0
        recovery_frpc_backoff=5
        recovery_frpc_next_retry=0
        return 0
    fi

    recovery_frpc_failures=$((recovery_frpc_failures + 1))
    [ "$recovery_frpc_failures" -ge "$FAIL_THRESHOLD" ] || return 1
    current=$(now)
    [ "$current" -ge "$recovery_frpc_next_retry" ] || return 1

    log "Restarting recovery frpc after $recovery_frpc_failures failed health checks"
    stop_recovery_frpc
    LD_LIBRARY_PATH="$BASE_DIR" nohup "$FRPC_BIN" -c "$RECOVERY_FRPC_CONFIG" >> "$RECOVERY_FRPC_LOG" 2>&1 &
    sleep 3
    if recovery_frpc_healthy; then
        log "recovery frpc healthy; pid=$(recovery_frpc_pids | tr '\n' ' ')"
        recovery_frpc_failures=0
        recovery_frpc_backoff=5
        recovery_frpc_next_retry=0
        return 0
    fi

    log "recovery frpc restart did not pass health check"
    recovery_frpc_next_retry=$((current + recovery_frpc_backoff))
    recovery_frpc_backoff=$(increase_backoff "$recovery_frpc_backoff")
    return 1
}

component_status() {
    component="$1"
    case "$component" in
        shizuku)
            pid=$(shell_shizuku_pid 2>/dev/null)
            [ -n "$pid" ] && echo "running:$pid" || echo "stopped"
            ;;
        local-service)
            [ -x "$LOCAL_SERVICE_BIN" ] || { echo "not_installed"; return; }
            if local_service_healthy; then
                echo "running:$(local_service_pids | tr '\n' ' ')"
            elif [ -n "$(local_service_pids)" ]; then
                echo "unhealthy:$(local_service_pids | tr '\n' ' ')"
            else
                echo "stopped"
            fi
            ;;
        frpc)
            [ -x "$FRPC_BIN" ] && [ -r "$FRPC_CONFIG" ] || { echo "not_installed"; return; }
            if frpc_healthy; then
                echo "running:$(frpc_pids | tr '\n' ' ')"
            elif [ -n "$(frpc_pids)" ]; then
                echo "unhealthy:$(frpc_pids | tr '\n' ' ')"
            else
                echo "stopped"
            fi
            ;;
        recovery-agent)
            [ -x "$RECOVERY_AGENT_BIN" ] || { echo "not_installed"; return; }
            if recovery_agent_healthy; then
                echo "running:$(recovery_agent_pids | tr '\n' ' ')"
            elif [ -n "$(recovery_agent_pids)" ]; then
                echo "unhealthy:$(recovery_agent_pids | tr '\n' ' ')"
            else
                echo "stopped"
            fi
            ;;
        recovery-frpc)
            [ -x "$FRPC_BIN" ] && [ -r "$RECOVERY_FRPC_CONFIG" ] || { echo "not_installed"; return; }
            if recovery_frpc_healthy; then
                echo "running:$(recovery_frpc_pids | tr '\n' ' ')"
            elif [ -n "$(recovery_frpc_pids)" ]; then
                echo "unhealthy:$(recovery_frpc_pids | tr '\n' ' ')"
            else
                echo "stopped"
            fi
            ;;
        reader-agent)
            [ "$(cat "$READER_MODE_FILE" 2>/dev/null)" = "legacy" ] && { echo "disabled:legacy"; return; }
            pm path "$READER_PACKAGE" >/dev/null 2>&1 || { echo "not_installed"; return; }
            if reader_agent_healthy; then
                echo "running:$(reader_agent_pids | tr '\n' ' ')"
            elif [ -n "$(reader_agent_pids)" ]; then
                echo "unhealthy:$(reader_agent_pids | tr '\n' ' ')"
            else
                echo "stopped"
            fi
            ;;
    esac
}

active_route() {
    if local_service_healthy && frpc_healthy; then
        echo "primary"
    elif recovery_agent_healthy && recovery_frpc_healthy; then
        echo "recovery"
    else
        echo "offline"
    fi
}

supervisor_status() {
    supervisor="stopped"
    if [ -r "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE" 2>/dev/null)
        pid_alive "$pid" && supervisor="running:$pid"
    fi
    printf '{"supervisor":"%s","shizuku":"%s","localService":"%s","frpc":"%s","recoveryAgent":"%s","recoveryFrpc":"%s","readerAgent":"%s","route":"%s"}\n' \
        "$supervisor" \
        "$(component_status shizuku)" \
        "$(component_status local-service)" \
        "$(component_status frpc)" \
        "$(component_status recovery-agent)" \
        "$(component_status recovery-frpc)" \
        "$(component_status reader-agent)" \
        "$(active_route)"
}

release_lock() {
    rm -f "$PID_FILE" 2>/dev/null
    rmdir "$LOCK_DIR" 2>/dev/null
}

acquire_lock() {
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        echo $$ > "$PID_FILE"
        return 0
    fi

    old_pid=""
    [ -r "$PID_FILE" ] && old_pid=$(cat "$PID_FILE" 2>/dev/null)
    if pid_alive "$old_pid"; then
        return 1
    fi

    rm -rf "$LOCK_DIR" 2>/dev/null
    mkdir "$LOCK_DIR" 2>/dev/null || return 1
    echo $$ > "$PID_FILE"
}

run_loop() {
    acquire_lock || {
        echo "shizuku-supervisor is already running" >&2
        return 1
    }
    trap 'release_lock; exit 0' INT TERM HUP
    trap 'release_lock' EXIT
    log "Supervisor started; pid=$$"
    while true; do
        ensure_shizuku
        ensure_recovery_agent
        ensure_reader_agent
        ensure_local_service
        ensure_frpc
        ensure_recovery_frpc
        sleep "$CHECK_INTERVAL"
    done
}

start_background() {
    if [ -r "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE" 2>/dev/null)
        if pid_alive "$pid"; then
            supervisor_status
            return 0
        fi
    fi
    nohup setsid sh "$SCRIPT_PATH" run < /dev/null > /dev/null 2>&1 &
    sleep 1
    supervisor_status
}

stop_supervisor() {
    pid=""
    [ -r "$PID_FILE" ] && pid=$(cat "$PID_FILE" 2>/dev/null)
    if pid_alive "$pid"; then
        kill "$pid" 2>/dev/null
        count=0
        while pid_alive "$pid" && [ "$count" -lt 5 ]; do
            sleep 1
            count=$((count + 1))
        done
        pid_alive "$pid" && kill -9 "$pid" 2>/dev/null
    fi
    rm -f "$PID_FILE" 2>/dev/null
    rm -rf "$LOCK_DIR" 2>/dev/null
    supervisor_status
}

stop_recovery_route() {
    stop_recovery_frpc
    stop_recovery_agent
    supervisor_status
}

sanitize_config

case "${1:-status}" in
    run) run_loop ;;
    start) start_background ;;
    stop) stop_supervisor ;;
    once)
        ensure_shizuku
        ensure_recovery_agent
        ensure_reader_agent
        ensure_local_service
        ensure_frpc
        ensure_recovery_frpc
        supervisor_status
        ;;
    status) supervisor_status ;;
    stop-recovery) stop_recovery_route ;;
    *)
        echo "usage: $0 {start|run|stop|stop-recovery|once|status}" >&2
        exit 2
        ;;
esac
