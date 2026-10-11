#!/bin/bash
# Fisher 数据库导入脚本 - Linux 版
# 用法:
#   bash import_db.sh <数据库名> <用户名> <密码> [SQL文件路径]
#   示例: bash import_db.sh yuankong07 yuankong07 YourPassword123

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

cd "$(dirname "$0")"
DEPLOY_DIR="$(pwd)"
PROJECT_ROOT="$(dirname "${DEPLOY_DIR}")"
BASE_DIR="$(dirname "${PROJECT_ROOT}")"

# ===== 参数 =====
DB_NAME="${1:-yuankong07}"
DB_USER="${2:-yuankong07}"
DB_PASS="${3:-}"
# ★ 终极单文件 SQL（4 份已合并：主库 + IP初始化 + 963852 IP库 + 补丁SQL）
FINAL_SQL="${BASE_DIR}/fisher_v6_ubuntu24_final.sql"
# 回退兼容（当终极 SQL 不存在时，按 4 份拆分导入）
SQL_FILE="${4:-${BASE_DIR}/adb_linux_compatible.sql}"
IP_SQL_FILE="${BASE_DIR}/adb所需frp tor数据库/ip数据库/init_yuankong_patched.sql"
EXTRA_SQL="${BASE_DIR}/adb所需frp tor数据库/ip数据库/963852.sql"
PATCH_SQL="${BASE_DIR}/db_patch_final.sql"

# 检测 MySQL 客户端
MYSQL_CMD=""
if [ -f "/www/server/mysql/bin/mysql" ]; then
    MYSQL_CMD="/www/server/mysql/bin/mysql"
elif command -v mysql &> /dev/null; then
    MYSQL_CMD="mysql"
else
    log_error "未找到 MySQL 客户端，请先安装 MySQL"
    exit 1
fi

# 如果没有输入密码，尝试从宝塔默认获取
if [ -z "$DB_PASS" ]; then
    if [ -f "/www/server/panel/default.pl" ]; then
        BT_MYSQL_PASS=$(cat /www/server/panel/default.pl 2>/dev/null)
        if [ -n "$BT_MYSQL_PASS" ]; then
            log_warn "未提供密码，使用宝塔面板 root 密码创建用户"
            ROOT_PASS="$BT_MYSQL_PASS"
        fi
    fi
    if [ -z "$ROOT_PASS" ]; then
        read -s -p "请输入 MySQL root 密码: " ROOT_PASS
        echo ""
    fi
fi

echo ""
echo "=========================================="
echo "  Fisher 数据库导入"
echo "=========================================="
echo "  数据库名: $DB_NAME"
echo "  用户名:   $DB_USER"
if [ -f "$FINAL_SQL" ]; then
echo -e "  \033[1;32m★ 终极单文件模式:\033[0m $(basename "$FINAL_SQL") ($(du -h "$FINAL_SQL" | cut -f1))"
echo "    包含：主库 + IP库(963852) + Telegram补丁 + 字段/索引优化"
else
echo "  主SQL:    $(basename "$SQL_FILE")"
echo "  IP库SQL:  $(basename "$IP_SQL_FILE")"
echo "  补丁SQL:  $(basename "$PATCH_SQL")"
fi
echo "=========================================="
echo ""

# 如果用 root 创建用户和库
if [ -n "$ROOT_PASS" ] && [ -z "$DB_PASS" ]; then
    read -s -p "请设置新数据库用户 ${DB_USER} 的密码: " DB_PASS
    echo ""
    if [ -z "$DB_PASS" ]; then
        log_error "密码不能为空"
        exit 1
    fi

    # 用 root 登录创建
    log_info "创建数据库和用户..."
    $MYSQL_CMD -uroot -p"${ROOT_PASS}" -e "
        CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
        DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    " 2>/dev/null || { log_error "创建数据库失败"; exit 1; }

    $MYSQL_CMD -uroot -p"${ROOT_PASS}" -e "
        CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
        GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';
        FLUSH PRIVILEGES;
    " 2>/dev/null || true
    log_info "数据库和用户创建成功"
fi

# 测试连接
log_info "测试 MySQL 连接..."
if ! $MYSQL_CMD -u"${DB_USER}" -p"${DB_PASS}" -h127.0.0.1 -e "USE \`${DB_NAME}\`; SELECT 1;" > /dev/null 2>&1; then
    log_error "数据库连接失败"
    echo "  用户: $DB_USER"
    echo "  数据库: $DB_NAME"
    exit 1
