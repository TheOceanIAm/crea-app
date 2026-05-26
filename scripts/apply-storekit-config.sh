#!/usr/bin/env bash
# Links local StoreKit test products for the iOS Simulator (works before ASC approval).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS="$ROOT/ios"
SCHEME="$IOS/CREA.xcodeproj/xcshareddata/xcschemes/CREA.xcscheme"
SRC="$ROOT/storekit/CreaSubscriptions.storekit"
DEST="$IOS/CreaSubscriptions.storekit"

if [[ ! -d "$IOS" ]]; then
  echo "Missing ios/ folder. Run: npx expo prebuild --platform ios (or npx expo run:ios once)."
  exit 1
fi

cp "$SRC" "$DEST"
echo "Copied StoreKit config to $DEST"

CREA_ROOT="$ROOT" python3 - <<PY
from pathlib import Path
import os
import xml.etree.ElementTree as ET

root = Path(os.environ["CREA_ROOT"])
scheme_path = root / "ios/CREA.xcodeproj/xcshareddata/xcschemes/CREA.xcscheme"
tree = ET.parse(scheme_path)
doc = tree.getroot()
launch = doc.find("LaunchAction")
if launch is None:
    raise SystemExit("LaunchAction not found in scheme")

for child in list(launch):
    if child.tag == "StoreKitConfigurationFileReference":
        launch.remove(child)

ref = ET.Element("StoreKitConfigurationFileReference")
# Resolved relative to CREA.xcodeproj (not the scheme file): ../ = ios/
ref.set("identifier", "../CreaSubscriptions.storekit")
launch.append(ref)
tree.write(scheme_path, encoding="UTF-8", xml_declaration=True)
print("Updated Xcode scheme StoreKit configuration")
PY

echo "Done. StoreKit simulator workflow:"
echo "  1) npm run dev          (Metro, keep running)"
echo "  2) npm run ios:xcode    (open Xcode)"
echo "  3) Press Run (⌘R) in Xcode — StoreKit does NOT work via expo run:ios alone."
