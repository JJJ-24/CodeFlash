import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as KeyCommand from 'react-native-key-command';
import { transform } from 'sucrase';
import { WebView } from 'react-native-webview';

import { LANG_LABELS } from '@/lib/code-execution/constants';
import { buildInteractiveWebSandboxHtml } from '@/lib/code-execution/sandbox';
import type { LogEntry } from '@/lib/code-execution/types';
import { hasImageRefs, resolveHtmlImageRefs } from '@/lib/htmlImages';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';
import type { DeckImage } from '@/types';

const KEY_ESCAPE = (KeyCommand.constants?.keyInputEscape as string) ?? '';
// console 氾濫（setInterval 連打等）でメモリが膨らまないよう直近 N 件に丸める。
const MAX_LOGS = 500;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** 言語（html / javascript / typescript）。html は本文をそのまま描画、js/ts は本文＝JS で土台を操作。 */
  language: string;
  /** 本文（html は HTML/CSS＋任意 script、js/ts は JS/TS ソース。ts はこの中で変換する）。 */
  body: string;
  /** HTML/CSS 土台（[deck, block] の非空要素）。 */
  stages: string[];
  /** デッキの HTML 画像ライブラリ（043）。本文/土台の `img://name` を data URI へ解決するのに使う。 */
  deckImages?: DeckImage[];
}

/**
 * 041: 全画面インタラクティブプレビュー。
 * WebView を「操作可能」（別ネイティブ VC ＝ 学習/編集のジェスチャーと競合しない）にして
 * addEventListener（クリック/入力/チェック/スクロール等）を発火させ、下部のライブ console に
 * イベントで出た console.log を逐次表示する。
 */
export function InteractivePreviewModal({ visible, onClose, language, body, stages, deckImages }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState(false);
  const consoleRef = useRef<ScrollView>(null);

  const mode: 'html' | 'js' = language === 'html' ? 'html' : 'js';

  // TS はここで変換。失敗時は土台だけ描画し、変換エラーを console に出す。
  const { html: baseHtml, transpileError } = useMemo(() => {
    let src = body;
    let err: string | null = null;
    if (language === 'typescript') {
      try {
        src = transform(body, { transforms: ['typescript'] }).code;
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
    }
    return {
      html: buildInteractiveWebSandboxHtml(mode, err ? '' : src, stages),
      transpileError: err,
    };
  }, [body, language, mode, stages]);

  // 043: `img://name` があれば data URI へ解決してから WebView に渡す。参照が無ければ
  // 同期のまま（`baseHtml` をそのまま使う）＝従来の挙動と1フレームも変わらない。
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
  // 解決待ちの間は null＝WebView を出さない（未解決の HTML を一瞬描画してから
  // 差し替わると、二重読み込みになりスクリプトが2回走る）。
  const html = needsImages ? resolvedHtml : baseHtml;

  // 開くたびに console と WebView をリセット（土台の初期状態から＝反復学習の冪等性）。
  useEffect(() => {
    if (visible) {
      setLogs(transpileError ? [{ type: 'error', text: transpileError }] : []);
      setNonce((n) => n + 1);
    }
    // transpileError は本文が同じ間は不変。visible の立ち上がりで初期化するのが目的。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { type?: string; entry?: LogEntry };
      if (data.type === 'log' && data.entry) {
        setLogs((prev) => {
          const next = [...prev, data.entry as LogEntry];
          return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
        });
      }
    } catch {
      // 破損メッセージは無視
    }
  }, []);

  const reload = useCallback(() => {
    setLogs(transpileError ? [{ type: 'error', text: transpileError }] : []);
    setNonce((n) => n + 1);
  }, [transpileError]);

  const copyLogs = useCallback(async () => {
    if (logs.length === 0) return;
    await Clipboard.setStringAsync(logs.map((l) => l.text).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  }, [logs]);

  // ハードウェア Esc で閉じる（表示中のみ・ショートカット有効時）。✕ と Android 戻るは常時。
  useKeyCommands(KEY_ESCAPE ? [{ input: KEY_ESCAPE, handler: onClose }] : [], visible);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {/* ヘッダー */}
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.headerBtn}>
            <Ionicons name="close" size={Math.round(theme.fontSize.xxl)} color="#E5E7EB" />
          </Pressable>
          <Text style={[styles.headerTitle, { fontSize: theme.fontSize.md }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {LANG_LABELS[language] ?? language}
          </Text>
          <Pressable onPress={reload} hitSlop={10} style={styles.headerBtn}>
            <Ionicons name="refresh" size={Math.round(theme.fontSize.xl)} color="#E5E7EB" />
          </Pressable>
        </View>

        {/* 操作可能な WebView（別 VC のためカードの ScrollView/FlipCard と競合しない） */}
        <View style={styles.webviewWrap}>
          {visible && html !== null && (
            <WebView
              key={nonce}
              style={styles.webview}
              source={{ html, baseUrl: 'about:blank' }}
              onMessage={handleMessage}
              javaScriptEnabled
              originWhitelist={['*']}
              scrollEnabled
              allowsInlineMediaPlayback={false}
              mixedContentMode="always"
              keyboardDisplayRequiresUserAction={false}
            />
          )}
        </View>

        {/* ライブ console パネル */}
        <View style={[styles.console, { paddingBottom: insets.bottom }]}>
          <View style={styles.consoleHeader}>
            <Text style={[styles.consoleTitle, { fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('code.output')}
            </Text>
            {logs.length > 0 && (
              <Pressable onPress={copyLogs} hitSlop={8}>
                <Ionicons name={copied ? 'checkmark-sharp' : 'copy-outline'} size={Math.round(theme.fontSize.md)} color="#8B949E" />
              </Pressable>
            )}
          </View>
          <ScrollView
            ref={consoleRef}
            style={styles.consoleScroll}
            onContentSizeChange={() => consoleRef.current?.scrollToEnd({ animated: false })}
          >
            {logs.length === 0 ? (
              <Text style={[styles.consoleHint, { fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('code.interactHint')}
              </Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator indicatorStyle="white">
                <View>
                  {logs.map((log, i) => (
                    <Text
                      key={i}
                      style={[
                        styles.logLine,
                        { fontSize: theme.fontSize.md },
                        log.type === 'error' && styles.logError,
                        log.type === 'warn' && styles.logWarn,
                      ]}
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                    >
                      {log.text}
                    </Text>
                  ))}
                </View>
              </ScrollView>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0D1117',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#30363D',
  },
  headerBtn: {
    padding: 4,
    minWidth: 40,
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: '#E5E7EB',
    fontWeight: '700',
  },
  webviewWrap: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  webview: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  console: {
    height: 180,
    backgroundColor: '#0D1117',
    borderTopWidth: 1,
    borderTopColor: '#30363D',
    paddingHorizontal: 10,
    paddingTop: 6,
  },
  consoleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  consoleTitle: {
    color: '#6B7280',
    fontWeight: '600',
  },
  consoleScroll: {
    flex: 1,
  },
  consoleHint: {
    color: '#4B5563',
    fontStyle: 'italic',
    fontFamily: 'monospace',
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
});