fi
log_info "MySQL 连接成功"

# 导入逻辑：★ 优先终极单文件 → 不存在则回退 4 份拆分
if [ -f "$FINAL_SQL" ]; then
    log_info "✅ 检测到终极单文件 SQL，一次导入全部内容（主库+IP库+Telegram补丁+字段/索引优化）..."
    log_info "文件大小: $(du -h "$FINAL_SQL" | cut -f1) | 预计耗时: 1~3 分钟（视磁盘速度）"
    pv_flag=""
    if command -v pv &> /dev/null; then pv_flag="| pv |"; fi
    $MYSQL_CMD -u"${DB_USER}" -p"${DB_PASS}" -h127.0.0.1 --default-character-set=utf8mb4 -f "${DB_NAME}" < "$FINAL_SQL" 2>&1 | tail -3 || true
    log_success "✅ 终极单文件导入完成！就这一次，不用再导入别的了"
else
    log_warn "未找到终极单文件：$FINAL_SQL，进入回退模式（按 4 份拆分导入）"

    # 导入主 SQL
    if [ -f "$SQL_FILE" ]; then
        log_info "[1/4] 导入主数据库结构... ($(du -h "$SQL_FILE" | cut -f1))"
        pv_flag=""
        if command -v pv &> /dev/null; then pv_flag="| pv |"; fi
        $MYSQL_CMD -u"${DB_USER}" -p"${DB_PASS}" -h127.0.0.1 --default-character-set=utf8mb4 "${DB_NAME}" < "$SQL_FILE"
        log_info "[1/4] 主数据库导入完成"
    else
        log_warn "未找到主 SQL 文件: $SQL_FILE"
    fi

    # 导入 IP 数据库 SQL
    if [ -f "$IP_SQL_FILE" ]; then
        log_info "[2/4] 导入 IP 数据库初始化脚本..."
        $MYSQL_CMD -u"${DB_USER}" -p"${DB_PASS}" -h127.0.0.1 --default-character-set=utf8mb4 "${DB_NAME}" < "$IP_SQL_FILE" 2>/dev/null || \
        $MYSQL_CMD -u"${DB_USER}" -p"${DB_PASS}" -h127.0.0.1 --default-character-set=utf8mb4 -f "${DB_NAME}" < "$IP_SQL_FILE" || true
        log_info "[2/4] IP 初始化脚本导入完成"
    else
        log_warn "未找到 IP 初始化 SQL: $IP_SQL_FILE"
    fi

    # 导入额外的 963852.sql
    if [ -f "$EXTRA_SQL" ]; then
        log_info "[3/4] 导入 IP 地址库数据..."
        $MYSQL_CMD -u"${DB_USER}" -p"${DB_PASS}" -h127.0.0.1 --default-character-set=utf8mb4 -f "${DB_NAME}" < "$EXTRA_SQL" 2>/dev/null || true
        log_info "[3/4] IP 地址库导入完成"
    else
        log_warn "未找到 963852.sql: $EXTRA_SQL"
    fi

    # 导入数据库补丁 (Telegram新配置 + 缺失字段补全 + 索引优化)
    if [ -f "$PATCH_SQL" ]; then
        log_info "[4/4] 应用数据库最终补丁: 补全字段 + 索引优化 + 新Telegram配置..."
        $MYSQL_CMD -u"${DB_USER}" -p"${DB_PASS}" -h127.0.0.1 --default-character-set=utf8mb4 -f "${DB_NAME}" < "$PATCH_SQL" 2>&1 | tail -5 || true
        log_info "[4/4] 数据库补丁应用成功"
    else
        log_warn "未找到补丁 SQL: $PATCH_SQL"
    fi
fi

# 检查表数量 + 5 项内容验证（Telegram/FRP是否到位）
TABLE_COUNT=$($MYSQL_CMD -u"${DB_USER}" -p"${DB_PASS}" -h127.0.0.1 -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}'" 2>/dev/null)
echo ""
log_info "导入完成！当前数据库共有 ${TABLE_COUNT} 张表"

echo ""
echo -e "\033[1;34m========== 🧪 内容自检验 ==========\033[0m"
CHECK_PASS=0
CHECK_TOTAL=5

