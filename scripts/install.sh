#!/usr/bin/env sh
# Install the latest ferry release on macOS or Linux.
#   curl -fsSL https://raw.githubusercontent.com/anupam42/Ferry/main/scripts/install.sh | sh
# Set INSTALL_DIR to choose where the binary goes (default: /usr/local/bin or ~/.local/bin).
set -eu
REPO="anupam42/Ferry"
os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$(uname -m)" in
  x86_64|amd64) arch=amd64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
tag=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
[ -n "$tag" ] || { echo "could not find latest release" >&2; exit 1; }
ver=${tag#v}
url="https://github.com/$REPO/releases/download/$tag/ferry_${ver}_${os}_${arch}.tar.gz"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
echo "downloading $url"
curl -fsSL "$url" | tar -xz -C "$tmp"
dir=${INSTALL_DIR:-/usr/local/bin}
if [ ! -w "$dir" ]; then dir="$HOME/.local/bin"; mkdir -p "$dir"; fi
install -m 0755 "$tmp/ferry" "$dir/ferry"
echo "installed ferry $ver to $dir"
case ":$PATH:" in *":$dir:"*) ;; *) echo "note: add $dir to your PATH" ;; esac
