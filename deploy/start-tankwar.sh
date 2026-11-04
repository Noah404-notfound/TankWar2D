#!/bin/sh
set -eu

: "${PORT:=10000}"
case "$PORT" in
  *[!0-9]*|'') echo "PORT must be a number" >&2; exit 1 ;;
esac

envsubst '${PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf
nginx -t

# This port is private to the container. nginx is the only public listener.
if [ -n "${MONGO_URI:-}" ]; then
  tankwar-server --port 8080 --mongo-uri "$MONGO_URI" &
else
  tankwar-server --port 8080 &
fi
game_pid=$!

shutdown() {
  kill -TERM "$game_pid" 2>/dev/null || true
  wait "$game_pid" 2>/dev/null || true
  exit 0
}
trap shutdown INT TERM

nginx -g 'daemon off;' &
nginx_pid=$!

while kill -0 "$game_pid" 2>/dev/null && kill -0 "$nginx_pid" 2>/dev/null; do
  sleep 1
done

kill -TERM "$game_pid" "$nginx_pid" 2>/dev/null || true
wait "$game_pid" 2>/dev/null || true
wait "$nginx_pid" 2>/dev/null || true
exit 1
