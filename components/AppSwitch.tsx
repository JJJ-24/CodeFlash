import { Switch, type SwitchProps } from 'react-native';

import { useTheme } from '@/lib/theme';

/**
 * アプリ共通のスイッチ。オン＝`primary`／オフ＝`switchTrackOff` を必ず指定する。
 *
 * ⚠️ **素の RN `Switch` を直接使わないこと**。理由は2つ：
 * ① オフ色を指定しないと iOS 既定（ライト ≈ `#E9E9EA`）になり、**白いカードの上でオフが
 *    ほとんど見えない**（ダークは既定でも見える＝ライトだけ破綻する）。
 * ② ネイティブ部品なので、**アプリのテーマではなく iOS のテーマ**に従う
 *    （`Appearance.setColorScheme()` を使わない方針＝CLAUDE.md）。アプリとiOSの明暗が
 *    食い違うと、オフの色だけ反対のテーマで描かれる。色を明示すれば4通りの組み合わせで揃う。
 *
 * iOS はオフのときトラックが枠に縮むため、**`trackColor.false` と `ios_backgroundColor` の
 * 両方**が要る（RN の Switch は前者を `UISwitch.tintColor`、後者を view の背景色に流す）。
 */
export function AppSwitch({ trackColor, ios_backgroundColor, ...rest }: SwitchProps) {
  const theme = useTheme();
  const off = trackColor?.false ?? ios_backgroundColor ?? theme.colors.switchTrackOff;
  return (
    <Switch
      trackColor={{ false: off, true: trackColor?.true ?? theme.colors.primary }}
      ios_backgroundColor={ios_backgroundColor ?? off}
      {...rest}
    />
  );
}
