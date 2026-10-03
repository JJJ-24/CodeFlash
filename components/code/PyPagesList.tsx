import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PageViewerModal } from '@/components/code/PageViewerModal';
import type { PyPage } from '@/lib/code-execution/pyRequestsShim';
import { COPY_DONE_BG, COPY_DONE_COLOR, MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';
import type { DeckImage } from '@/types';

interface Props {
  /** デッキのページ（`pagesFromDeckStages()` の結果）。空なら呼び出し側で出さない */
  pages: PyPage[];
  /** 一覧の開閉（カード編集の Return＝開閉と共有するため呼び出し側が持つ） */
  expanded: boolean;
  onToggleExpanded: () => void;
  deckImages?: DeckImage[];
  /** タップの直前に呼ぶ（学習画面のカードが裏返らないように `suppress()` を渡す） */
  onInteract?: () => void;
  /** ページを見る画面の開閉（学習画面・カード編集が背後のキーを止めるため＝041 と同じ `InteractivePreviewContext`） */
  onViewerOpenChange?: (open: boolean) => void;
}

/**
 * 059：Python ブロックの「デッキのページ（N）」。`requests.get()` で取得できるページ（URL 名の HTML/CSS 土台）の一覧。
 * **カード編集と学習画面で同じ部品**（学習者もセレクタを書く前に HTML の構造を確かめられるように）。
 *
 * - **行のどこをタップしても**ページを見る画面（`PageViewerModal`）が開く＝行には他のタップの役目が無く、
 *   目のアイコンだけだと学習中に狙うには小さい。右端の目のアイコンは「押せば見られる」を示す**印**。
 *   （デッキ編集の土台一覧だけは行のタップが「編集を開く」なので、そちらは目のボタンで開く）
 * - コピーは別のボタン（コードに書く URL を写すため。行のタップより優先される）。
 * - 既定は閉じる。外枠（上の区切り線）はこの部品が持つ。
 */
export function PyPagesList({ pages, expanded, onToggleExpanded, deckImages, onInteract, onViewerOpenChange }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [showInfo, setShowInfo] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [viewing, setViewing] = useState<PyPage | null>(null);

  async function copy(url: string) {
    onInteract?.();
    await Clipboard.setStringAsync(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl((cur) => (cur === url ? null : cur)), 1000);
  }

  function open(page: PyPage) {
    onInteract?.();
    setViewing(page);
    onViewerOpenChange?.(true);
  }

  function close() {
    setViewing(null);
    onViewerOpenChange?.(false);
  }

  return (
    // 学習画面：**指が触れた瞬間に** suppress() する（onPress では遅い＝カードの裏返りは指を離した瞬間に判定されるので、
    // 見出しのタップで一覧が開いた直後にカードが裏返っていた。ExecutionOutput のプレビュー枠と同じ onTouchStart）
    <View style={[styles.section, { borderTopColor: theme.colors.border }]} onTouchStart={onInteract}>
      <Pressable style={styles.header} onPress={() => { onInteract?.(); onToggleExpanded(); }} hitSlop={6}>
        <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={theme.fontSize.sm} color="#C9C9C9" />
        <Text style={{ color: '#C9C9C9', fontSize: theme.fontSize.sm, fontWeight: '600', flexShrink: 1 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
          {t('editor.pyPagesLabel', { n: pages.length })}
        </Text>
        <Pressable onPress={() => { onInteract?.(); setShowInfo((v) => !v); }} hitSlop={8}>
          <Ionicons
            name={showInfo ? 'information-circle' : 'information-circle-outline'}
            size={Math.max(theme.fontSize.sm, 18)}
            color="#9CA3AF"
          />
        </Pressable>
      </Pressable>
      {showInfo && (
        <View style={styles.infoBox}>
          <Text style={{ color: '#9CA3AF', fontSize: theme.fontSize.xs, lineHeight: 16 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('editor.pyPagesHint')}
          </Text>
        </View>
      )}
      {expanded && pages.map((page, i) => (
        <Pressable key={`${i}:${page.url}`} style={styles.row} onPress={() => open(page)}>
          <Ionicons name="globe-outline" size={theme.fontSize.sm} color="#9CA3AF" />
          <Text style={[styles.url, { fontSize: theme.fontSize.sm }]} numberOfLines={1} ellipsizeMode="middle" maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {page.url}
          </Text>
          <Pressable onPress={() => copy(page.url)} hitSlop={8} style={[styles.iconBtn, copiedUrl === page.url && { backgroundColor: COPY_DONE_BG }]}>
            <Ionicons
              name={copiedUrl === page.url ? 'checkmark-sharp' : 'copy-outline'}
              size={theme.fontSize.sm}
              color={copiedUrl === page.url ? COPY_DONE_COLOR : '#C9C9C9'}
            />
          </Pressable>
          <Ionicons name="eye-outline" size={Math.round(theme.fontSize.md)} color="#C9C9C9" />
        </Pressable>
      ))}
      <PageViewerModal page={viewing} onClose={close} deckImages={deckImages} />
    </View>
  );
}

const styles = StyleSheet.create({
  // コードブロックの他のセクション（初期化SQL・HTML/CSS 土台）と同じ寸法
  section: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10, borderTopWidth: StyleSheet.hairlineWidth },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  infoBox: { backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  url: { flex: 1, color: '#D4D4D4', fontFamily: 'monospace' },
  iconBtn: { paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4 },
});
