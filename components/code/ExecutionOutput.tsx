import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
// 編集画面ではドラッグ可能リスト（RNGH 配下）の中に置かれるため、RNGH の ScrollView を使わないと
// 横スクロールのジェスチャーが外側に奪われてテーブルを横スクロールできない。
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { WebView } from 'react-native-webview';

import { SyntaxHighlightedCode } from '@/components/study/SyntaxHighlightedCode';
import { buildStaticPreviewHtml } from '@/lib/code-execution/sandbox';
import type { ExecResult, SqlTableResult } from '@/lib/code-execution/types';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

function buildCopyText(result: ExecResult): string {
  const lines: string[] = [];
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
    <ScrollView horizontal showsHorizontalScrollIndicator indicatorStyle="white" style={styles.tableWrapper}>
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

interface Props {
  result: ExecResult | null;
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
  /** true のとき、未実行でも土台（previewSource）を「実行前プレビュー」として自動描画する（js/ts 用） */
  staticPreview?: boolean;
}

/**
 * コード実行結果の表示と WebView（実行エンジン）を担う共有コンポーネント。
 * console 専用言語では hidden WebView、Web 系（previewMode）では可視プレビュー＋
 * 「プレビュー / ソース」トグルを描画する。
 * CodeRunnerView（学習画面）と CodeBlockItem（エディタ）で共用する。
 */
export function ExecutionOutput({ result, htmlSource, baseUrl, onClear, onMessage, previewMode, previewSource, runNonce, onInteract, staticPreview }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const [previewTab, setPreviewTab] = useState<'preview' | 'source'>('preview');

  // 実行前プレビュー：未実行のとき土台（previewSource）だけを描画する表示専用 HTML。
  const staticHtml = useMemo(
    () => (staticPreview && previewSource && previewSource.trim() !== '' ? buildStaticPreviewHtml([previewSource]) : null),
    [staticPreview, previewSource],
  );
  // 土台の編集（エディタ）で毎キーストローク再読込するのを避けるため 400ms デバウンスする。
  // 学習画面では土台は不変なのでデバウンスは実質無効（初回は即時表示）。
  const [debouncedStatic, setDebouncedStatic] = useState(staticHtml);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedStatic(staticHtml), 400);
    return () => clearTimeout(id);
  }, [staticHtml]);

  // 実行中/実行後（web 系）は実行 WebView を可視表示。それ以外で土台があれば静的プレビューを出す。
  const execActive = previewMode && !!htmlSource;
  const activeHtml = execActive ? htmlSource : debouncedStatic;

  const handleCopy = useCallback(async () => {
    if (!result) return;
    await Clipboard.setStringAsync(buildCopyText(result));
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  }, [result]);

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
      {result && (!previewMode || result.logs.length > 0 || result.status === 'error' || result.status === 'timeout') && (
        <View
          style={[
            styles.output,
            (result.status === 'error' || result.status === 'timeout') && styles.outputError,
          ]}
        >
          <View style={styles.outputHeader}>
            <Text style={[styles.outputTitle, { fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {result.status === 'timeout' ? t('code.timeout') :
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
              <ScrollView horizontal showsHorizontalScrollIndicator indicatorStyle="white">
                <Text style={[styles.errorMessage, { fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {result.status === 'timeout' ? t('code.timeoutMessage') : result.errorMessage}
                </Text>
              </ScrollView>
            ) : null}
            {result.tables?.map((table, ti) => (
              <SqlTable key={ti} table={table} />
            ))}
            {result.logs.length === 0 && result.status === 'success' && !result.tables?.length && (
              <Text style={[styles.emptyOutput, { fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('code.empty')}</Text>
            )}
            {result.logs.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator indicatorStyle="white">
                {/* 各行を折り返さず縦積みし、最長行に合わせて横スクロールできるようにする */}
                <View>
                  {result.logs.map((log, i) => (
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
              {(['preview', 'source'] as const).map((tab) => (
                <Pressable key={tab} onPress={() => { onInteract?.(); setPreviewTab(tab); }} style={[styles.previewTab, previewTab === tab && styles.previewTabActive]}>
                  <Text
                    style={[styles.previewTabText, { fontSize: theme.fontSize.xs }, previewTab === tab && styles.previewTabTextActive]}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                  >
                    {t(tab === 'preview' ? 'code.preview' : 'code.source')}
                  </Text>
                </Pressable>
              ))}
            </View>
            {/* 実行結果を表示中のときだけ「リセット」＝土台の初期状態（静的プレビュー）に戻す */}
            {execActive && (
              <Pressable onPress={() => { onInteract?.(); onClear(); }} hitSlop={8} style={styles.previewReset}>
                <Ionicons name="refresh" size={Math.round(theme.fontSize.md)} color="#8B949E" />
              </Pressable>
            )}
          </View>
          <View style={[styles.previewBody, previewTab !== 'preview' && styles.previewHidden]} pointerEvents="none">
            <WebView
              key={execActive ? `exec-${runNonce}` : 'static'}
              style={styles.previewWebView}
              source={{ html: activeHtml, baseUrl: baseUrl ?? 'about:blank' }}
              onMessage={execActive ? onMessage : undefined}
              javaScriptEnabled
              originWhitelist={['*']}
              scrollEnabled={false}
              allowsInlineMediaPlayback={false}
              mixedContentMode="always"
            />
          </View>
          {previewTab === 'source' && (
            <ScrollView style={styles.previewSource}>
              <ScrollView horizontal showsHorizontalScrollIndicator indicatorStyle="white">
                <SyntaxHighlightedCode code={previewSource ?? ''} language="html" wrap={false} />
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
    height: 220,
    backgroundColor: '#FFFFFF',
  },
  previewHidden: {
    display: 'none',
  },
  previewWebView: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  previewSource: {
    maxHeight: 220,
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
