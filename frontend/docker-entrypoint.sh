#!/bin/sh
cat > /usr/share/nginx/html/config.js <<EOF
window.__NESTO_CONFIG__ = {
  OIDC_AUTHORITY: "${OIDC_ISSUER_URL}",
  OIDC_CLIENT_ID: "${OIDC_CLIENT_ID}",
  OIDC_REDIRECT_URI: "${OIDC_REDIRECT_URI}"
};
EOF
exec nginx -g "daemon off;"
