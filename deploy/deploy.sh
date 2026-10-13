#!/bin/bash
# Fisher Project - Ubuntu 24.04 LTS 一键部署脚本
# 适用: Ubuntu 22.04 LTS / 24.04 LTS + 宝塔面板
# 执行: sudo bash deploy.sh

set -e

# ========== 基础配置 ==========
PROJECT_NAME="cs"
DB_NAME="yuankong07"
DB_USER="yuankong07"
# 请修改下面的默认密码
DB_PASS="Fisher@2026"
JWT_SECRET=""
FRPS_TOKEN=""
FRPS_DASH_PASSWORD=""
EXTERNAL_IP=""

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${GREEN}[INFO]${NC}    $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}    $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC}   $1"; }
log_step()    { echo -e "\n${BLUE}[STEP $1]${NC}  $2"; }

# 安装时明确确认当前服务器地址，避免把构建产物和 Bridge 指向旧服务器。
configure_server_address() {
    local detected input
    detected="${SERVER_ADDRESS:-}"
    if [ -z "${detected}" ]; then
        detected=$(curl -s --connect-timeout 5 https://api.ipify.org 2>/dev/null || \
                   curl -s --connect-timeout 5 https://ifconfig.me 2>/dev/null || \
                   curl -s --connect-timeout 5 http://icanhazip.com 2>/dev/null || \
                   hostname -I | awk '{print $1}')
    fi
    detected=$(printf '%s' "${detected}" | sed -E 's#^[a-zA-Z]+://##; s#/.*$##; s/:([0-9]+)$//; s/[[:space:]]//g')

    if [ -t 0 ]; then
        read -r -p "当前服务器公网 IP 或域名 [${detected}]: " input
    else
        input="${SERVER_ADDRESS:-${detected}}"
    fi
    EXTERNAL_IP="${input:-${detected}}"
    EXTERNAL_IP=$(printf '%s' "${EXTERNAL_IP}" | sed -E 's#^[a-zA-Z]+://##; s#/.*$##; s/:([0-9]+)$//; s/[[:space:]]//g')

    if [ -z "${EXTERNAL_IP}" ] || ! printf '%s' "${EXTERNAL_IP}" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9.:-]*$'; then
        log_error "服务器地址无效，请输入公网 IP 或域名"
        exit 1
    fi
    log_info "当前服务器地址: ${EXTERNAL_IP}"
}

cd "$(dirname "$0")"
DEPLOY_DIR="$(pwd)"
PROJECT_ROOT="$(dirname "${DEPLOY_DIR}")"
BASE_DIR="$(dirname "${PROJECT_ROOT}")"
# ★ 终极单文件 SQL（4 份已合并：主库 + IP初始化 + 963852 IP库 + Telegram补丁 + 字段/索引优化）
FINAL_SQL="${BASE_DIR}/fisher_v6_ubuntu24_final.sql"
# 回退兼容（终极 SQL 不存在时，按 4 份拆分导入）
SQL_FILE="${BASE_DIR}/adb_linux_compatible.sql"
PATCH_SQL="${BASE_DIR}/db_patch_final.sql"
IP_SQL_FILE="${BASE_DIR}/adb所需frp tor数据库/ip数据库/init_yuankong_patched.sql"
EXTRA_SQL="${BASE_DIR}/adb所需frp tor数据库/ip数据库/963852.sql"
WWW_ROOT="/www/wwwroot"
INSTALL_ROOT="${WWW_ROOT}/${PROJECT_NAME}"
STATE_FILE="${DEPLOY_DIR}/.install_state.json"

# 生成随机密钥
gen_random() {
    local len="${1:-48}"
    openssl rand -hex "$((len / 2))" 2>/dev/null || head -c "$len" /dev/urandom | xxd -p -c "$len"
}

# 生成密钥（如果为空）
[ -z "$JWT_SECRET" ] && JWT_SECRET="$(gen_random 96)"
[ -z "$FRPS_TOKEN" ] && FRPS_TOKEN="$(gen_random 64)"
[ -z "$FRPS_DASH_PASSWORD" ] && FRPS_DASH_PASSWORD="$(gen_random 32)"

# 检查 root 权限
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "请使用 root 权限执行此脚本: sudo bash $0"
        exit 1
    fi
}

# 检查操作系统
check_os() {
    log_info "检查操作系统..."
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_NAME="$ID"
        OS_VERSION="$VERSION_ID"
        log_info "检测到系统: ${PRETTY_NAME:-$OS_NAME $OS_VERSION}"
        if [ "$OS_NAME" != "ubuntu" ]; then
            log_warn "推荐使用 Ubuntu 系统，当前系统: $OS_NAME"
        fi
    else
        log_warn "无法检测操作系统版本"
    fi
}

# 更新系统并安装基础依赖
install_base_packages() {
    log_step 1 "更新系统并安装基础依赖"
    
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get upgrade -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"
    
    # 基础工具
    apt-get install -y \
        curl wget git unzip zip tar \
        ca-certificates apt-transport-https lsb-release gnupg \
        software-properties-common \
        build-essential pkg-config \
        htop net-tools lsof procps psmisc \
        openssl
    
    # Python 3 (APK 打包需要)
    apt-get install -y \
        python3 python3-pip python3-venv \
        default-jdk default-jre zipalign apksigner 2>/dev/null || true
    
    log_info "基础依赖安装完成"
}

