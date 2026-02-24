#!/usr/bin/env sh
set -e

prometheus_args="--config.file=/etc/prometheus/prometheus.yml"
prometheus_args="$prometheus_args --storage.tsdb.path=/prometheus"
prometheus_args="$prometheus_args --web.console.libraries=/etc/prometheus/console_libraries"
prometheus_args="$prometheus_args --web.console.templates=/etc/prometheus/consoles"
prometheus_args="$prometheus_args --storage.tsdb.retention.time=15d"
prometheus_args="$prometheus_args --web.enable-lifecycle"

prometheus_route_prefix="${PROMETHEUS_WEB_ROUTE_PREFIX:-/prometheus}"
prometheus_args="$prometheus_args --web.route-prefix=${prometheus_route_prefix}"

if [ -n "${PROMETHEUS_WEB_EXTERNAL_URL:-}" ]; then
  prometheus_args="$prometheus_args --web.external-url=${PROMETHEUS_WEB_EXTERNAL_URL}"
fi

exec /bin/prometheus ${prometheus_args} "$@"
