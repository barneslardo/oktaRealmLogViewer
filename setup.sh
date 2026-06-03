#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT="$SCRIPT_DIR/zachDemo.txt"
ENV_FILE="$SCRIPT_DIR/backend/.env"

echo "=== Okta Realm Log Viewer — Setup ==="

# ── Parse zachDemo.txt ──────────────────────────────────────────────────────
if [[ ! -f "$INPUT" ]]; then
  echo "ERROR: $INPUT not found. Run the scp command first."
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

echo ""
echo "=== Setup complete ==="
echo "Start the server: cd $SCRIPT_DIR/backend && npm start"
echo "App will be available at http://localhost:4000"
