#!/bin/sh
# SimpleInvoice Manager – Home Assistant App entry point (AR-12, AR-15, AR-16).
#
# Maps the app options (/data/options.json) and the MariaDB credentials from the Supervisor
# services API onto the standard environment variables. The application itself only knows
# these variables – there is exactly one configuration path.
set -eu

log() { echo "[simpleinvoice] $*" >&2; }
fail() {
  log "ERROR: $*"
  exit 1
}

OPTIONS=/data/options.json
SUPERVISOR_URL="${SUPERVISOR_URL:-http://supervisor}"

[ -f "$OPTIONS" ] || fail "$OPTIONS not found – is this running as a Home Assistant App?"
[ -n "${SUPERVISOR_TOKEN:-}" ] || fail "SUPERVISOR_TOKEN is not set – is this running as a Home Assistant App?"

option() { jq -r --arg key "$1" '.[$key] // empty' "$OPTIONS"; }

# --- MariaDB (AR-12) --------------------------------------------------------------------------
SERVICE=$(curl -fsS --max-time 10 \
  -H "Authorization: Bearer ${SUPERVISOR_TOKEN}" \
  "${SUPERVISOR_URL}/services/mysql") ||
  fail "The MariaDB app is not available. Install and start the official 'MariaDB' app first."

service() { echo "$SERVICE" | jq -r --arg key "$1" '.data[$key] // empty'; }

DB_HOST=$(service host)
DB_PORT=$(service port)
DB_USER=$(service username)
DB_PASSWORD=$(service password)
if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ]; then
  fail "The Supervisor returned no MariaDB credentials."
fi
DB_PORT=${DB_PORT:-3306}

DB_NAME=$(option database)
DB_NAME=${DB_NAME:-simpleinvoice}
# Never touch the Home Assistant recorder database (the app checks this again).
case "$(echo "$DB_NAME" | tr '[:upper:]' '[:lower:]')" in
  homeassistant | mysql | information_schema | performance_schema | sys)
    fail "Database '$DB_NAME' is reserved. Please choose another name in the app configuration."
    ;;
esac

# --- Session secret: generated once, kept in /data (part of every HA backup) -----------------
SECRET_FILE=/data/session_secret
if [ ! -s "$SECRET_FILE" ]; then
  umask 077
  head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$SECRET_FILE"
  log "Generated a new session secret."
fi

# --- Files (logo, PDFs) under /data (AR-15) --------------------------------------------------
mkdir -p /data/files

# Assign first, export afterwards – so a failing command still stops the script (set -e).
SESSION_SECRET=$(cat "$SECRET_FILE")
INITIAL_ADMIN_PASSWORD=$(option initial_admin_password)
LOG_LEVEL=$(option log_level)
DATA_DIR=/data/files
PORT=8099
SEED_DEMO=false
NODE_ENV=production
# FR-MCP-12: MCP server for AI assistants – off unless switched on; reached via the direct port.
MCP_ENABLED=$(jq -r '.mcp_enabled == true' "$OPTIONS")
PUBLIC_URL=$(option public_url)
export DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME DATA_DIR SESSION_SECRET \
  INITIAL_ADMIN_PASSWORD LOG_LEVEL PORT SEED_DEMO NODE_ENV MCP_ENABLED PUBLIC_URL

log "Starting with database '$DB_NAME' on ${DB_HOST}:${DB_PORT}."
if [ "$MCP_ENABLED" = true ]; then
  log "MCP server for AI assistants is on (POST /mcp on the direct port 8099)."
fi
cd /app
exec node --enable-source-maps apps/backend/dist/server.js
