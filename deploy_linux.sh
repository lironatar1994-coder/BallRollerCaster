#!/usr/bin/env bash

set -euo pipefail

# Ball Coaster lives at lawebs.co.il/ball-coaster. It is plain static files (no build):
# the page, the game modules and the vendored three.js. Only those are published —
# deploy scripts, tools and the local dev server stay out of the web root.
APP_ROOT="$(pwd)"
WEB_ROOT="/var/www/ball-coaster"
SITE_HOST="lawebs.co.il"
SITE_URL="https://$SITE_HOST/ball-coaster"
SITE_CONF="/etc/nginx/sites-available/lawebs.co.il.conf"
SITE_SNIPPET="/etc/nginx/snippets/ball-coaster-lawebs.conf"
# the ServerMonitor bridge key lives only on the server, as for Seder and PDF Studio
VISITOR_SIGNAL_KEY_FILE="${VISITOR_SIGNAL_KEY_FILE:-/root/.visitor-signal-key}"
# the deployed commit (from deploy.ps1), written to release.txt so the live version can be verified
RELEASE="${1:-unknown}"
PUBLISHED=(index.html style.css sitemap.xml src vendor)
timestamp="$(date +%Y%m%d-%H%M%S)"
stage="/var/www/ball-coaster.next-$timestamp"
previous="/var/www/ball-coaster.previous-$timestamp"
backup_dir="/tmp/ball-coaster-nginx-$timestamp"
deployment_backup="/root/deployment-backups/ball-coaster-$timestamp.tar.gz"
web_swapped=0
config_changed=0
committed=0

# back up every nginx file we touch; a file that did not exist is marked so a restore removes it
backup_file() {
  local file="$1" name
  name="$(echo "$file" | tr '/' '_')"
  if [ -f "$file" ]; then cp -a "$file" "$backup_dir/$name"; else touch "$backup_dir/$name.absent"; fi
}
restore_file() {
  local file="$1" name
  name="$(echo "$file" | tr '/' '_')"
  if [ -f "$backup_dir/$name" ]; then cp -a "$backup_dir/$name" "$file"; fi
  if [ -f "$backup_dir/$name.absent" ]; then rm -f -- "$file"; fi
}

rollback() {
  local status="$1"
  set +e
  if [ "$committed" -ne 1 ]; then
    echo "[ERROR] Ball Coaster deployment failed; restoring the previous release." >&2
    if [ "$config_changed" -eq 1 ]; then
      restore_file "$SITE_CONF"
      restore_file "$SITE_SNIPPET"
    fi
    if [ "$web_swapped" -eq 1 ]; then
      rm -rf -- "$WEB_ROOT"
      if [ -d "$previous" ]; then mv "$previous" "$WEB_ROOT"; fi
    fi
    nginx -t && systemctl reload nginx
  fi
  rm -rf -- "$stage" "$backup_dir"
  exit "$status"
}
trap 'rollback $?' ERR

if [ "$(id -u)" -ne 0 ]; then
  echo "[ERROR] Run deploy_linux.sh as root." >&2
  exit 1
fi
for f in "${PUBLISHED[@]}"; do
  if [ ! -e "$APP_ROOT/$f" ]; then
    echo "[ERROR] Run this script from the Ball Coaster source root ($f is missing)." >&2
    exit 1
  fi
done
# checked before anything changes: without a valid key the visitor bridge cannot work
SIGNAL_KEY="$(tr -d '\r\n' < "$VISITOR_SIGNAL_KEY_FILE" 2>/dev/null || true)"
if ! printf '%s' "$SIGNAL_KEY" | grep -Eq '^[[:xdigit:]]{64}$'; then
  echo "[ERROR] $VISITOR_SIGNAL_KEY_FILE must contain one 64-character hexadecimal key." >&2
  exit 1
fi

echo "[INFO] Staging release $RELEASE..."
install -d -m 755 /var/www /root/deployment-backups "$backup_dir"
rm -rf -- "$stage"
install -d -m 755 "$stage"
cp -a "${PUBLISHED[@]}" "$stage/"
printf '%s\n' "$RELEASE" > "$stage/release.txt"
chown -R www-data:www-data "$stage"
find "$stage" -type d -exec chmod 755 {} +
find "$stage" -type f -exec chmod 644 {} +

if [ -d "$WEB_ROOT" ]; then
  tar -C /var/www -czf "$deployment_backup" ball-coaster
  mv "$WEB_ROOT" "$previous"
fi
mv "$stage" "$WEB_ROOT"
web_swapped=1

backup_file "$SITE_CONF"
backup_file "$SITE_SNIPPET"
config_changed=1

cat > "$SITE_SNIPPET" <<'NGINX'
location = /ball-coaster {
    return 301 /ball-coaster/;
}

location = /ball-coaster/.well-known/vee-visitor-signal {
    limit_except POST { deny all; }
    client_max_body_size 16k;
    proxy_pass http://127.0.0.1:4010/serve-monitor/api/browser-signals/site;
    proxy_http_version 1.1;
    proxy_set_header Content-Type application/json;
    proxy_set_header X-Visitor-Signal-Key "__VISITOR_SIGNAL_KEY__";
    proxy_set_header X-Visitor-Site-Url "https://lawebs.co.il/ball-coaster/";
    proxy_set_header X-Visitor-IP $remote_addr;
    proxy_set_header X-Visitor-User-Agent $http_user_agent;
}

