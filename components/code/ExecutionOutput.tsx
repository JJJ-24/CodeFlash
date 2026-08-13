import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
// 編集画面ではドラッグ可能リスト（RNGH 配下）の中に置かれるため、RNGH の ScrollView を使わないと
// 横スクロールのジェスチャーが外側に奪われてテーブルを横スクロールできない。
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { WebView } from 'react-native-webview';

import { SyntaxHighlightedCode } from '@/components/study/SyntaxHighlightedCode';
import { useSandboxReload } from '@/hooks/useSandboxReload';
import { buildStaticPreviewHtml } from '@/lib/code-execution/sandbox';
import type { ExecResult, LogEntry, SqlTableResult } from '@/lib/code-execution/types';
import { hasImageRefs, resolveHtmlImageRefs } from '@/lib/htmlImages';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import type { DeckImage } from '@/types';

/** インラインプレビューの高さ（下限）。中身がこれより低くても箱は縮めない。 */
const MIN_PREVIEW_HEIGHT = 220;
/** 同（上限）＝画面高に対する比率。長いページでカードが埋まらないように頭打ちにする。 */
const MAX_PREVIEW_HEIGHT_RATIO = 0.6;

/**
 * コピー用のテキスト。画面に出ている本文（見出しは含めない＝エラー時に「エラー」を入れないのと同じ流儀）。
 *
 * @param timeoutMessage タイムアウト時の文言。これは結果データ（`result`）ではなく表示時に i18n で
 *   作っている（実際に適用された上限秒数を差し込むため）ので、呼び出し側から渡してもらう。
 *   渡し忘れるとタイムアウトのカードだけコピーが空になる。
 */
function buildCopyText(result: ExecResult, timeoutMessage: string): string {
  const lines: string[] = [];
  if (result.status === 'timeout') lines.push(timeoutMessage);
  if (result.errorMessage) lines.push(result.errorMessage);
  result.tables?.forEach(t => {
    lines.push(t.columns.join('\t'));
    t.rows.forEach(row => lines.push(row.map(v => v === null ? 'NULL' : String(v)).join('\t')));
  });
  result.logs.forEach(l => lines.push(l.text));
  return lines.join('\n');
}

