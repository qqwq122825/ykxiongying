#!/usr/bin/env bash
# 星辰完整一键安装入口。所有实际步骤与校验集中在 deploy/deploy.sh。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${ROOT}/deploy/deploy.sh" "$@"
