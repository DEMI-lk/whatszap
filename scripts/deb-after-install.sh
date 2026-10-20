#!/bin/sh
# Runs as root after `dpkg -i`. Chromium refuses to start when its SUID sandbox
# helper is not root-owned with mode 4755 (Ubuntu 24+ also blocks the
# unprivileged user-namespace fallback via AppArmor). Fix the mode so .deb
# installs keep full renderer sandboxing.
set -e
SANDBOX=/opt/WhatsZAP/chrome-sandbox
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX" || true
  chmod 4755 "$SANDBOX" || true
fi
exit 0
