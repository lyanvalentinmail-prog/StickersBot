#!/data/data/com.termux/files/usr/bin/bash
# start.sh — reinicia el bot si se cae (ideal para Termux)
cd "$(dirname "$0")" || exit 1

while true; do
  node index.js "$@"
  echo "⚠️  El bot se detuvo. Reiniciando en 5s... (Ctrl+C para salir)"
  sleep 5
done
