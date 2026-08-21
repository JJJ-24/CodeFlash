import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/**
 * ⚠️ **`Appearance.setColorScheme()` でネイティブ側の外観を上書きしてはいけない（重要）。**
 *
 * かつては「アプリのテーマ＝ネイティブの外観」に揃えるため、テーマ変更時と起動時に
 * `Appearance.setColorScheme(preference)` を呼んでいた（`3192479`＝カード一覧の戻るボタンの
 * ちらつき対策）。これは RN の実装上 **その時点の全ウィンドウに `overrideUserInterfaceStyle` を
 * 設定する**もので、**アプリのテーマと iOS のテーマが食い違うと、1つの部品の中で
 * 2つの基準が混ざる**という壊れ方をする。
 *
 * 実機で確認した壊れ方（iOS ダーク＋アプリ ライト・iPad ＋ Magic Keyboard）：
 * **キーを長押ししたときのアクセント候補の吹き出しが、背景＝アプリ基準（白）・
 * 文字＝iOS 基準（白）で白×白になり読めない**。文字色は3パターンとも常に iOS 側で
 * 解決される（アプリからは変えられない）ので、**背景も iOS 側に任せるしかない**。
 * `keyboardAppearance` でも同じことが起きるため、こちらも指定しない（検索欄で実証）。
 *
 * ⚠️ ちらつき対策は **`app/_layout.tsx` の `screenOptions.contentStyle` の背景色**が担う
 * （ネイティブの画面コンテナをアプリのテーマ色で塗る＝本来の対処）。override を戻す必要はない。
 * ⚠️ 埋め込みのネイティブ部品でアプリのテーマに揃えたいものは、**その部品の prop で指定する**
 * （通知の時刻ピッカーは `themeVariant`）。ウィンドウ全体を上書きしないこと。
 */

export type ColorSchemePreference = 'light' | 'dark' | 'system';
export type FontSizePreference = 'small' | 'medium' | 'large';

export const FONT_SCALE: Record<FontSizePreference, number> = {
  small: 0.85,
  medium: 1.0,
  large: 1.2,
};

const THEME_KEY = '@codeflash_theme';
const FONT_SIZE_KEY = '@codeflash_font_size';

interface ThemeState {
  preference: ColorSchemePreference;
  fontSizePreference: FontSizePreference;
  hydrated: boolean;
  setPreference: (preference: ColorSchemePreference) => void;
  setFontSizePreference: (fontSizePreference: FontSizePreference) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: 'system',
  fontSizePreference: 'medium',
  hydrated: false,
  setPreference: (preference) => {
    set({ preference });
    AsyncStorage.setItem(THEME_KEY, preference);
  },
  setFontSizePreference: (fontSizePreference) => {
    set({ fontSizePreference });
    AsyncStorage.setItem(FONT_SIZE_KEY, fontSizePreference);
  },
}));

// アプリ起動時に保存済みの設定を復元
export async function hydrateTheme(): Promise<void> {
  const [theme, fontSize] = await Promise.all([
    AsyncStorage.getItem(THEME_KEY),
    AsyncStorage.getItem(FONT_SIZE_KEY),
  ]);
  const preference = (theme === 'light' || theme === 'dark' || theme === 'system') ? theme : 'system';
  const fontSizePreference = (fontSize === 'small' || fontSize === 'medium' || fontSize === 'large') ? fontSize : 'medium';
  useThemeStore.setState({ preference, fontSizePreference, hydrated: true });
}

hydrateTheme();