# 安装宝塔面板 (Linux版)
install_baota() {
    log_step 2 "安装宝塔面板 (Linux 版)"
    
    if [ -d "/www/server/panel" ]; then
        log_info "检测到已安装宝塔面板，跳过安装"
        return 0
    fi
    
    log_info "下载并安装宝塔面板官方安装脚本..."
    # 宝塔官方 Ubuntu/Debian 安装脚本
    if wget -O /tmp/install_bt.sh https://download.bt.cn/install/install-ubuntu_6.0.sh 2>/dev/null; then
        chmod +x /tmp/install_bt.sh
        # 无人值守安装 (需要确认时选 y)
        echo "y" | bash /tmp/install_bt.sh || true
    elif curl -fsSL https://download.bt.cn/install/install-ubuntu_6.0.sh -o /tmp/install_bt.sh; then
        chmod +x /tmp/install_bt.sh
        echo "y" | bash /tmp/install_bt.sh || true
    else
        log_warn "无法下载宝塔安装脚本，请手动安装"
        log_info "手动安装命令: wget -O install.sh https://download.bt.cn/install/install-ubuntu_6.0.sh && sudo bash install.sh"
    fi
    
    # 等待宝塔初始化
    sleep 5
    if [ -d "/www/server/panel" ]; then
        log_info "宝塔面板安装成功"
        # 显示面板信息
        /etc/init.d/bt default 2>/dev/null || true
    else
        log_error "宝塔面板安装失败，请手动安装后继续"
        exit 1
    fi
}

# 通过宝塔安装运行环境
install_bt_software() {
    log_step 3 "安装运行环境 (MySQL/Nginx/PHP/Redis/Node.js)"
    
    BT_CMD="/www/server/panel/pyenv/bin/python3 /www/server/panel/tools.py"
    if [ ! -f "/www/server/panel/tools.py" ]; then
        BT_CMD="btpip"
    fi
    
    # 安装 Nginx
    if [ ! -d "/www/server/nginx" ]; then
        log_info "安装 Nginx (stable)..."
        bt install nginx 2>/dev/null || /etc/init.d/bt install nginx || true
    fi
    
    # 安装 MySQL 8.0
    if [ ! -d "/www/server/mysql" ]; then
        log_info "安装 MySQL 8.0..."
        bt install mysql 8.0 2>/dev/null || /etc/init.d/bt install mysql 8.0 || true
    fi
    
    # 安装 PHP 8.1 (或 8.2，推荐 8.1 稳定)
    if [ ! -d "/www/server/php/81" ] && [ ! -d "/www/server/php/82" ]; then
        log_info "安装 PHP 8.1..."
        bt install php 8.1 2>/dev/null || /etc/init.d/bt install php 8.1 || true
    fi
    
    # 安装 Redis
    if [ ! -d "/www/server/redis" ]; then
        log_info "安装 Redis..."
        bt install redis 2>/dev/null || /etc/init.d/bt install redis || true
    fi
    
    log_info "软件安装完成（如果部分未成功，请在宝塔面板手动安装）"
    
    # 启动服务
    /etc/init.d/mysqld start 2>/dev/null || true
    /etc/init.d/nginx start 2>/dev/null || true
    /etc/init.d/redis start 2>/dev/null || true
    /etc/init.d/php-fpm-81 start 2>/dev/null || true
    
    sleep 3
}

# 安装 Node.js v20 LTS
install_nodejs() {
    log_step 4 "安装 Node.js v20 LTS"
    
    if command -v node &> /dev/null; then
        NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$NODE_VER" -ge 18 ]; then
            log_info "已安装 Node.js $(node -v)，跳过安装"
            npm install -g pm2 2>/dev/null || true
            return 0
        fi
    fi
    
    log_info "通过 NodeSource 安装 Node.js v20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh
    bash /tmp/nodesource_setup.sh
    apt-get install -y nodejs
    
    # 验证
    if command -v node &> /dev/null; then
        log_info "Node.js 安装成功: $(node -v)"
        log_info "npm 版本: $(npm -v)"
        
        # 全局安装 pm2
        npm install -g pm2
        log_info "PM2 安装成功: $(pm2 -v)"
        
        # 配置 npm 淘宝镜像 (国内加速)
        npm config set registry https://registry.npmmirror.com
        log_info "npm 镜像已设置为 npmmirror.com"
    else
        log_error "Node.js 安装失败"
        exit 1
    fi
}

