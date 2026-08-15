#!/usr/bin/env bash
# Rebuild the sandbox headless-Chromium test rig (browser binary, runtime
# libs, fonts, NSS libs). Used because the sandbox blocks browser CDNs;
# everything here comes from npm (@sparticuz/chromium) and GitHub.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export BROWSER_DIR="${BROWSER_DIR:-$HOME/.browser}"
mkdir -p "$BROWSER_DIR/lib" "$BROWSER_DIR/fonts"

echo "== inflating chromium + runtime libs + fonts from @sparticuz/chromium =="
node -e '
const z=require("zlib"),fs=require("fs"),path=require("path");
const src=path.join(process.env.ROOT,"node_modules/@sparticuz/chromium/bin");
const out=process.env.BROWSER_DIR;
fs.writeFileSync(out+"/chromium", z.brotliDecompressSync(fs.readFileSync(src+"/chromium.br")));
fs.writeFileSync("/tmp/al2023.tar", z.brotliDecompressSync(fs.readFileSync(src+"/al2023.tar.br")));
fs.writeFileSync("/tmp/fonts.tar", z.brotliDecompressSync(fs.readFileSync(src+"/fonts.tar.br")));
'
tar -xf /tmp/al2023.tar -C "$BROWSER_DIR/lib"
tar -xf /tmp/fonts.tar -C "$BROWSER_DIR/fonts"
chmod +x "$BROWSER_DIR/chromium"

echo "== fetching NSS/NSPR libs (Firefox NSS set) from GitHub =="
if ! ls "$BROWSER_DIR/lib/libnss3.so" >/dev/null 2>&1; then
  curl -sL --max-time 180 -o /tmp/foxhound.tar.gz \
    "https://codeload.github.com/jndre/In-the-DOM-We-Trust/tar.gz/refs/heads/main"
  tar -xzf /tmp/foxhound.tar.gz -C /tmp \
    In-the-DOM-We-Trust-main/foxhound/dependentlibs.list \
    In-the-DOM-We-Trust-main/foxhound/libfreeblpriv3.so \
    In-the-DOM-We-Trust-main/foxhound/libnspr4.so \
    In-the-DOM-We-Trust-main/foxhound/libnss3.so \
    In-the-DOM-We-Trust-main/foxhound/libnssckbi.so \
    In-the-DOM-We-Trust-main/foxhound/libnssutil3.so \
    In-the-DOM-We-Trust-main/foxhound/libplc4.so \
    In-the-DOM-We-Trust-main/foxhound/libplds4.so \
    In-the-DOM-We-Trust-main/foxhound/libsmime3.so \
    In-the-DOM-We-Trust-main/foxhound/libsoftokn3.so \
    In-the-DOM-We-Trust-main/foxhound/libssl3.so
  cp /tmp/In-the-DOM-We-Trust-main/foxhound/*.so /tmp/In-the-DOM-We-Trust-main/foxhound/dependentlibs.list "$BROWSER_DIR/lib/"
fi

echo "== fonts.conf =="
cat > "$BROWSER_DIR/fonts.conf" <<EOF
<?xml version="1.0" ?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>$BROWSER_DIR/fonts/fonts</dir>
  <cachedir>/tmp/fc-cache/</cachedir>
</fontconfig>
EOF

echo "== verify deps =="
LD_LIBRARY_PATH="$BROWSER_DIR/lib" ldd "$BROWSER_DIR/chromium" 2>/dev/null | grep -c "not found" || true
LD_LIBRARY_PATH="$BROWSER_DIR/lib" "$BROWSER_DIR/chromium" --version
echo "BROWSER_DIR=$BROWSER_DIR"
