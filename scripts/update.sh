#!/usr/bin/env bash
# Pulls the latest master and restarts the systemd service.
# Run from this repo's checkout on the server: bash scripts/update.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "==> Fetching latest changes"
git fetch origin master
git merge --ff-only origin/master

echo "==> Installing dependencies"
npm install

echo "==> Restarting service"
sudo systemctl restart tarkov-bot

echo "==> Done. Current commit:"
git log -1 --oneline
