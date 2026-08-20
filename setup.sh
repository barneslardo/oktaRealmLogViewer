#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Credential input file: client id, private key (PEM or JWK), Okta API token.
# Override with: OKTA_CREDENTIALS=/path/to/file ./setup.sh
# NOTE: this file holds secrets — it is gitignored; never commit it.
INPUT="${OKTA_CREDENTIALS:-$SCRIPT_DIR/okta-credentials.txt}"
[[ -f "$INPUT" ]] || [[ ! -f "$SCRIPT_DIR/zachDemo.txt" ]] || INPUT="$SCRIPT_DIR/zachDemo.txt"
ENV_FILE="$SCRIPT_DIR/backend/.env"

echo "=== Okta Realm Log Viewer — Setup ==="

# ── Parse the credentials file ───────────────────────────────────────────────
if [[ ! -f "$INPUT" ]]; then
  echo "ERROR: $INPUT not found. Copy your Okta credentials there first."
  exit 1
fi

echo "Parsing $INPUT …"

# Extract Okta API token (line starting with OKTA_API_TOKEN= or bare token)
API_TOKEN=$(grep -i 'api.token\|SSWS\|token' "$INPUT" | grep -v '#' | head -1 | sed 's/.*[:=]\s*//')

# Extract private key — supports PEM or JWK blocks
if grep -q 'BEGIN RSA PRIVATE KEY\|BEGIN PRIVATE KEY' "$INPUT"; then
  # PEM key — convert to JWK using Node.js
  PEM_KEY=$(awk '/-----BEGIN/,/-----END/' "$INPUT")
  PRIVATE_KEY_JWK=$(node -e "
    import('node:crypto').then(({createPrivateKey}) => {
      const key = createPrivateKey($(printf '%q' "$PEM_KEY"));
      console.log(JSON.stringify(key.export({ format: 'jwk' })));
    });
  " 2>/dev/null || echo "")
elif grep -q '"kty"' "$INPUT"; then
  # Already JWK
  PRIVATE_KEY_JWK=$(grep -o '{.*"kty".*}' "$INPUT" | head -1)
else
  PRIVATE_KEY_JWK=""
fi

CLIENT_ID=$(grep -i 'client.id\|client_id' "$INPUT" | grep -v '#' | head -1 | sed 's/.*[:=]\s*//')

# ── Write .env ───────────────────────────────────────────────────────────────
SESSION_SECRET=$(openssl rand -hex 32)

cat > "$ENV_FILE" <<EOF
OKTA_TENANT=https://demo-vita-oig.oktapreview.com
OKTA_ISSUER=https://demo-vita-oig.oktapreview.com/oauth2/default
OKTA_REALM_ID=guoujfbwujYHeGy2Q1d7
OKTA_CLIENT_ID=${CLIENT_ID}
OKTA_REDIRECT_URI=https://zach.skylarbarnes.com/auth/callback
OKTA_POST_LOGOUT_URI=https://zach.skylarbarnes.com
OKTA_PRIVATE_KEY_JWK=${PRIVATE_KEY_JWK}
OKTA_API_TOKEN=${API_TOKEN}
SESSION_SECRET=${SESSION_SECRET}
PORT=4000
NODE_ENV=production
EOF

chmod 600 "$ENV_FILE"
echo ".env written and locked to owner-only."

# ── Install dependencies ──────────────────────────────────────────────────────
echo "Installing backend dependencies…"
cd "$SCRIPT_DIR/backend" && npm install

echo "Installing frontend dependencies…"
cd "$SCRIPT_DIR/frontend" && npm install

echo "Building React frontend…"
npm run build

# ── Render the systemd unit for this user/path ────────────────────────────────
if [ -f "$SCRIPT_DIR/okta-realm-logs.service" ]; then
  sed -e "s|__RUN_USER__|$(id -un)|g" \
      -e "s|__APP_DIR__|$SCRIPT_DIR|g" \
      "$SCRIPT_DIR/okta-realm-logs.service" > "$SCRIPT_DIR/okta-realm-logs.service.local"
  echo "Rendered okta-realm-logs.service.local for user $(id -un) at $SCRIPT_DIR"
  echo "  Install with: sudo cp $SCRIPT_DIR/okta-realm-logs.service.local /etc/systemd/system/okta-realm-logs.service"
fi

echo ""
echo "=== Setup complete ==="
echo "Start the server: cd $SCRIPT_DIR/backend && npm start"
echo "App will be available at http://localhost:4000"
