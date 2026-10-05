#!/bin/bash
# Локальный запуск сайта и админки. Двойной клик в Finder; закрыть — Ctrl+C или закрыть окно Терминала.
cd "$(dirname "$0")" || exit 1
PORT=8765
URL="http://localhost:$PORT/admin/"

# сайт уже кто-то раздаёт на этом порту (например, Blender) — просто открываем админку
if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/content/site.json"; then
  echo "Сайт уже запущен: http://localhost:$PORT/"
  open "$URL"
  exit 0
fi

echo "Сайт:    http://localhost:$PORT/"
echo "Админка: $URL  (открывайте в Chrome)"
echo "Остановить: Ctrl+C или закройте это окно."
( sleep 1; open "$URL" ) &

# python3 на Mac есть, если установлены инструменты разработчика или Homebrew; иначе берём системный Ruby
if /usr/bin/xcode-select -p >/dev/null 2>&1 || [ -x /opt/homebrew/bin/python3 ] || [ -x /usr/local/bin/python3 ]; then
  exec python3 -m http.server "$PORT" --bind 127.0.0.1
elif [ -x /usr/bin/ruby ]; then
  exec /usr/bin/ruby -run -e httpd . -p "$PORT" -b 127.0.0.1
else
  echo
  echo "Не нашлось ни python3, ни ruby. Установите инструменты разработчика командой: xcode-select --install"
  read -r -p "Нажмите Enter, чтобы закрыть окно."
fi
