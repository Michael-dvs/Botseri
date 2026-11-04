#!/bin/sh
set -e

if [ -z "${SETUP_TOKEN:-}" ]; then
  SETUP_TOKEN="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
  export SETUP_TOKEN
  STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"timestamp":"%s","level":"WARN","source":"setup","message":"SETUP_TOKEN generated for first run","context":{"token":"%s"}}\n' "$STAMP" "$SETUP_TOKEN"
fi

# Step 02 menambahkan prisma/ dan perintah migrate; pada Step 01 blok ini dilewati.
if [ -f ./prisma/schema.prisma ]; then
  npx prisma migrate deploy
  node ./prisma/seed.cjs
fi

exec node server.js
