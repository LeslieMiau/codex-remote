#!/bin/sh
set -eu

gateway_pid=""
web_pid=""
gateway_host="${CODEX_REMOTE_GATEWAY_HOST:-127.0.0.1}"
gateway_port="${CODEX_REMOTE_GATEWAY_PORT:-8787}"
health_url="http://${gateway_host}:${gateway_port}/health"
health_retries="${CODEX_REMOTE_GATEWAY_HEALTH_RETRIES:-60}"

wait_for_child() {
  set +e
  wait "$1"
  status=$?
  set -e
  return "$status"
}

cleanup() {
  status=$?
  trap - INT TERM EXIT

  if [ -n "$web_pid" ] && kill -0 "$web_pid" 2>/dev/null; then
    kill "$web_pid" 2>/dev/null || true
    wait "$web_pid" 2>/dev/null || true
  fi

  if [ -n "$gateway_pid" ] && kill -0 "$gateway_pid" 2>/dev/null; then
    kill "$gateway_pid" 2>/dev/null || true
    wait "$gateway_pid" 2>/dev/null || true
  fi

  exit "$status"
}

trap cleanup INT TERM EXIT

echo "Starting gateway..."
./scripts/start-gateway.sh &
gateway_pid=$!

attempt=0
while :; do
  if ! kill -0 "$gateway_pid" 2>/dev/null; then
    if wait_for_child "$gateway_pid"; then
      exit 0
    else
      exit $?
    fi
  fi

  if curl --silent --show-error --fail "$health_url" >/dev/null 2>&1; then
    break
  fi

  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$health_retries" ]; then
    echo "Timed out waiting for gateway health at $health_url" >&2
    exit 1
  fi

  sleep 1
done

echo "Gateway is healthy at $health_url"
echo "Starting mobile web..."
./scripts/start-mobile-web.sh &
web_pid=$!

while :; do
  if ! kill -0 "$gateway_pid" 2>/dev/null; then
    if wait_for_child "$gateway_pid"; then
      exit 0
    else
      exit $?
    fi
  fi

  if ! kill -0 "$web_pid" 2>/dev/null; then
    if wait_for_child "$web_pid"; then
      exit 0
    else
      exit $?
    fi
  fi

  sleep 1
done
