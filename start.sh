#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -x /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if command -v brew >/dev/null 2>&1 && [[ -s "$(brew --prefix nvm 2>/dev/null)/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "$(brew --prefix nvm)/nvm.sh"
fi

if ! command -v node >/dev/null 2>&1 || ! command -v pnpm >/dev/null 2>&1 || ! command -v uv >/dev/null 2>&1; then
  echo "Environment is incomplete. Running setup first..."
  exec "$PROJECT_DIR/setup.sh"
fi

nvm use >/dev/null
echo "Checking Local Voice Remover environment..."
pnpm doctor
echo
echo "Starting Local Voice Remover..."
exec pnpm dev
