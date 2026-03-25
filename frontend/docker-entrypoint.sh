#!/bin/sh
: "${OIDC_ISSUER_URL:?OIDC_ISSUER_URL is required}"
: "${OIDC_CLIENT_ID:?OIDC_CLIENT_ID is required}"
: "${OIDC_REDIRECT_URI:?OIDC_REDIRECT_URI is required}"

# Safely escape a value for embedding in a JS string literal.
# Strips characters that could break out of the string: \, ", newlines.
_escape_js() {
  printf '%s' "$1" | tr -d '\\\n\r"'
}

VAPID_PUBLIC_KEY_SAFE=$(_escape_js "${VAPID_PUBLIC_KEY:-}")

cat > /usr/share/nginx/html/config.js <<EOF
window.__NESTO_CONFIG__ = {
  OIDC_AUTHORITY: "${OIDC_ISSUER_URL}",
  OIDC_CLIENT_ID: "${OIDC_CLIENT_ID}",
  OIDC_REDIRECT_URI: "${OIDC_REDIRECT_URI}",
  VAPID_PUBLIC_KEY: "${VAPID_PUBLIC_KEY_SAFE}"
};
EOF
exec nginx -g "daemon off;"