function SqlTable({ table }: { table: SqlTableResult }) {
  const theme = useTheme();
  const minColWidth = Math.max(60, Math.floor(240 / Math.max(table.columns.length, 1)));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator indicatorStyle="white" alwaysBounceHorizontal={false} style={styles.tableWrapper}>
      <View>
        {/* 列ごとにセルを縦積みすることで、各列の全セル幅が「その列の最大幅」に揃い行間の凸凹を防ぐ */}
        <View style={styles.tableGrid}>
          {table.columns.map((col, ci) => (
            <View key={ci} style={{ minWidth: minColWidth }}>
              <Text
                style={[styles.tableHeaderCell, { fontSize: theme.fontSize.sm }]}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {col}
              </Text>
              {table.rows.map((row, ri) => (
                <Text
                  key={ri}
                  style={[styles.tableCell, ri % 2 === 1 && styles.tableRowAlt, { fontSize: theme.fontSize.sm }]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {row[ci] === null ? 'NULL' : String(row[ci])}
                </Text>
              ))}
            </View>
          ))}
        </View>
        {table.rows.length === 0 && (
          <Text style={[styles.tableEmpty, { fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>(0 rows)</Text>
        )}
        <Text style={[styles.tableRowCount, { fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
          {table.rows.length} row{table.rows.length !== 1 ? 's' : ''}
        </Text>
      </View>
    </ScrollView>
  );
}

/** ログ一覧（実行中の途中経過・実行結果で共用）。各行は折り返さず、最長行に合わせて横スクロールする。 */
function LogLines({ logs }: { logs: LogEntry[] }) {
  const theme = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator indicatorStyle="white" alwaysBounceHorizontal={false}>
      <View>
        {logs.map((log, i) => (
          <Text
            key={i}
            style={[
              styles.logLine,
              { fontSize: theme.fontSize.md },
              log.type === 'error' && styles.logError,
              log.type === 'warn'  && styles.logWarn,
            ]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
          >
            {log.text}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

interface Props {
  result: ExecResult | null;
  /** 実行中に届いた途中経過のログ（`useCodeExecution.liveLogs`）。完了後は result.logs に置き換わる */
  liveLogs?: LogEntry[];
  htmlSource: string | null;
  baseUrl?: string;
  onClear: () => void;
  onMessage: (event: { nativeEvent: { data: string } }) => void;
  /** Web プレビュー実行中（html / js・ts＋土台）。true のとき WebView を可視プレビューとして描画する */
  previewMode?: boolean;
  /** 「ソース」タブに表示する HTML/CSS 土台（案a）。未指定なら空 */
  previewSource?: string | null;
  /** 実行ごとに増える連番。WebView の key に使い、同一 HTML の再実行でも強制再マウント（再実行）させる */
  runNonce?: number;
  /** プレビュー領域をタッチしたときに呼ぶ（学習画面でカードのフリップを抑制する用途）。編集画面では未指定 */
  onInteract?: () => void;
  /** true のとき、未実行でも土台（previewSource）を「実行前プレビュー」として自動描画する（js/ts・html） */
  staticPreview?: boolean;
  /** 実行前プレビューで土台の後ろに描画する本文（html ブロックで `previewInit` が ON のときだけ渡す）。
   *  js/ts では**渡さない**：本文は JS なので実行前に走らせてはいけない。 */
  staticBody?: string | null;
  /** 指定時、プレビューバーに「全画面」ボタンを出す（041・全画面インタラクティブプレビューを開く）。 */
  onExpand?: () => void;
  /** デッキの HTML 画像ライブラリ（043）。実行前プレビューの `img://name` を data URI へ解決するのに使う。 */
  deckImages?: DeckImage[];
  /** 非 Pro のため HTML/CSS 土台を積まずに実行したブロック。結果パネルの末尾に理由を1行出す
   *  （実行自体は止めない＝コンソール出力だけのカードは無料でもそのまま動く）。 */
  proStageHint?: boolean;
}

/**
 * コード実行結果の表示と WebView（実行エンジン）を担う共有コンポーネント。
 * console 専用言語では hidden WebView、Web 系（previewMode）では可視プレビュー＋
 * 「プレビュー / ソース」トグルを描画する。
 * CodeRunnerView（学習画面）と CodeBlockItem（エディタ）で共用する。
 */
export function ExecutionOutput({ result, liveLogs, htmlSource, baseUrl, onClear, onMessage, previewMode, previewSource, runNonce, onInteract, staticPreview, staticBody, onExpand, deckImages, proStageHint }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const [sourceCopied, setSourceCopied] = useState(false);
  const [previewTab, setPreviewTab] = useState<'preview' | 'source'>('preview');
  // action="" / action="#" の送信をブラウザ同様の「リロード」にする（素通しすると真っ白になる）。
  // インラインは pointerEvents="none" でタップが届かないため、効くのはカードの JS が
  // form.submit() を呼んだときだけ＝そこで実行が終わらないまま固着するのを防ぐ意味もある。
  const { reloadNonce, onShouldStartLoadWithRequest } = useSandboxReload();

  // タイムアウト表示の秒数。JS/Web は setTimeout の予約に応じて締切が伸びる（既定5秒→最大30秒）ので、
  // サンドボックスが実際に適用した上限（limitMs）を表示する。未指定なら既定の5秒。
  const timeoutSeconds = Math.round((result?.limitMs ?? 5000) / 1000);

  // 実行前プレビュー：未実行のときに描画する表示専用 HTML。
  // 中身は「土台（previewSource）＋ 本文（staticBody・html で previewInit が ON のときのみ）」＝
  // カードに書かれている初期状態。どちらも空なら枠自体を出さない。
  const staticHtml = useMemo(() => {
    if (!staticPreview) return null;
    const parts = [previewSource ?? '', staticBody ?? ''].filter((s) => s.trim() !== '');
    return parts.length > 0 ? buildStaticPreviewHtml(parts) : null;
  }, [staticPreview, previewSource, staticBody]);
  // 土台の編集（エディタ）で毎キーストローク再読込するのを避けるため 400ms デバウンスする。
  // 学習画面では土台は不変なのでデバウンスは実質無効（初回は即時表示）。
  const [debouncedStatic, setDebouncedStatic] = useState(staticHtml);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedStatic(staticHtml), 400);
    return () => clearTimeout(id);
  }, [staticHtml]);

  // 043: 土台に `img://name` があればデバウンス後に data URI へ解決する（デバウンス前だと
  // 打鍵のたびにファイルを読むことになる）。参照が無ければ解決を挟まず従来どおり同期のまま。
  const needsImages = !!debouncedStatic && hasImageRefs(debouncedStatic);
  const [resolvedStatic, setResolvedStatic] = useState<string | null>(null);
  useEffect(() => {
    if (!needsImages || !debouncedStatic) {
      setResolvedStatic(null);
      return;
    }
    let cancelled = false;
    void resolveHtmlImageRefs(debouncedStatic, deckImages ?? []).then((resolved) => {
      if (!cancelled) setResolvedStatic(resolved);
    });
    return () => { cancelled = true; };
  }, [debouncedStatic, needsImages, deckImages]);

  // インラインプレビューの高さ自動調整：中身の実高さを WebView から受け取り、箱をそれに合わせる。
  // インラインは `pointerEvents="none"` の表示専用でスクロールできないため、高さを合わせることが
  // 「全部見える」を成立させる唯一の手段（内側をスクロール可能にするとカード/編集リストと
  // ジェスチャーが競合する＝041 を全画面モーダルにした理由）。はみ出す分は外側のカードの
  // ScrollView で読める。
  const { height: windowHeight } = useWindowDimensions();
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const previewHeight = Math.min(
    Math.max(contentHeight ?? MIN_PREVIEW_HEIGHT, MIN_PREVIEW_HEIGHT),
    Math.round(windowHeight * MAX_PREVIEW_HEIGHT_RATIO),
  );

  // 「ソース」タブに出す実行後の DOM（サンドボックスが finish 時に送る）。
  // ⟲（onClear）や再実行で捨てる＝土台テキスト表示に戻る。プレビュー側の
  // 「実行前＝土台／実行後＝結果」と同じ軸で動くので、⟲ が両タブをまとめて初期状態へ戻す。
  const [resultSource, setResultSource] = useState<string | null>(null);

  // 実行中/実行後（web 系）は実行 WebView を可視表示。それ以外で土台があれば静的プレビューを出す。
  const execActive = previewMode && !!htmlSource;
  const activeHtml = execActive ? htmlSource : needsImages ? resolvedStatic : debouncedStatic;

  useEffect(() => {
    if (!execActive) setResultSource(null);
  }, [execActive]);
  // 再実行のたびに前回の結果ソースを捨てる（新しい結果が届くまで土台テキストを見せる）
  useEffect(() => {
    setResultSource(null);
  }, [runNonce]);

  // ソースタブの中身：実行後は結果 DOM、それ以外は土台テキスト。どちらも無ければタブ自体を出さない
  // （html で土台が無いカードは「見せるものが無い」ので空の箱を出さない）。
  const sourceText = execActive && resultSource ? resultSource : (previewSource ?? '');
  const hasSource = sourceText.trim() !== '';
  // 表示できるソースが無くなったら強制的にプレビュー側へ戻す（state は保持したまま）
  const activeTab = hasSource ? previewTab : 'preview';

  const handleCopy = useCallback(async () => {
    if (!result) return;
    await Clipboard.setStringAsync(buildCopyText(result, t('code.timeoutMessage', { seconds: timeoutSeconds })));
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  }, [result, t, timeoutSeconds]);

  // ソースタブの土台テキストは読み取り専用（選択できない）ためコピーボタンを用意する。
  const handleCopySource = useCallback(async () => {
    if (!sourceText) return;
    await Clipboard.setStringAsync(sourceText);
    setSourceCopied(true);
    setTimeout(() => setSourceCopied(false), 1000);
  }, [sourceText]);

  // WebView からのメッセージ振り分け。高さ通知はここで吸収し、実行結果ハンドラには渡さない
  // （`useCodeExecution.handleMessage` は type を ExecStatus として扱うため、渡すと状態が壊れる）。
  // 静的プレビューは高さ以外を送らないので、非実行中の他メッセージは捨てる。
  const handleWebViewMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    let data: { type?: string; height?: number; html?: string } | null = null;
    try {
      data = JSON.parse(event.nativeEvent.data) as { type?: string; height?: number; html?: string };
    } catch {
      data = null;
    }
    if (data?.type === 'previewHeight') {
      const h = Number(data.height);
      if (Number.isFinite(h) && h > 0) setContentHeight(Math.ceil(h));
      return;
    }
    if (data?.type === 'resultSource') {
      if (typeof data.html === 'string') setResultSource(data.html);
      return;
    }
    if (execActive) onMessage(event);
  }, [execActive, onMessage]);

  const clearGesture = useMemo(
    () => Gesture.Tap().maxDistance(10).hitSlop(8).onEnd(() => runOnJS(onClear)()),
    [onClear]
  );

  const copyGesture = useMemo(
    () => Gesture.Tap().maxDistance(10).hitSlop(8).onEnd(() => runOnJS(handleCopy)()),
    [handleCopy]
  );

  return (
    <>
      {/* 実行中の途中経過。setInterval のように時間をかけて出力するコードで、終わるまで何も
          見えないのを解消する。**最初のログが届いてから枠を出す**ので、ログを出さないカード
          （プレビューだけの html/css 等）の実行中の見た目は従来どおり変わらない。
          完了メッセージが届いたら下の result 側（全量）に置き換わる＝二重表示にはならない。 */}
      {!result && (liveLogs?.length ?? 0) > 0 && (
        <View style={styles.output}>
          <View style={styles.outputHeader}>
            <Text style={[styles.outputTitle, { fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('code.output')}
            </Text>
            <GestureDetector gesture={clearGesture}>
              <View style={styles.clearBtnWrapper}>
                <Text style={styles.clearBtn} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>✕</Text>
              </View>
            </GestureDetector>
          </View>
          <View style={styles.outputContent}>
            <LogLines logs={liveLogs ?? []} />
          </View>
        </View>
      )}
      {result && (!previewMode || result.logs.length > 0 || result.status === 'error' || result.status === 'timeout') && (
        <View
          style={[
            styles.output,
            (result.status === 'error' || result.status === 'timeout') && styles.outputError,
          ]}
        >
          <View style={styles.outputHeader}>
            <Text style={[styles.outputTitle, { fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {result.status === 'timeout' ? t('code.timeout', { seconds: timeoutSeconds }) :
               result.status === 'error'   ? t('code.error') : t('code.output')}
            </Text>
            <GestureDetector gesture={clearGesture}>
              <View style={styles.clearBtnWrapper}>
                <Text style={styles.clearBtn} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>✕</Text>
              </View>
            </GestureDetector>
          </View>
          <View style={styles.outputContent}>
            {(result.status === 'error' && result.errorMessage) || result.status === 'timeout' ? (
              <ScrollView horizontal showsHorizontalScrollIndicator indicatorStyle="white" alwaysBounceHorizontal={false}>
                <Text style={[styles.errorMessage, { fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {result.status === 'timeout' ? t('code.timeoutMessage', { seconds: timeoutSeconds }) : result.errorMessage}
                </Text>
              </ScrollView>
            ) : null}
            {result.tables?.map((table, ti) => (
              <SqlTable key={ti} table={table} />
            ))}
            {result.logs.length === 0 && result.status === 'success' && !result.tables?.length && (
              <Text style={[styles.emptyOutput, { fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('code.empty')}</Text>
            )}
            {result.logs.length > 0 && <LogLines logs={result.logs} />}
            {/* 非 Pro で土台を落として実行したブロック。DOM を触るコードはここで null 参照エラーに
                なるので、「壊れた」ではなく Pro 機能だと分かるよう理由を1行添える（実行は止めない）。 */}
            {proStageHint && (
              <Text style={[styles.proStageHint, { fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                {t('code.proStageHint')}
              </Text>
            )}
            <GestureDetector gesture={copyGesture}>
              <View style={styles.copyBtn}>
                <Ionicons name={copied ? 'checkmark-sharp' : 'copy-outline'} size={theme.fontSize.sm} color="#4B5563" />
              </View>
            </GestureDetector>
          </View>
        </View>
      )}

      {activeHtml ? (
        // 可視プレビュー：実行中/実行後は実行結果（execActive）、未実行時は土台の静的プレビュー。
        // ソースタブでも WebView は display:none で残し再実行を避ける。pointerEvents なしで
        // 学習画面のスクロール/フリップと競合しない。
        <View style={styles.preview} onTouchStart={onInteract}>
          <View style={styles.previewTabs}>
            <View style={styles.previewTabsLeft}>
              {(hasSource ? (['preview', 'source'] as const) : (['preview'] as const)).map((tab) => (
                <Pressable key={tab} onPress={() => { onInteract?.(); setPreviewTab(tab); }} style={[styles.previewTab, activeTab === tab && styles.previewTabActive]}>
                  <Text
                    style={[styles.previewTabText, { fontSize: theme.fontSize.xs }, activeTab === tab && styles.previewTabTextActive]}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                  >
                    {t(tab === 'preview' ? 'code.preview' : 'code.source')}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.previewTabsRight}>
              {/* 全画面インタラクティブプレビューを開く（041）。操作可能な WebView ＋ ライブ console。 */}
              {onExpand && (
                <Pressable onPress={() => { onInteract?.(); onExpand(); }} hitSlop={8} style={styles.previewReset}>
                  <Ionicons name="expand" size={Math.round(theme.fontSize.md)} color="#8B949E" />
                </Pressable>
              )}
              {/* ソースタブ表示中は土台テキストをコピーできる（読み取り専用で選択できないため） */}
              {activeTab === 'source' && hasSource && (
                <Pressable onPress={() => { onInteract?.(); handleCopySource(); }} hitSlop={8} style={styles.previewReset}>
                  <Ionicons name={sourceCopied ? 'checkmark-sharp' : 'copy-outline'} size={Math.round(theme.fontSize.md)} color="#8B949E" />
                </Pressable>
              )}
              {/* 実行結果を表示中のときだけ「リセット」＝土台の初期状態（静的プレビュー）に戻す */}
              {execActive && (
                <Pressable onPress={() => { onInteract?.(); onClear(); }} hitSlop={8} style={styles.previewReset}>
                  <Ionicons name="refresh" size={Math.round(theme.fontSize.md)} color="#8B949E" />
                </Pressable>
              )}
            </View>
          </View>
          <View style={[styles.previewBody, { height: previewHeight }, activeTab !== 'preview' && styles.previewHidden]} pointerEvents="none">
            <WebView
              key={`${execActive ? `exec-${runNonce}` : 'static'}-${reloadNonce}`}
              style={styles.previewWebView}
              source={{ html: activeHtml, baseUrl: baseUrl ?? 'about:blank' }}
              onMessage={handleWebViewMessage}
              onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
              javaScriptEnabled
              originWhitelist={['*']}
              scrollEnabled={false}
              allowsInlineMediaPlayback={false}
              mixedContentMode="always"
            />
          </View>
          {activeTab === 'source' && (
            <ScrollView style={[styles.previewSource, { maxHeight: previewHeight }]}>
              <ScrollView horizontal showsHorizontalScrollIndicator indicatorStyle="white" alwaysBounceHorizontal={false}>
                <SyntaxHighlightedCode code={sourceText} language="html" wrap={false} />
              </ScrollView>
            </ScrollView>
          )}
        </View>
      ) : (
        // console 専用言語（実行中）：非表示 WebView（実行エンジン）を画面外に置いて確実に読み込ませる
        htmlSource && !previewMode && (
          <View style={styles.hiddenWebViewContainer} pointerEvents="none">
            <WebView
              key={runNonce}
              style={styles.hiddenWebView}
              source={{ html: htmlSource, baseUrl: baseUrl ?? 'about:blank' }}
              onMessage={onMessage}
              javaScriptEnabled
              originWhitelist={['*']}
              scrollEnabled={false}
              allowsInlineMediaPlayback={false}
              mixedContentMode="always"
            />
          </View>
        )
      )}
    </>
  );
}

const styles = StyleSheet.create({
  output: {
    borderTopWidth: 1,
    borderTopColor: '#333',
    backgroundColor: '#0D1117',
    padding: 10,
    gap: 4,
  },
  outputError: {
    backgroundColor: '#1A0000',
  },
  outputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
    marginBottom: 4,
  },
  outputTitle: {
    color: '#6B7280',
    fontWeight: '600',
  },
  outputContent: {
    position: 'relative',
  },
  copyBtn: {
    position: 'absolute',
    top: 0,
    right: 0,
    padding: 4,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 4,
  },
  clearBtnWrapper: { padding: 2 },
  clearBtn: {
    color: '#4B5563',
  },
  logLine: {
    fontFamily: 'monospace',
    color: '#E5E7EB',
    lineHeight: 20,
  },
  logError: {
    color: '#F87171',
  },
  logWarn: {
    color: '#FBBF24',
  },
  errorMessage: {
    fontFamily: 'monospace',
    color: '#F87171',
    lineHeight: 20,
  },
  emptyOutput: {
    fontFamily: 'monospace',
    color: '#4B5563',
    fontStyle: 'italic',
  },
  proStageHint: {
    color: '#8B949E',
    marginTop: 8,
    lineHeight: 16,
  },
  preview: {
    borderTopWidth: 1,
    borderTopColor: '#333',
    backgroundColor: '#0D1117',
  },
  previewTabs: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 6,
  },
  previewTabsLeft: {
    flexDirection: 'row',
    gap: 4,
  },
  previewTabsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  previewReset: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  previewTab: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#161B22',
  },
  previewTabActive: {
    backgroundColor: '#1F6FEB',
  },
  previewTabText: {
    color: '#8B949E',
    fontWeight: '600',
  },
  previewTabTextActive: {
    color: '#FFFFFF',
  },
  previewBody: {
    // 高さは中身に合わせて可変（MIN_PREVIEW_HEIGHT〜画面高の MAX_PREVIEW_HEIGHT_RATIO）。
    // 実値は描画側でインライン指定する。
    backgroundColor: '#FFFFFF',
  },
  previewHidden: {
    // ソースタブ表示中も WebView は残す（再実行を避けるため）が、**display:'none' にしてはいけない**。
    // WKWebView がビュー階層から外れて JS が走らず、実行が完了しない（ソースを開いたまま実行すると
    // スピナーが止まらない）。console 専用言語で実績のある「画面外へ逃がす」方式（hiddenWebViewContainer
    // と同型）にして、見えないまま確実に実行させる。高さは描画側のインライン指定がそのまま効く。
    position: 'absolute',
    top: -10000,
    left: 0,
    right: 0,
    opacity: 0,
  },
  previewWebView: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  previewSource: {
    // 上限はプレビューと同じ可変値を描画側で渡す（タブ切替で箱の高さが飛ばないように）
  },
  hiddenWebViewContainer: {
    position: 'absolute',
    top: -500,
    left: -500,
    width: 100,
    height: 100,
    opacity: 0,
  },
  hiddenWebView: {
    flex: 1,
  },
  tableWrapper: {
    marginBottom: 6,
    borderRadius: 4,
    overflow: 'hidden',
  },
  tableGrid: {
    flexDirection: 'row',
  },
  tableHeaderCell: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    color: '#94A3B8',
    fontWeight: '600',
    fontFamily: 'monospace',
    backgroundColor: '#1E2936',
    borderBottomWidth: 1,
    borderBottomColor: '#2D3748',
  },
  tableRowAlt: {
    backgroundColor: '#0F1923',
  },
  tableCell: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    color: '#E5E7EB',
    fontFamily: 'monospace',
  },
  tableEmpty: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    color: '#4B5563',
    fontStyle: 'italic',
    fontFamily: 'monospace',
  },
  tableRowCount: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    color: '#4B5563',
    backgroundColor: '#1E2936',
  },
});
