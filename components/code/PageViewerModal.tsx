import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as KeyCommand from 'react-native-key-command';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { SyntaxHighlightedCode } from '@/components/study/SyntaxHighlightedCode';
import { isJsonPage } from '@/lib/code-execution/pyRequestsShim';
import { buildStaticPreviewHtml } from '@/lib/code-execution/sandbox';
import { hasImageRefs, resolveHtmlImageRefs } from '@/lib/htmlImages';
import { COPY_DONE_BG, COPY_DONE_COLOR, MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { useDuoHeaderRowHeight, useHeaderSides, useHorizontalInsets, useWindowControlsTopInset } from '@/lib/useLockedTopInset';
import type { DeckImage } from '@/types';

const KEY_ESCAPE = (KeyCommand.constants?.keyInputEscape as string) ?? '';
/** リンク・画像の長押しで出る iOS のメニュー（開く・コピー・共有）を出さない（プレビューにだけ足す＝ソースには入らない） */
const NO_CALLOUT_STYLE = '<style>a, img { -webkit-touch-callout: none; }</style>';

interface Props {
  /** 表示するページ（null＝閉じている）。`url` は土台の名前・`content` は土台の中身 */
  page: { url: string; content: string } | null;
  onClose: () => void;
  /** デッキの HTML 画像ライブラリ（043）。ページの `img://name` を data URI へ解決するのに使う */
  deckImages?: DeckImage[];
}

/**
 * 059 Phase 3：Python の `requests.get()` で取得できる「ページ」（URL 名の HTML/CSS 土台）を見る全画面モーダル。
 * ミニブラウザの役：上部に URL（アドレスバー）、[プレビュー｜ソース] の切替。
 *
 * - **プレビュー**＝ページを描画（スクロールできる）。⚠️ **ページ遷移は止める**＝リンクをタップすると、相対 URL は
 *   about:blank で解決できず何も起きないが、絶対 URL は本物のサイトへ飛んでしまう。ここは「見るだけ」の画面。
 * - **ソース**＝中身を**そのまま**（`requests` の `res.text` と同じ文字列）色付けして出す。整形しない
 *   ＝学習者がセレクタを考えるときに見る HTML が `res.text` とずれないように（040 の `formatBodyHtml()` とは目的が違う）。
 * - **中身が JSON のページ**はソースだけ（整形して出す）。API の練習用ページを描画しても意味がない。
 *
 * RN `Modal` の `presentationStyle="fullScreen"`＝別 VC なので、カードのスクロール・フリップとジェスチャーが競合しない
 * （041 の `InteractivePreviewModal` と同じ）。⚠️ 別の RN `Modal` の上から開くときは、その Modal の children の中に置く
 * （兄弟にすると2枚目の提示が黙って失敗する＝CLAUDE.md「RN Modal を2枚重ねるときは入れ子」）。
 */
export function PageViewerModal({ page, onClose, deckImages }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  // iPad のウィンドウ表示では ✕ が赤黄青のウィンドウ操作ボタンに重ならないよう下げる
  const topInset = useWindowControlsTopInset();
  // 別 VC の全画面なので根元の余白（app/_layout.tsx の contentStyle）が効かない＝左右の safe area は自分で避ける
  const horizontalInsets = useHorizontalInsets();
  // ヘッダーの左右の余白（普段は 12＝styles.header と同じ。iPhone Duo は左の角と右の時刻・Wi-Fi を空ける）
  const headerSides = useHeaderSides(12);
  const headerRowHeight = useDuoHeaderRowHeight();
  const visible = page !== null;
  // 閉じるアニメーションの間も中身を出し続ける（null にすると閉じかけで空になる）
  const [shown, setShown] = useState(page);
  useEffect(() => { if (page) setShown(page); }, [page]);
  const content = shown?.content ?? '';
  const isJson = useMemo(() => isJsonPage(content), [content]);
  const [tab, setTab] = useState<'preview' | 'source'>('preview');
  const [copied, setCopied] = useState(false);

  // 開くたびにプレビューから（最後に選んだ側は覚えない）
  useEffect(() => { if (visible) setTab('preview'); }, [visible]);
  const activeTab = isJson ? 'source' : tab;

  const sourceText = useMemo(() => {
    if (!isJson) return content;
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }, [content, isJson]);

  // 043：`img://name` があれば data URI へ解決してから WebView に渡す。解決待ちの間は WebView を出さない
  // （041 と同じ。未解決の HTML を一瞬描画して差し替えるとページのスクリプトが2回走る）。
  const baseHtml = useMemo(() => (isJson ? '' : buildStaticPreviewHtml([NO_CALLOUT_STYLE, content])), [content, isJson]);
  const needsImages = hasImageRefs(baseHtml);
  const [resolvedHtml, setResolvedHtml] = useState<string | null>(null);
  useEffect(() => {
    if (!needsImages) {
      setResolvedHtml(null);
      return;
    }
    let cancelled = false;
    void resolveHtmlImageRefs(baseHtml, deckImages ?? []).then((resolved) => {
      if (!cancelled) setResolvedHtml(resolved);
    });
    return () => { cancelled = true; };
  }, [baseHtml, needsImages, deckImages]);
  const html = needsImages ? resolvedHtml : baseHtml;

  // 最初の読み込み（about:blank）と、ページ内のアンカー（about:blank#x＝スクロールだけ）以外は止める
  const onShouldStartLoadWithRequest = useCallback(
    (req: WebViewNavigation) => req.url === 'about:blank' || req.url.startsWith('about:blank#') || req.url.startsWith('about:srcdoc'),
    [],
  );

  const copySource = useCallback(async () => {
    await Clipboard.setStringAsync(sourceText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  }, [sourceText]);

  // V＝[プレビュー｜ソース] 切替（058 のプレビュー枠の V と同じ）・Esc＝閉じる
  useKeyCommands([
    ...(KEY_ESCAPE ? [{ input: KEY_ESCAPE, handler: onClose }] : []),
    { input: 'v', handler: () => { if (!isJson) setTab((v) => (v === 'preview' ? 'source' : 'preview')); } },
  ], visible);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: topInset, paddingLeft: horizontalInsets.left, paddingRight: horizontalInsets.right }]}>
        <View style={[styles.header, { paddingLeft: headerSides.left, paddingRight: headerSides.right, height: headerRowHeight }]}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.headerBtn}>
            <Ionicons name="close" size={Math.round(theme.fontSize.xxl)} color="#E5E7EB" />
          </Pressable>
          {/* アドレスバーの役。長い URL は中ほどを省略（ホストとパスの末尾が残る） */}
          <View style={styles.addressBar}>
            <Ionicons name="globe-outline" size={theme.fontSize.sm} color="#8B949E" />
            <Text
              style={[styles.addressText, { fontSize: theme.fontSize.sm }]}
              numberOfLines={1}
              ellipsizeMode="middle"
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {shown?.url ?? ''}
            </Text>
          </View>
          <View style={styles.headerBtn} />
        </View>

        <View style={styles.tabs}>
          <View style={styles.tabsLeft}>
            {(isJson ? (['source'] as const) : (['preview', 'source'] as const)).map((key) => (
              <Pressable key={key} onPress={() => setTab(key)} style={[styles.tab, activeTab === key && styles.tabActive]}>
                <Text
                  style={[styles.tabText, { fontSize: theme.fontSize.sm }, activeTab === key && styles.tabTextActive]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                >
                  {t(key === 'preview' ? 'code.preview' : 'code.source')}
                </Text>
              </Pressable>
            ))}
          </View>
          {activeTab === 'source' && (
            <Pressable onPress={copySource} hitSlop={8} style={[styles.copyBtn, copied && { backgroundColor: COPY_DONE_BG }]}>
              <Ionicons name={copied ? 'checkmark-sharp' : 'copy-outline'} size={Math.round(theme.fontSize.md)} color={copied ? COPY_DONE_COLOR : '#8B949E'} />
            </Pressable>
          )}
        </View>

        {/* プレビューの WebView はソース表示中も残す（切り替えるたびにページのスクリプトを走らせ直さない） */}
        {!isJson && (
          <View style={[styles.webviewWrap, activeTab !== 'preview' && styles.hidden]}>
            {visible && html !== null && (
              <WebView
                style={styles.webview}
                source={{ html, baseUrl: 'about:blank' }}
                onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
                // iPad でリンクをタップ（押し込み）すると iOS がリンク先のプレビューを小窓で開き、「Open Link」で
                // 外部のブラウザへ飛べてしまう（遷移の拒否より手前で起きる）。見るだけの画面なので切る
                allowsLinkPreview={false}
                javaScriptEnabled
                originWhitelist={['*']}
                scrollEnabled
                allowsInlineMediaPlayback={false}
              />
            )}
          </View>
        )}
        {activeTab === 'source' && (
          <ScrollView style={styles.source} contentContainerStyle={styles.sourceContent}>
            <ScrollView horizontal showsHorizontalScrollIndicator indicatorStyle="white" alwaysBounceHorizontal={false}>
              <SyntaxHighlightedCode code={sourceText} language={isJson ? 'javascript' : 'html'} wrap={false} />
            </ScrollView>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0D1117' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#30363D',
  },
  headerBtn: { padding: 4, minWidth: 40, alignItems: 'center' },
  addressBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#161B22',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  addressText: { flex: 1, color: '#E5E7EB', fontFamily: 'monospace' },
  // [プレビュー｜ソース] はコード実行のプレビュー枠（ExecutionOutput）と同じ見た目
  tabs: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 8 },
  tabsLeft: { flexDirection: 'row', gap: 4 },
  tab: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 6, backgroundColor: '#161B22' },
  tabActive: { backgroundColor: '#1F6FEB' },
  tabText: { color: '#8B949E', fontWeight: '600' },
  tabTextActive: { color: '#FFFFFF' },
  copyBtn: { padding: 4, borderRadius: 4 },
  webviewWrap: { flex: 1, backgroundColor: '#FFFFFF' },
  webview: { flex: 1, backgroundColor: '#FFFFFF' },
  hidden: { display: 'none' },
  source: { flex: 1 },
  sourceContent: { padding: 12, paddingBottom: 48 },
});
