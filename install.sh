#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

node_is_supported() {
    command -v node >/dev/null 2>&1 || return 1
    major=$(node --version | sed 's/^v//' | cut -d. -f1)
    [ "$major" -ge 18 ] 2>/dev/null
}

echo "NFT Public Mint - Linux installer"
if ! node_is_supported; then
    echo "Installing Node.js and npm with the system package manager..."
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update
        sudo apt-get install -y nodejs npm
    elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y nodejs npm
    elif command -v pacman >/dev/null 2>&1; then
        sudo pacman -Sy --needed nodejs npm
    else
        echo "Install Node.js 18+ from https://nodejs.org and rerun this script." >&2
        exit 1
    fi
fi
if ! node_is_supported; then
    echo "The package manager did not provide Node.js 18+. Install a current Node.js LTS release." >&2
    exit 1
fi

echo "Using Node.js $(node --version) and npm $(npm --version)"
npm ci --ignore-scripts
npm run build
if [ ! -e .env ]; then
    cp .env.example .env
    echo "Created .env from .env.example (optional settings only)."
fi
echo "Cài đặt hoàn tất. Đang khởi động chương trình..."
npm start
