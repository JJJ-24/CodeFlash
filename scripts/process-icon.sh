#!/bin/bash
# Icon Composer の書き出し PNG（assets/images/icon-light.png）に
# 単色背景を合成して icon-light-flat.png を生成するスクリプト。
#
# 目的：iOS のスケールアニメーション中に発生する「白チラつき」を防ぐ。
# Icon Composer 出力は角丸の外側が透明なので、フル背景の正方形に変換する必要がある。
#
# 使い方:
#   1. Icon Composer で書き出した icon-light.png を assets/images/ に保存
#   2. npm run process-icon
#   3. npx expo prebuild --clean && npx expo run:ios --device
#
# 必要: ImageMagick (brew install imagemagick)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ICON_DIR="$SCRIPT_DIR/../assets/images"
SRC="$ICON_DIR/icon-light.png"
DST="$ICON_DIR/icon-light-flat.png"
TINTED="$ICON_DIR/icon-tinted.png"

# 背景色（アイコンの背景青に合わせる）
BG_COLOR='#3B86F7'

if ! command -v magick >/dev/null 2>&1; then
  echo "Error: ImageMagick (magick) not found. Install with: brew install imagemagick"
  exit 1
fi

if [ ! -f "$SRC" ]; then
  echo "Error: $SRC not found"
  echo "Icon Composer で書き出した icon-light.png を assets/images/ に置いてください"
  exit 1
fi

magick -size 1024x1024 xc:"$BG_COLOR" "$SRC" -gravity center -composite -alpha off "$DST"

# 検証
W=$(sips -g pixelWidth "$DST" | awk '/pixelWidth:/ {print $2}')
H=$(sips -g pixelHeight "$DST" | awk '/pixelHeight:/ {print $2}')
ALPHA=$(sips -g hasAlpha "$DST" | awk '/hasAlpha:/ {print $2}')

echo "✓ Generated $DST"
echo "  size:     ${W}x${H}"
echo "  hasAlpha: $ALPHA (期待値: no)"

if [ "$ALPHA" != "no" ] || [ "$W" != "1024" ] || [ "$H" != "1024" ]; then
  echo "⚠ 期待した形式ではありません。手動で確認してください"
  exit 1
fi

# iOS 18+ Tinted (着色) / Clear (クリア) モード用アイコンを生成
# Apple 仕様：前景（ロゴ）だけ・透明背景のグレースケール画像を渡す。
# iOS 側がフロストガラス調のタイル背景を裏に描画して合成する。
#
# このスクリプトでは icon-light.png の青背景を色キーで透明化し、
# 残ったロゴ部分をグレースケール化して書き出す。
# Icon Composer でレイヤー分離していない場合の妥協案。
#
# FUZZ ... 青背景の許容範囲（% で 0〜100、大きいほど広く抜く）
# BG_KEY ... 抜きたい背景色（icon-light の青と合わせる）
FUZZ=25
BG_KEY='#3B86F7'

magick "$SRC" \
  -alpha set \
  -fuzz ${FUZZ}% -transparent "$BG_KEY" \
  -colorspace Gray \
  -colorspace sRGB -type TrueColorAlpha -depth 8 \
  -define png:color-type=6 \
  "$TINTED"

TW=$(sips -g pixelWidth "$TINTED" | awk '/pixelWidth:/ {print $2}')
TH=$(sips -g pixelHeight "$TINTED" | awk '/pixelHeight:/ {print $2}')
TA=$(sips -g hasAlpha "$TINTED" | awk '/hasAlpha:/ {print $2}')

echo "✓ Generated $TINTED"
echo "  size:     ${TW}x${TH}"
echo "  hasAlpha: $TA (期待値: yes)"

if [ "$TA" != "yes" ] || [ "$TW" != "1024" ] || [ "$TH" != "1024" ]; then
  echo "⚠ tinted の期待した形式ではありません。手動で確認してください"
  exit 1
fi
