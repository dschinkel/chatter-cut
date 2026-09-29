#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mSetup failed: %s\033[0m\n' "$*" >&2; exit 1; }
trap 'die "command failed on line $LINENO. Fix the error above, then run ./setup.sh again."' ERR

[[ "$(uname -s)" == "Darwin" ]] || die "This installer currently supports macOS."

say "Local Voice Remover setup"
echo "Video/audio processing stays on this Mac."
echo "Internet is used only to download/install dependencies and the AI model."

if ! command -v xcode-select >/dev/null 2>&1; then
  die "xcode-select is unavailable."
fi
if ! xcode-select -p >/dev/null 2>&1; then
  say "Installing Apple Command Line Tools"
  xcode-select --install || true
  echo "Finish Apple's Command Line Tools installer, then run ./setup.sh again."
  exit 0
fi
ok "Apple Command Line Tools"

if ! command -v brew >/dev/null 2>&1; then
  say "Installing Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -x /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi
command -v brew >/dev/null 2>&1 || die "Homebrew installed but is not available in this shell."
ok "Homebrew $(brew --version | head -1)"

say "Installing/updating system dependencies"
brew install nvm ffmpeg uv || true
brew upgrade ffmpeg uv 2>/dev/null || true

NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
mkdir -p "$NVM_DIR"
if [[ -s "$(brew --prefix nvm)/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "$(brew --prefix nvm)/nvm.sh"
else
  die "nvm was installed but nvm.sh could not be found."
fi

say "Installing tested Node major from .nvmrc"
nvm install
nvm use
ok "Node $(node -v)"

say "Enabling pinned pnpm"
corepack enable
corepack prepare pnpm@10.32.1 --activate
hash -r
ok "pnpm $(pnpm -v)"

say "Installing JavaScript dependencies"
pnpm install

say "Creating repository-local Python/AI environment"
uv python install 3.12
uv sync --python 3.12

say "Verifying Python AI stack"
uv run python -c 'import sys,numpy,torch,demucs; print("Python",sys.version.split()[0]); print("NumPy",numpy.__version__); print("PyTorch",torch.__version__); print("Demucs import OK")'

say "Running complete environment check"
pnpm doctor

cat <<'EOF'

✓ Setup complete.

Start the app with:

  ./start.sh

Your videos and audio are processed locally on this Mac.
EOF