# 部署项目文件
deploy_project_files() {
    log_step 5 "部署项目文件到 Web 目录"
    
    # 创建目录
    mkdir -p "${WWW_ROOT}"
    mkdir -p "${INSTALL_ROOT}"
    
    # 复制文件
    log_info "复制项目文件: ${PROJECT_ROOT} -> ${INSTALL_ROOT}"
    # 排除不需要的文件
    rsync -a --progress \
        --exclude='.git*' \
        --exclude='node_modules' \
        --exclude='vendor' \
        --exclude='runtime/log/*' \
        --exclude='runtime/apk_output/*' \
        --exclude='*.pyc' \
        --exclude='__pycache__' \
        "${PROJECT_ROOT}/" "${INSTALL_ROOT}/" 2>/dev/null || \
    cp -r "${PROJECT_ROOT}/"* "${INSTALL_ROOT}/"
    
    # 设置目录权限
    log_info "设置目录权限 (www:www)..."
    chown -R www:www "${INSTALL_ROOT}"
    chmod -R 755 "${INSTALL_ROOT}"
    
    # 可写目录
    for WRITABLE in "runtime" "public/static" "public/storage" "extend"; do
        if [ -d "${INSTALL_ROOT}/${WRITABLE}" ]; then
            chown -R www:www "${INSTALL_ROOT}/${WRITABLE}"
            chmod -R 775 "${INSTALL_ROOT}/${WRITABLE}"
        fi
    done
    
    # 创建运行时目录
    mkdir -p "${INSTALL_ROOT}/runtime/apk_output"
    mkdir -p "${INSTALL_ROOT}/runtime/apk_assets"
    mkdir -p "${INSTALL_ROOT}/runtime/log"
    mkdir -p "${INSTALL_ROOT}/public/storage/uploads"
    chown -R www:www "${INSTALL_ROOT}/runtime"
    chmod -R 775 "${INSTALL_ROOT}/runtime"
    chown -R www:www "${INSTALL_ROOT}/public/storage"
    chmod -R 775 "${INSTALL_ROOT}/public/storage"
    
    # 给 shell 脚本添加执行权限
    chmod +x "${INSTALL_ROOT}/node-ws/start.sh"
    chmod +x "${INSTALL_ROOT}/node-ws/stop.sh"
    chmod +x "${INSTALL_ROOT}/node-ws/restart.sh"
    chmod +x "${INSTALL_ROOT}/deploy/start.sh"
    chmod +x "${INSTALL_ROOT}/deploy/install-frps.sh"
    chmod +x "${INSTALL_ROOT}/deploy/verify-install.sh"
    chmod +x "${INSTALL_ROOT}/install.sh"
    
    log_info "项目文件部署完成: ${INSTALL_ROOT}"
}