# ^~ so no regex location of the other sites on this domain can catch our files.
# `expires` (not add_header) keeps the domain's security headers on every response.
location ^~ /ball-coaster/ {
    root /var/www;
    index index.html;
    # the page and the game modules change with each release: always revalidate
    expires -1;
    try_files $uri $uri/ =404;

    # three.js only changes when we upgrade it
    location ^~ /ball-coaster/vendor/ {
        expires 30d;
        try_files $uri =404;
    }
}
NGINX
sed -i "s/__VISITOR_SIGNAL_KEY__/$SIGNAL_KEY/" "$SITE_SNIPPET"
chmod 644 "$SITE_SNIPPET"

python3 - "$SITE_CONF" "$SITE_SNIPPET" <<'PY'
from pathlib import Path
import sys

config = Path(sys.argv[1])
snippet = sys.argv[2]
text = config.read_text()
include_line = f'    include {snippet};'
if include_line not in text:
    # inside the lawebs.co.il 443 block, before the portfolio's catch-all, next to PDF Studio
    marker = '    include /etc/nginx/snippets/video-library.conf;'
    if marker not in text:
        raise SystemExit('Could not find the lawebs insertion point')
    text = text.replace(marker, f'{include_line}\n\n{marker}', 1)
config.write_text(text)
PY

nginx -t
systemctl reload nginx
sleep 1

check() { curl --noproxy '*' -k --resolve "$SITE_HOST:443:127.0.0.1" "$@"; }
header() { check -IsS "$1" | awk -F': *' -v h="$2" 'tolower($1)==h {print tolower($2)}' | tr -d '\r'; }

page="$(check -fsS "$SITE_URL/")"
if ! grep -q '<title>Ball Coaster</title>' <<<"$page"; then
  echo "[ERROR] $SITE_URL/ does not serve the game page." >&2
  exit 1
fi
live_release="$(check -fsS "$SITE_URL/release.txt" | tr -d '\r\n')"
if [ "$live_release" != "$RELEASE" ]; then
  echo "[ERROR] release.txt says '$live_release', expected $RELEASE." >&2
  exit 1
fi
# module scripts are refused by browsers unless they come as JavaScript
for asset in src/main.js vendor/three.module.js vendor/addons/OrbitControls.js vendor/addons/postprocessing/UnrealBloomPass.js; do
  type="$(header "$SITE_URL/$asset" content-type)"
  case "$type" in application/javascript*|text/javascript*) ;; *) echo "[ERROR] $asset is served as '$type'." >&2; exit 1 ;; esac
done
if ! check -IsS "$SITE_URL/vendor/three.module.js" | grep -qi '^cache-control:.*max-age=2592000'; then
  echo "[ERROR] three.js is not served with its long cache header." >&2
  exit 1
fi
if ! check -IsS "$SITE_URL/" | grep -qi '^strict-transport-security:'; then
  echo "[ERROR] The page lost the domain's security headers." >&2
  exit 1
fi
bare_location="$(check -sS -o /dev/null -w '%{redirect_url}' "https://$SITE_HOST/ball-coaster")"
if [ "$bare_location" != "$SITE_URL/" ]; then
  echo "[ERROR] /ball-coaster redirects to '$bare_location' instead of $SITE_URL/." >&2
  exit 1
fi
# nothing outside the published files is reachable
for hidden in deploy.ps1 deploy_linux.sh serve.cjs tools/check.mjs package.json; do
  status="$(check -sS -o /dev/null -w '%{http_code}' "$SITE_URL/$hidden")"
  if [ "$status" != "404" ]; then
    echo "[ERROR] $hidden answered HTTP $status; it must not be published." >&2
    exit 1
  fi
done
# the rest of lawebs keeps working
check -fsS "https://$SITE_HOST/" > /dev/null

# Google reads robots.txt only from the domain root. Like PDF Studio: keep the portfolio's
# crawl rules and only add one Sitemap line. Not fatal — the game works without it.
publish_sitemap() {
  local site_link='/opt/lawebs-portfolio/www/current' entry="Sitemap: $SITE_URL/sitemap.xml" site_root target temporary
  if [ ! -d "$site_link" ]; then
    echo "[WARN] No shared portfolio root; submit $SITE_URL/sitemap.xml in Search Console." >&2
    return 0
  fi
  site_root="$(readlink -f -- "$site_link")"
  case "$site_root" in /opt/lawebs-portfolio/*) ;; *) echo "[WARN] Unexpected portfolio root $site_root; robots.txt untouched." >&2; return 0 ;; esac
  target="$site_root/robots.txt"
  if [ ! -f "$target" ] || [ -L "$target" ]; then
    echo "[WARN] $target missing; submit $SITE_URL/sitemap.xml in Search Console." >&2
    return 0
  fi
  if grep -Fxq "$entry" "$target"; then return 0; fi
  install -d -m 700 /root/deployment-backups/ball-coaster-seo
  cp -p -- "$target" "/root/deployment-backups/ball-coaster-seo/robots-$timestamp.txt"
  temporary="$(mktemp "$site_root/.robots.ball-coaster.XXXXXX")"
  cat -- "$target" > "$temporary"
  # blank line first, in case the file does not end with a newline
  printf '\n%s\n' "$entry" >> "$temporary"
  chmod --reference="$target" "$temporary"
  chown --reference="$target" "$temporary"
  mv -f -- "$temporary" "$target"
  echo "[INFO] Added the Ball Coaster sitemap to the root robots.txt."
}
publish_sitemap || echo "[WARN] Could not update the root robots.txt." >&2

committed=1
rm -rf -- "$previous" "$backup_dir"
trap - ERR
echo "[SUCCESS] Ball Coaster deployed at $SITE_URL/"
