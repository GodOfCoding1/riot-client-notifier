#!/bin/sh
set -eu
umask 077
staging=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
node_bin=$(command -v node)
cd "$staging/app"
npm test
if ! id riot-notifier >/dev/null 2>&1; then
  sudo useradd --system --home-dir /var/lib/riot-notifier --shell /usr/sbin/nologin riot-notifier
fi
sudo install -d -m 755 -o root -g root /opt/riot-notifier
sudo install -d -m 700 -o riot-notifier -g riot-notifier /var/lib/riot-notifier
sudo install -d -m 750 -o root -g riot-notifier /etc/riot-notifier
sudo systemctl stop riot-notifier.service 2>/dev/null || true
sudo cp -R "$staging/app/." /opt/riot-notifier/
sudo chown -R root:root /opt/riot-notifier
sudo find /opt/riot-notifier -type d -exec chmod 755 {} +
sudo find /opt/riot-notifier -type f -exec chmod 644 {} +
sudo install -m 600 -o riot-notifier -g riot-notifier "$staging/secrets/session.enc" /var/lib/riot-notifier/session.enc
sudo install -m 640 -o root -g riot-notifier "$staging/secrets/session.key" /etc/riot-notifier/session.key
sudo install -m 640 -o root -g riot-notifier "$staging/secrets/notifier.env" /etc/riot-notifier/notifier.env
sudo install -m 600 -o riot-notifier -g riot-notifier "$staging/secrets/config.json" /var/lib/riot-notifier/config.json
if [ -f "$staging/secrets/state.json" ]; then
  sudo install -m 600 -o riot-notifier -g riot-notifier "$staging/secrets/state.json" /var/lib/riot-notifier/state.json
fi
sudo -u riot-notifier "$node_bin" --env-file=/etc/riot-notifier/notifier.env /opt/riot-notifier/deploy/check-auth.cjs
sudo -u riot-notifier "$node_bin" --env-file=/etc/riot-notifier/notifier.env /opt/riot-notifier/notify/dispatch.cjs
sed "s|ExecStart=/usr/bin/node |ExecStart=$node_bin |" /opt/riot-notifier/deploy/riot-notifier.service > "$staging/riot-notifier.service"
sudo install -m 644 "$staging/riot-notifier.service" /etc/systemd/system/riot-notifier.service
sudo systemctl daemon-reload
sudo systemctl enable --now riot-notifier.service
sudo systemctl is-active riot-notifier.service
sudo systemctl is-enabled riot-notifier.service
if [ -f /opt/riot-notifier/health-guard.cjs ]; then
  sed "s|ExecStart=/usr/local/bin/node |ExecStart=$node_bin |" /opt/riot-notifier/deploy/riot-notifier-health.service > "$staging/riot-notifier-health.service"
  sudo install -m 644 "$staging/riot-notifier-health.service" /etc/systemd/system/riot-notifier-health.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now riot-notifier-health.service
fi