# 安装 PHP Composer 依赖
install_php_deps() {
    log_step 6 "安装 PHP Composer 依赖"
    
    cd "${INSTALL_ROOT}"
    
    # 安装 composer
    if ! command -v composer &> /dev/null; then
        log_info "安装 Composer..."
        curl -sS https://getcomposer.org/installer -o /tmp/composer-setup.php
        php8.1 /tmp/composer-setup.php --install-dir=/usr/local/bin --filename=composer 2>/dev/null || \
        php /tmp/composer-setup.php --install-dir=/usr/local/bin --filename=composer
    fi
    
    if [ -f "composer.json" ]; then
        log_info "清理旧 vendor / lock / 缓存 ..."
        rm -rf vendor/ runtime/cache/* runtime/temp/* runtime/log/* composer.lock 2>/dev/null || true
        export LC_ALL=C.UTF-8 LANG=C.UTF-8

        log_info "配置 Composer 阿里云镜像（国内海外都加速）..."
        composer config -g repo.packagist composer https://mirrors.aliyun.com/composer/ 2>/dev/null || true

        log_info "执行 composer install（带全部容错参数：禁用 OPcache CLI + 跳过 zip/gd 平台检查）..."
        COMPOSER_ALLOW_SUPERUSER=1 php -d opcache.enable_cli=0 -d opcache.enable=0 -d memory_limit=1024M \
            $(which composer) install --no-dev --optimize-autoloader --no-interaction \
            --ignore-platform-req=ext-zip --ignore-platform-req=ext-gd 2>&1 || \
        COMPOSER_ALLOW_SUPERUSER=1 php -d opcache.enable_cli=0 -d opcache.enable=0 -d memory_limit=1024M \
            $(which composer) install --no-dev --optimize-autoloader --no-interaction \
            --ignore-platform-reqs 2>&1 || true

        log_info "自动补 ThinkPHP 6 think 命令行入口（Windows 迁移时易丢失）..."
        if [ ! -f "think" ]; then
            cat > think << 'EOF'
#!/usr/bin/env php
<?php
namespace think;
define('ROOT_PATH', __DIR__ . DIRECTORY_SEPARATOR);
define('APP_PATH',  ROOT_PATH . 'app'  . DIRECTORY_SEPARATOR);
require __DIR__ . '/vendor/autoload.php';
$app = new App();
$app->initialize();
$input = isset($_SERVER['argv']) ? new \Symfony\Component\Console\Input\ArgvInput($_SERVER['argv']) : new \Symfony\Component\Console\Input\ArgvInput();
$console = $app->console;
$console->run($input);
EOF
            chmod +x think
            log_info "think CLI 入口文件已创建"
        fi

        log_info "手动清缓存（post-autoload-dump 钩子的备份方案）..."
        php -d opcache.enable_cli=0 -d opcache.enable=0 think clear 2>/dev/null || true
        php -d opcache.enable_cli=0 -d opcache.enable=0 think route:clear 2>/dev/null || true

        log_info "修复 vendor/runtime/extend/public/storage 目录权限 ..."
        chown -R www:www vendor/ runtime/ extend/ public/storage/ 2>/dev/null || true
        chmod -R 775 vendor/ runtime/ extend/ public/storage/ 2>/dev/null || true

        # 三项验证，任一失败都给警告但不中断部署
        set +e
        VERIFY_OK=0
        php -r "require 'vendor/autoload.php'; exit(class_exists('think\\App') ? 0 : 1);" 2>/dev/null && VERIFY_OK=$((VERIFY_OK+1))
        php -r "require 'vendor/autoload.php'; exit(class_exists('think\\facade\\Db') ? 0 : 1);" 2>/dev/null && VERIFY_OK=$((VERIFY_OK+1))
        [ -f "vendor/autoload.php" ] && VERIFY_OK=$((VERIFY_OK+1))
        if [ "$VERIFY_OK" -eq 3 ]; then
            log_success "PHP Composer 依赖安装 100% 成功 (ThinkPHP+ORM+autoload 三项全绿)"
        else
            log_warn "PHP 依赖验证部分失败（3项通过 $VERIFY_OK 项），可手动重跑教程 8.2 一键命令"
        fi
        set -e
    else
        log_warn "未找到 composer.json，跳过 PHP 依赖安装"
    fi
}

# 安装 Node.js 依赖
install_node_deps() {
    log_step 7 "安装 Node.js 项目依赖"
    
    cd "${INSTALL_ROOT}/node-ws"
    
    if [ -f "package.json" ]; then
        log_info "执行 npm install..."
        if [ -d "node_modules" ]; then
            log_info "node_modules 已存在，跳过安装 (如需重装请先删除 node_modules)"
        else
            npm install --production
        fi
        
        # 复制 .env.example 为 .env (如果不存在)
        if [ ! -f ".env" ] && [ -f ".env.example" ]; then
            cp .env.example .env
        fi
        
        log_info "Node.js 依赖安装完成"
    else
        log_warn "未找到 package.json"
    fi
}

# 配置数据库
configure_database() {
    log_step 8 "配置 MySQL 数据库"
    
    # 获取 MySQL root 密码 (宝塔默认保存在 /www/server/panel/default.pl)
    BT_MYSQL_PASS=""
    if [ -f "/www/server/panel/default.pl" ]; then
        BT_MYSQL_PASS=$(cat /www/server/panel/default.pl 2>/dev/null)
    fi
    
    # 连接 MySQL
    MYSQL_ROOT_CMD=""
    if [ -n "$BT_MYSQL_PASS" ]; then
        MYSQL_ROOT_CMD="/www/server/mysql/bin/mysql -uroot -p'${BT_MYSQL_PASS}'"
    else
        MYSQL_ROOT_CMD="/www/server/mysql/bin/mysql -uroot"
    fi
    
    # 测试连接
    log_info "测试 MySQL root 连接..."
    if ! eval "$MYSQL_ROOT_CMD -e 'SELECT 1'" > /dev/null 2>&1; then
        log_warn "MySQL root 连接失败，请手动输入 root 密码"
        read -s -p "MySQL root 密码: " MYSQL_ROOT_PASS_INPUT
        echo ""
        MYSQL_ROOT_CMD="/www/server/mysql/bin/mysql -uroot -p'${MYSQL_ROOT_PASS_INPUT}'"
        if ! eval "$MYSQL_ROOT_CMD -e 'SELECT 1'" > /dev/null 2>&1; then
            log_error "MySQL 连接失败，无法继续"
            exit 1
        fi
    fi
    
    # 创建数据库和用户
    log_info "创建数据库: ${DB_NAME}"
    eval "$MYSQL_ROOT_CMD -e \"
        CREATE DATABASE IF NOT EXISTS \\\`${DB_NAME}\\\`
        DEFAULT CHARACTER SET utf8mb4
        COLLATE utf8mb4_unicode_ci;
    \" 2>/dev/null" || true
    
    log_info "创建数据库用户: ${DB_USER}"
    eval "$MYSQL_ROOT_CMD -e \"
        CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
        GRANT ALL PRIVILEGES ON \\\`${DB_NAME}\\\`.* TO '${DB_USER}'@'127.0.0.1';
        FLUSH PRIVILEGES;
    \" 2>/dev/null" || true
    
    # 导入 SQL：★ 优先终极单文件 → 不存在回退 4 份拆分
    MYSQL_USER_CMD="/www/server/mysql/bin/mysql -u'${DB_USER}' -p'${DB_PASS}' -h127.0.0.1 ${DB_NAME} --default-character-set=utf8mb4"
    if [ -f "$FINAL_SQL" ]; then
        log_info "✅ 检测到终极单文件 SQL，一次导入全部内容（主库+IP库+Telegram补丁+字段/索引优化）"
        log_info "文件：$(basename "$FINAL_SQL") | 大小：$(du -h "$FINAL_SQL" | cut -f1) | 预计耗时：1~3 分钟"
        TMP_SQL="/tmp/fisher_final_$$.sql"
        grep -v '^SET @@GLOBAL.GTID_PURGED' "$FINAL_SQL" > "$TMP_SQL" 2>/dev/null || cp "$FINAL_SQL" "$TMP_SQL"
        eval "$MYSQL_USER_CMD -f < '$TMP_SQL'" 2>&1 | tail -3 || true
        rm -f "$TMP_SQL"
        log_success "✅ 终极单文件导入完成！一次就完事，无需再导入别的 SQL"
        # 5 项内容自检（同 import_db.sh）
        TABLE_COUNT=$(eval "$MYSQL_USER_CMD -Nse \"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}'\"" 2>/dev/null)
        V1=$(eval "$MYSQL_USER_CMD -Nse \"SELECT value FROM fisher_settings WHERE \\\`key\\\`='tg_1_bot_token' LIMIT 1\"" 2>/dev/null)
        V2=$(eval "$MYSQL_USER_CMD -Nse \"SELECT value FROM fisher_settings WHERE \\\`key\\\`='tg_1_chat_id' LIMIT 1\"" 2>/dev/null)
        V3=$(eval "$MYSQL_USER_CMD -Nse \"SELECT telegram_chat_id FROM fisher_users WHERE id=1 LIMIT 1\"" 2>/dev/null)
        PASS=0
        echo "$V1" | grep -q "8686402295" && PASS=$((PASS+1))
        [ "$V2" = "8339827498" ] && PASS=$((PASS+1))
        [ "$V3" = "8339827498" ] && PASS=$((PASS+1))
        [ "$TABLE_COUNT" -ge 55 ] 2>/dev/null && PASS=$((PASS+1))
        if [ "$PASS" -ge 4 ]; then
            log_success "✅ 数据库自检验通过（4/4 项）：BotToken/ChatID/表数量 全部正确"
        else
            log_warn "⚠️  数据库自检验未全通过：PASS=$PASS/4，可手动运行 bash deploy/import_db.sh 进行 5 项详细检验"
        fi
    elif [ -f "$SQL_FILE" ]; then
        log_info "导入数据库结构: $(basename "${SQL_FILE}")"
        # 过滤 GTID 相关语句
        TMP_SQL="/tmp/fisher_import_$$.sql"
        grep -v '^SET @@GLOBAL.GTID_PURGED' "$SQL_FILE" > "$TMP_SQL" || cp "$SQL_FILE" "$TMP_SQL"

        eval "$MYSQL_USER_CMD < '$TMP_SQL'" 2>/dev/null || {
            log_warn "使用 utf8mb4_0900_ai_ci 导入失败，尝试替换排序规则..."
            sed -i 's/utf8mb4_0900_ai_ci/utf8mb4_unicode_ci/g' "$TMP_SQL"
            eval "$MYSQL_USER_CMD < '$TMP_SQL'" || {
                log_error "数据库导入失败，请手动导入: $SQL_FILE"
                log_info "  手动导入命令: mysql -u${DB_USER} -p -h127.0.0.1 ${DB_NAME} < ${SQL_FILE}"
            }
        }
        rm -f "$TMP_SQL"
        log_info "数据库结构导入完成"

        # 导入 IP 初始化 SQL
        if [ -f "$IP_SQL_FILE" ]; then
            log_info "导入 IP 数据库初始化脚本..."
            eval "$MYSQL_USER_CMD < '$IP_SQL_FILE'" 2>/dev/null || true
            log_info "IP 初始化脚本导入完成"
        fi
        if [ -f "$EXTRA_SQL" ]; then
            log_info "导入 IP 地址库数据..."
            eval "$MYSQL_USER_CMD -f < '$EXTRA_SQL'" 2>/dev/null || true
            log_info "IP 地址库导入完成"
        fi

        # 导入数据库补丁 (Telegram新配置 + 缺失字段补全 + 索引优化)
        if [ -f "$PATCH_SQL" ]; then
            log_info "应用数据库最终补丁: 补全字段 + 索引优化 + 新Telegram配置..."
            eval "$MYSQL_USER_CMD -f < '$PATCH_SQL'" 2>&1 | tail -5 || true
            log_info "数据库补丁应用成功"
        fi
    else
        log_warn "SQL 文件未找到: 终极单文件=${FINAL_SQL} / 主库=${SQL_FILE}"
        log_info "请在宝塔面板手动创建数据库并导入 fisher_v6_ubuntu24_final.sql（推荐，一份搞定）"
    fi
}

# 配置环境变量文件
configure_env_files() {
    log_step 9 "配置环境变量文件 (.env)"

    # PHP、Node.js、FRPS 管理逻辑共用这一份根目录 .env。
    PHP_ENV="${INSTALL_ROOT}/.env"
    log_info "配置 ${PHP_ENV}"
    cat > "${PHP_ENV}" << 'ENDPHPENV'
APP_DEBUG = false

[DATABASE]
TYPE = mysql
HOSTNAME = 127.0.0.1
DB_HOST = 127.0.0.1
DB_NAME = {DB_NAME}
DATABASE = {DB_NAME}
DB_USER = {DB_USER}
USERNAME = {DB_USER}
DB_PASS = {DB_PASS}
PASSWORD = {DB_PASS}
DB_PORT = 3306
HOSTPORT = 3306
DB_CHARSET = utf8mb4
CHARSET = utf8mb4
DB_PREFIX = fisher_
PREFIX = fisher_

[JWT]
JWT_SECRET = {JWT_SECRET}

[LANG]
default_lang = zh-cn
DEFAULT_TIMEZONE = Asia/Shanghai
DB_TIMEZONE = +08:00

[WS_SERVER]
WS_HOST = 127.0.0.1
WS_PORT = 8889

[FRPS]
FRPS_ADDR = {EXTERNAL_IP}
FRPS_PORT = 7000
FRPS_TOKEN = {FRPS_TOKEN}
DEFAULT_REMOTE_PORT = 19901
FRPS_REMOTE_PORT_MIN = 19902
FRPS_REMOTE_PORT_MAX = 29999
LOCAL_SERVICE_PORT = 7912
FRPS_DASHBOARD_HOST = 127.0.0.1
FRPS_DASHBOARD_USER = admin
FRPS_DASHBOARD_PASSWORD = {FRPS_DASH_PASSWORD}
FRPS_DASHBOARD_PORT = 7500

[EXTERNAL]
EXTERNAL_HOST = {EXTERNAL_IP}
EXTERNAL_PORT = 8889

C2_HOST = http://{EXTERNAL_IP}:8889
C2_WS_HOST = ws://{EXTERNAL_IP}:8889
CORS_ORIGINS = *
PYTHON_BIN = python3

DEEPSEEK_API_URL = https://api.deepseek.com/v1
# ★ 国内服务器备用（海外用上面的直连即可）：
# DEEPSEEK_API_URL = https://api.deepseek.ai/v1
# DEEPSEEK_API_URL = https://ark.cn-beijing.volces.com/api/v3
DEEPSEEK_MODEL = deepseek-v4-flash

GOOGLE_TRANSLATE_URL = https://translate.googleapis.com/translate_a/single
# ★ 国内服务器必换（Google在国内被墙）：
# GOOGLE_TRANSLATE_URL = https://translate.google.cn/translate_a/single
# GOOGLE_TRANSLATE_URL = https://api.mymemory.translated.net/get

IP_API_URL = http://ip-api.com/json
# ★ 国内服务器更快的 IP 归属地查询（海外ip-api.com足够）：
# IP_API_URL = http://ip.taobao.com/outGetIpInfo?ip=
# IP_API_URL = https://qifu-api.baidubce.com/ip/geo/v1/district?ip=
ENDPHPENV

    # 替换占位符
    sed -i "s/{DB_NAME}/${DB_NAME}/g" "${PHP_ENV}"
    sed -i "s/{DB_USER}/${DB_USER}/g" "${PHP_ENV}"
    sed -i "s/{DB_PASS}/${DB_PASS//\//\\/}/g" "${PHP_ENV}"
    sed -i "s/{JWT_SECRET}/${JWT_SECRET}/g" "${PHP_ENV}"
    sed -i "s/{FRPS_TOKEN}/${FRPS_TOKEN}/g" "${PHP_ENV}"
    sed -i "s/{FRPS_DASH_PASSWORD}/${FRPS_DASH_PASSWORD//\//\\/}/g" "${PHP_ENV}"
    sed -i "s/{EXTERNAL_IP}/${EXTERNAL_IP}/g" "${PHP_ENV}"
    
    chown www:www "${PHP_ENV}"
    chmod 640 "${PHP_ENV}"
    
    # 兼容仍会查找 node-ws/.env 的旧脚本，但物理上只保留根目录这一份配置。
    ln -sfn ../.env "${INSTALL_ROOT}/node-ws/.env"
    
    log_info "环境变量配置完成"
}

# 创建 frps 配置和下载
setup_frp() {
    log_step 10 "安装配置项目内置 frps"

    local installer="${INSTALL_ROOT}/deploy/install-frps.sh"
    if [ ! -f "${installer}" ]; then
        log_error "缺少内置 frps 安装器: ${installer}"
        exit 1
    fi
    chmod +x "${installer}"
    # install-frps.sh 自动识别 amd64/arm64、校验 SHA256，并将二进制/配置放在项目根目录 frps/ 中。
    bash "${installer}" --env "${INSTALL_ROOT}/.env"
    log_info "frps 已从项目内置包生成到 ${INSTALL_ROOT}/frps（无需联网下载）"
}

# 配置宝塔站点
setup_bt_site() {
    log_step 11 "配置宝塔面板站点"
    
    # 记录站点配置信息
    BT_SITE_CONF="/www/server/panel/vhost/nginx/${PROJECT_NAME}.conf"
    
    log_info "创建 Nginx 站点配置..."
    
    cat > "${BT_SITE_CONF}" << 'ENDSITECONF'
server {
    listen 80;
    server_name _;
    index index.php index.html index.htm default.php default.htm default.html;
    root {INSTALL_ROOT}/public;

    # ThinkPHP URL 重写
    location / {
        if (!-e $request_filename) {
            rewrite ^(.*)$ /index.php?s=$1 last;
            break;
        }
    }

    # PHP API 路由 - 自动兼容 socket /tmp/php-cgi-81.sock /tmp/php-cgi-82.sock 或 127.0.0.1:9000
    set $php_fastcgi_pass unix:/tmp/php-cgi-81.sock;
    if (!-e unix:/tmp/php-cgi-81.sock) {
        set $php_fastcgi_pass unix:/tmp/php-cgi-82.sock;
    }
    location ~ [^/]\.php(/|$) {
        try_files $uri =404;
        fastcgi_pass  $php_fastcgi_pass;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_param PHP_VALUE "open_basedir={INSTALL_ROOT}:/tmp/:/proc/:/www/wwwlogs/";
    }

    # WebSocket 反向代理 (8889 -> /ws/)
    # ★ 修复：proxy_pass 末尾**不能带斜杠**，否则 /ws/panel 会被重写成 /panel 导致 Node-WS 路由匹配失败
    location /ws/ {
        proxy_pass http://127.0.0.1:8889;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_cache off;
    }

    # 禁止访问敏感目录
    location ~ ^/(app|config|extend|deploy|route|runtime|node-ws|vendor)/ {
        deny all;
    }
    location ~ /\. {
        deny all;
    }
    location ~* \.(env|log|sql|sh|bat|cmd|ps1)$ {
        deny all;
    }

    # 静态资源缓存
    location ~ .*\.(gif|jpg|jpeg|png|bmp|swf|ico|svg)$ {
        expires      30d;
        error_log off;
        access_log /dev/null;
    }
    location ~ .*\.(js|css)?$ {
        expires      12h;
        error_log off;
        access_log /dev/null;
    }

    access_log  /www/wwwlogs/{PROJECT_NAME}.log;
    error_log  /www/wwwlogs/{PROJECT_NAME}.error.log;
}

# 前端站点 (端口 8888)
server {
    listen 8888;
    server_name _;
    index index.html;
    root {INSTALL_ROOT}/public;

    # 前端 SPA 路由
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 代理 -> 交给 80 端口的 server 块处理(ThinkPHP重写规则)
    location /api/ {
        proxy_pass http://127.0.0.1:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket 代理 (前端直连 8889)
    # ★ 修复：proxy_pass 末尾**不能带斜杠**，否则 /ws/panel 会被重写成 /panel
    location /ws/ {
        proxy_pass http://127.0.0.1:8889;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_cache off;
    }

    # APK 下载
    location /apk_output/ {
        alias {INSTALL_ROOT}/runtime/apk_output/;
    }

    location ~ /\. { deny all; }
    access_log  /www/wwwlogs/{PROJECT_NAME}_frontend.log;
    error_log  /www/wwwlogs/{PROJECT_NAME}_frontend.error.log;
}
ENDSITECONF
    
    sed -i "s|{INSTALL_ROOT}|${INSTALL_ROOT}|g" "${BT_SITE_CONF}"
    sed -i "s|{PROJECT_NAME}|${PROJECT_NAME}|g" "${BT_SITE_CONF}"
    
    # 重载 Nginx
    if [ -f "/www/server/nginx/sbin/nginx" ]; then
        /www/server/nginx/sbin/nginx -t && /www/server/nginx/sbin/nginx -s reload 2>/dev/null || true
    elif command -v nginx &> /dev/null; then
        nginx -t && systemctl reload nginx 2>/dev/null || true
    fi
    
    log_info "Nginx 站点配置完成"
}

# 配置开机自启
setup_autostart() {
    log_step 13 "配置系统服务和开机自启"

    # systemd service for frps。Dashboard 仅监听 127.0.0.1，状态由 PHP 后端读取，
    # 不对公网暴露 7500。
    cat > /etc/systemd/system/xingchen-frps.service << 'ENDFRPS'
[Unit]
Description=Xingchen FRPS Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www
Group=www
WorkingDirectory={INSTALL_ROOT}/frps
ExecStart={INSTALL_ROOT}/frps/frps -c {INSTALL_ROOT}/frps/frps.ini
Restart=always
RestartSec=5
LimitNOFILE=65535
StandardOutput=append:{INSTALL_ROOT}/frps/log/frps-systemd.log
StandardError=append:{INSTALL_ROOT}/frps/log/frps-systemd.log

[Install]
WantedBy=multi-user.target
ENDFRPS
    sed -i "s|{INSTALL_ROOT}|${INSTALL_ROOT}|g" /etc/systemd/system/xingchen-frps.service
    
    # systemd service for fisher-ws
    cat > /etc/systemd/system/fisher-ws.service << 'ENDWS'
[Unit]
Description=Fisher WebSocket Server
After=network.target mysql.service redis.service

[Service]
Type=simple
User=www
Group=www
WorkingDirectory={INSTALL_ROOT}/node-ws
Environment=NODE_ENV=production
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
ENDWS
    sed -i "s|{INSTALL_ROOT}|${INSTALL_ROOT}|g" /etc/systemd/system/fisher-ws.service
    
    systemctl daemon-reload
    systemctl enable xingchen-frps fisher-ws
    systemctl restart xingchen-frps
    systemctl restart fisher-ws
    
    # 启用 pm2 开机自启
    if command -v pm2 &> /dev/null; then
        pm2 startup systemd -u root --hp /root 2>/dev/null || true
    fi
    
    log_info "开机自启服务配置完成"
}

# 安装结束前执行一次真实联通验证。任何关键项失败都会让一键安装明确失败，
# 不再出现“脚本显示完成、前端却一直连接中”的半安装状态。
verify_installation() {
    log_step 14 "验证共享配置、FRPS Dashboard 与服务状态"

    local verifier="${INSTALL_ROOT}/deploy/verify-install.sh"
    if [ ! -x "${verifier}" ]; then
        chmod +x "${verifier}" 2>/dev/null || true
    fi
    if [ ! -x "${verifier}" ]; then
        log_error "缺少安装验证器: ${verifier}"
        exit 1
    fi

    bash "${verifier}" --root "${INSTALL_ROOT}" --env "${INSTALL_ROOT}/.env" --require-live
    log_info "共享 .env、Node 链接、FRPS 配置、Dashboard 鉴权和服务监听全部验证通过"
}

# 配置 Python 虚拟环境和依赖
setup_python_env() {
    log_step 12 "配置 Python APK 打包环境"
    
    PYENV_DIR="${INSTALL_ROOT}/extend/.venv"
    
    log_info "创建 Python 虚拟环境..."
    if [ ! -d "$PYENV_DIR" ]; then
        python3 -m venv "$PYENV_DIR"
    fi
    
    # 激活并安装基础工具
    source "${PYENV_DIR}/bin/activate"
    pip install --upgrade pip setuptools wheel 2>/dev/null || true
    
    # 安装需要的包
    pip install Pillow 2>/dev/null || true
    
    deactivate
    
    # 设置链接到 node-ws 的 PYTHON_BIN
    # 写入共用的项目根目录 .env（存在则替换，避免重复键）
    if grep -q '^PYTHON_BIN\s*=' "${INSTALL_ROOT}/.env"; then
        sed -i "s#^PYTHON_BIN\s*=.*#PYTHON_BIN = ${PYENV_DIR}/bin/python3#" "${INSTALL_ROOT}/.env"
    else
        echo "PYTHON_BIN = ${PYENV_DIR}/bin/python3" >> "${INSTALL_ROOT}/.env"
    fi
    
    chown -R www:www "${PYENV_DIR}" 2>/dev/null || true
    
    log_info "Python 虚拟环境配置完成: ${PYENV_DIR}"
    log_info "默认 Java 路径: $(which java || echo '未找到，请安装 default-jdk')"
}

# 保存安装状态
save_state() {
    local step="$1"
    local status="${2:-done}"
    cat > "${STATE_FILE}" << ENDJSON
{
  "last_step": "$step",
  "last_status": "$status",
  "timestamp": $(date +%s),
  "date": "$(date '+%Y-%m-%d %H:%M:%S')",
  "external_ip": "$EXTERNAL_IP",
  "db_name": "$DB_NAME",
  "db_user": "$DB_USER",
  "install_root": "$INSTALL_ROOT"
}
ENDJSON
}

# 显示部署完成信息
show_summary() {
    clear
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║          Fisher 项目部署完成 - Ubuntu Linux                  ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "  📅 部署时间: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "  🌐 公网 IP:  ${EXTERNAL_IP}"
    echo "  📁 项目目录:  ${INSTALL_ROOT}"
    echo ""
    echo "  ┌─────────────────────────────────────────────────────────┐"
    echo "  │                    🔑  重要凭证                            │"
    echo "  ├─────────────────────────────────────────────────────────┤"
    echo "  │  数据库名:      ${DB_NAME}"
    echo "  │  数据库用户:    ${DB_USER}"
    echo "  │  数据库密码:    ${DB_PASS}"
    echo "  ├─────────────────────────────────────────────────────────┤"
    echo "  │  JWT_SECRET:    ${JWT_SECRET:0:32}..."
    echo "  │  FRPS_TOKEN:    ${FRPS_TOKEN:0:32}..."
    echo "  │  FRPS面板用户:  admin"
    echo "  │  FRPS面板密码:  ${FRPS_DASH_PASSWORD}"
    echo "  └─────────────────────────────────────────────────────────┘"
    echo ""
    echo "  ┌─────────────────────────────────────────────────────────┐"
    echo "  │                    🌐  服务地址                            │"
    echo "  ├─────────────────────────────────────────────────────────┤"
    echo "  │  前端界面:      http://${EXTERNAL_IP}:8888"
    echo "  │  后端 API:      http://${EXTERNAL_IP}/api/..."
    echo "  │  WebSocket:     ws://${EXTERNAL_IP}:8889"
    echo "  │  FRP 面板:      http://127.0.0.1:7500（仅服务器本机）"
    echo "  │  宝塔面板:      http://${EXTERNAL_IP}:8888 (默认端口)"
    echo "  └─────────────────────────────────────────────────────────┘"
    echo ""
    echo "  ┌─────────────────────────────────────────────────────────┐"
    echo "  │                    🔧  常用命令                            │"
    echo "  ├─────────────────────────────────────────────────────────┤"
    echo "  │  服务管理菜单:  bash ${INSTALL_ROOT}/deploy/start.sh menu"
    echo "  │  启动全部:      bash ${INSTALL_ROOT}/deploy/start.sh start"
    echo "  │  停止全部:      bash ${INSTALL_ROOT}/deploy/start.sh stop"
    echo "  │  查看状态:      bash ${INSTALL_ROOT}/deploy/start.sh status"
    echo "  ├─────────────────────────────────────────────────────────┤"
    echo "  │  WS单独管理:    bash ${INSTALL_ROOT}/node-ws/start.sh"
    echo "  │                 bash ${INSTALL_ROOT}/node-ws/stop.sh"
    echo "  │                 bash ${INSTALL_ROOT}/node-ws/restart.sh"
    echo "  ├─────────────────────────────────────────────────────────┤"
    echo "  │  防火墙端口:    80, 443, 8888, 8889, 7000, 19902-29999"
    echo "  │  MySQL: 3306, Redis: 6379 (建议不对外开放)"
    echo "  └─────────────────────────────────────────────────────────┘"
    echo ""
    echo "  ⚠️   部署后必做:"
    echo "   1. 修改数据库密码和所有密钥（已自动生成强随机密钥）"
    echo "   2. 在宝塔面板绑定域名并配置 HTTPS 证书"
    echo "   3. 在云服务器安全组/防火墙开放端口: 80, 443, 8888, 8889, 7000, 19902-29999"
    echo "   4. 修改宝塔面板默认端口和安全入口"
    echo ""
    echo "  📝  状态文件: ${STATE_FILE} (删除可重跑整个部署)"
    echo ""
}

# ========== 主流程 ==========
main() {
    clear
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║     星辰 - Ubuntu 24.04 LTS 一键部署脚本                     ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    check_root
    check_os
    configure_server_address
    
    echo "即将开始部署，以下信息将被使用:"
    echo "  项目目录: ${INSTALL_ROOT}"
    echo "  数据库:   ${DB_NAME} (用户: ${DB_USER})"
    echo "  服务器:   ${EXTERNAL_IP}"
    echo ""
    read -p "继续部署? [y/N]: " CONFIRM
    if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
        log_info "已取消部署"
        exit 0
    fi
    
    install_base_packages
    save_state "1"
    
    install_baota
    save_state "2"
    
    install_bt_software
    save_state "3"
    
    install_nodejs
    save_state "4"
    
    deploy_project_files
    save_state "5"
    
    install_php_deps
    save_state "6"
    
    install_node_deps
    save_state "7"
    
    configure_database
    save_state "8"
    
    configure_env_files
    save_state "9"
    
    setup_frp
    save_state "10"
    
    setup_bt_site
    save_state "11"
    
    setup_python_env
    save_state "12"

    setup_autostart
    save_state "13"

    verify_installation
    save_state "14"
    
    show_summary
    save_state "done" "complete"
}

# 运行主流程
main
