#!/bin/bash
export PATH="/Users/kamleshnagware/.nvm/versions/node/v25.8.1/bin:$PATH"
export DATABASE_URL="postgresql://didvc_user:didvc_pass@localhost:5433/didvc"
export PORT=3002
cd /Users/kamleshnagware/did-vc-project
exec npx tsx src/server/index.ts