# 1. tg_1_bot_token
V1=$($MYSQL_CMD -u"${DB_USER}" -p"${DB_PASS}" -h127.0.0.1 -Nse "SELECT value FROM \`${DB_NAME}\`.fisher_settings WHERE \`key\`='tg_1_bot_token' LIMIT 1" 2>/dev/null)
if echo "$V1" | grep -q "8686402295"; then
    echo -e "  \033[1;32m[1/5 ✅]\033[0m Telegram Bot Token = 你的新 Bot (8686402295:AAHV...)"
    CHECK_PASS=$((CHECK_PASS+1))
else
    echo -e "  \033[1;31m[1/5 ❌]\033[0m tg_1_bot_token 不是你的新值，请手动执行 db_patch_final.sql"
fi

# 2. tg_1_chat_id
V2=$($MYSQL_CMD -u"${DB_USER}" -p"${DB_PASS}" -h127.0.0.1 -Nse "SELECT value FROM \`${DB_NAME}\`.fisher_settings WHERE \`key\`='tg_1_chat_id' LIMIT 1" 2>/dev/null)
if [ "$V2" = "8339827498" ]; then
    echo -e "  \033[1;32m[2/5 ✅]\033[0m Telegram ChatID = $V2 (你的 8339827498)"
    CHECK_PASS=$((CHECK_PASS+1))
else
    echo -e "  \033[1;31m[2/5 ❌]\033[0m tg_1_chat_id 不对，当前值：$V2"
fi

# 3. users表telegram_chat_id字段
V3=$($MYSQL_CMD -u"${DB_USER}" -p"${DB_PASS}" -h127.0.0.1 -Nse "SELECT telegram_chat_id FROM \`${DB_NAME}\`.fisher_users WHERE id=1 LIMIT 1" 2>/dev/null)
if [ "$V3" = "8339827498" ]; then
    echo -e "  \033[1;32m[3/5 ✅]\033[0m admin(id=1) 绑定 ChatID = $V3"
    CHECK_PASS=$((CHECK_PASS+1))
else
    echo -e "  \033[1;31m[3/5 ❌]\033[0m fisher_users.id=1.telegram_chat_id 缺失或错误（当前:$V3）→ 补丁没跑"
fi

# 4. sys_frps_addr
V4=$($MYSQL_CMD -u"${DB_USER}" -p"${DB_PASS}" -h127.0.0.1 -Nse "SELECT value FROM \`${DB_NAME}\`.fisher_settings WHERE \`key\`='sys_frps_addr' LIMIT 1" 2>/dev/null)
if [ "$V4" = "142.111.146.241" ]; then
    echo -e "  \033[1;32m[4/5 ✅]\033[0m FRPS 对外地址 = 142.111.146.241 (你的公网 IP)"
    CHECK_PASS=$((CHECK_PASS+1))
else
    echo -e "  \033[1;33m[4/5 ⚠ ]\033[0m sys_frps_addr 未设置（当前：$V4），面板里手动填即可"
fi

# 5. 表数量
if [ "$TABLE_COUNT" -ge 55 ] 2>/dev/null; then
    echo -e "  \033[1;32m[5/5 ✅]\033[0m 表数量 = $TABLE_COUNT（≥ 55 正常）"
    CHECK_PASS=$((CHECK_PASS+1))
else
    echo -e "  \033[1;31m[5/5 ❌]\033[0m 表数量 = $TABLE_COUNT 太少，主库没导全"
fi

echo ""
if [ "$CHECK_PASS" -eq "$CHECK_TOTAL" ]; then
    echo -e "\033[1;42;97m ============== 🎉 数据库 100% 完美就位！直接进入第十二章启动服务 ============== \033[0m"
else
    echo -e "\033[1;43;30m ============== ⚠️  5项通过 $CHECK_PASS/$CHECK_TOTAL，根据上面 ❌ 提示补做对应操作 ============== \033[0m"
fi

# 显示凭证
echo ""
echo "=========================================="
echo "  数据库连接凭证 (请保存)"
echo "=========================================="
echo "  主机:     127.0.0.1"
echo "  端口:     3306"
echo "  数据库:   ${DB_NAME}"
echo "  用户名:   ${DB_USER}"
echo "  密码:     ${DB_PASS}"
echo "  字符集:   utf8mb4"
echo "  排序:     utf8mb4_unicode_ci"
echo "=========================================="
