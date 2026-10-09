#!/bin/bash
# Instala/remove o Maestro como LaunchAgent do usuario (inicia no login).
#   ./scripts/autostart.sh install | uninstall | status
set -euo pipefail

LABEL="com.anotacoesgab.server"
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_BIN="$(command -v node)"
PORT="${PORT:-4321}"
DOMAIN="gui/$(id -u)"

install_agent() {
  mkdir -p "$HOME/Library/LaunchAgents" "$PROJECT/data/logs"

  cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>--no-warnings</string>
    <string>$PROJECT/src/server.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$PROJECT</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>$PORT</string>
    <key>PATH</key>
    <string>$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin</string>
  </dict>

  <!-- Sobe no login e volta sozinho se cair. -->
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$PROJECT/data/logs/server.log</string>
  <key>StandardErrorPath</key>
  <string>$PROJECT/data/logs/server.error.log</string>

  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
PLIST_EOF

  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"
  launchctl kickstart -k "$DOMAIN/$LABEL" 2>/dev/null || true

  echo "Instalado: $PLIST"
  echo "Node:      $NODE_BIN"
  echo "URL:       http://localhost:$PORT"
  echo "Logs:      $PROJECT/data/logs/"
}

uninstall_agent() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || launchctl unload -w "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removido: $LABEL"
}

status_agent() {
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    launchctl print "$DOMAIN/$LABEL" | grep -E "^\s+(state|pid|last exit code) " || true
    echo "URL: http://localhost:$PORT"
  else
    echo "Nao instalado. Rode: ./scripts/autostart.sh install"
  fi
}

case "${1:-}" in
  install) install_agent ;;
  uninstall) uninstall_agent ;;
  status) status_agent ;;
  *) echo "uso: $0 {install|uninstall|status}"; exit 1 ;;
esac
