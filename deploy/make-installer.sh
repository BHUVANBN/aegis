#!/usr/bin/env bash
# Packs the whole repo into ONE self-extracting file you can move by any approved channel. Usage: deploy/make-installer.sh [output]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-$PWD/../aegis-installer.sh}"; TMP=$(mktemp)
tar --exclude=.git --exclude=node_modules --exclude='*/dist' --exclude=deploy/.state --exclude=deploy/config.env --exclude=.env -czf "$TMP" .
{
cat <<'HDR'
#!/usr/bin/env bash
# AEGIS self-extracting installer. Run:  bash aegis-installer.sh   (optionally AEGIS_DIR=/path)
set -euo pipefail
DEST="${AEGIS_DIR:-$PWD/aegis}"
LINE=$(awk '/^__ARCHIVE__$/ {print NR+1; exit 0;}' "$0")
mkdir -p "$DEST"
tail -n +"$LINE" "$0" | base64 -d | tar -xz -C "$DEST"
echo "Extracted to $DEST"
echo "Next:  cd $DEST/deploy && cp config.env.example config.env && nano config.env && az login && ./run-all.sh"
exit 0
__ARCHIVE__
HDR
base64 -w 76 "$TMP"
} > "$OUT"
chmod +x "$OUT"; rm -f "$TMP"; echo "Created $OUT ($(du -h "$OUT" | cut -f1)); sha256: $(sha256sum "$OUT" | cut -d' ' -f1)"
