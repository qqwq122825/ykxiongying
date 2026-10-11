#!/usr/bin/env bash
set -euo pipefail
cd /Users/xxx/Downloads/熊猫v7/extracted
mkdir -p runtime
cat > /tmp/fisher-local-bind-127.js <<'JS'
'use strict';
const net = require('net');
const origListen = net.Server.prototype.listen;
net.Server.prototype.listen = function(...args) {
  if (typeof args[0] === 'number') {
    const hasHost = typeof args[1] === 'string' || (args[1] && typeof args[1] === 'object' && 'host' in args[1]);
    if (!hasHost) args.splice(1, 0, '127.0.0.1');
  } else if (args[0] && typeof args[0] === 'object' && typeof args[0].port === 'number' && !args[0].host) {
    args[0] = { ...args[0], host: '127.0.0.1' };
  }
  return origListen.apply(this, args);
};
JS
cleanup() {
  kill "$PHP_PID" "$WS_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
php -S 127.0.0.1:8888 -t public public/router.php > runtime/local_php.log 2>&1 &
PHP_PID=$!
(cd node-ws && NODE_OPTIONS="--require=/tmp/fisher-local-bind-127.js" node src/index.js > ../runtime/local_ws.log 2>&1) &
WS_PID=$!
echo "$PHP_PID" > runtime/local_php.pid
echo "$WS_PID" > runtime/local_ws.pid
echo "LOCAL_SERVICES_STARTED php=$PHP_PID ws=$WS_PID"
while kill -0 "$PHP_PID" 2>/dev/null && kill -0 "$WS_PID" 2>/dev/null; do sleep 2; done
echo "LOCAL_SERVICES_EXITED"
