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
import { useSandboxReload } from '@/hooks/useSandboxReload';
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
  /** 言語（html / css / javascript / typescript）。html は本文をそのまま描画、js/ts は本文＝JS で土台を操作、css は本文＝CSS で土台を装飾。 */
  language: string;
  /** 実行後（▶）に描く本文（html は HTML/CSS＋任意 script、js/ts は JS/TS ソース。ts はこの中で変換する）。 */
  body: string;
  /** 実行前（⟲）に土台の後ろへ描く本文。html で `previewInit` が ON のときだけ非空＝インラインの staticBody と同じ。 */
  previewBody: string;
  /** 開いた時点で実行済みか（インラインが結果を出しているか）。false なら実行前表示で開く。 */
  initialRan: boolean;
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
export function InteractivePreviewModal({ visible, onClose, language, body, previewBody, initialRan, stages, deckImages }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState(false);
  // ページの <title>（あればヘッダーに出す。無ければ言語ラベル）
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  // 全画面の中でも「実行前（土台のみ）／実行後（本文あり）」を往復できる＝インラインと同じ軸。
  // 開いた時点のインラインの状態（initialRan）で初期化し、▶/⟲ で切り替える。
  const [ran, setRan] = useState(initialRan);
  const consoleRef = useRef<ScrollView>(null);
  // action="" / action="#" の送信は about:blank への遷移＝真っ白になるので、
  // ブラウザのリロードと同じ「同じ HTML が描き直されて入力欄が空になる」に寄せる。
  const { reloadNonce, onShouldStartLoadWithRequest } = useSandboxReload();

  const mode: 'html' | 'js' | 'css' = language === 'html' ? 'html' : language === 'css' ? 'css' : 'js';

  // TS はここで変換（実行前表示では使わないが、ran に依存させないことで
  // 「変換エラーを console に出す」判定を ▶/⟲ の切替と独立に保つ）。失敗時は土台だけ描画する。
  const { code: tsCode, error: transpileError } = useMemo(() => {
    if (language !== 'typescript') return { code: body, error: null as string | null };
    try {
      return { code: transform(body, { transforms: ['typescript'] }).code, error: null as string | null };
    } catch (e) {
      return { code: '', error: e instanceof Error ? e.message : String(e) };
    }
  }, [body, language]);

  // 実行前は本文の代わりに previewBody（html＋previewInit のときだけ非空）を描く＝インラインの実行前プレビューと同じ中身。
  const baseHtml = useMemo(
    () => buildInteractiveWebSandboxHtml(mode, ran ? tsCode : previewBody, stages),
    [mode, ran, tsCode, previewBody, stages],
  );

  // 「実行前」に戻せるのは戻り先（土台 or previewBody）があるときだけ。
  // 土台の無い html/css を実行後に開いた場合は戻ると真っ白になるので ⟲ を出さない
  // （インラインで ⟲ を押すとプレビュー枠ごと消えるのと同じ状況）。
  const canShowPreRun = stages.length > 0 || previewBody.trim() !== '';

  // 実行時のみ変換エラーを console に出す（実行前表示では本文を走らせていないため）
  const initialLogs = useCallback(
    (nextRan: boolean): LogEntry[] => (nextRan && transpileError ? [{ type: 'error', text: transpileError }] : []),
    [transpileError],
  );

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
  // 実行前/実行後もインライン側の状態（initialRan）に合わせ直す。
  useEffect(() => {
    if (visible) {
      setRan(initialRan);
      setLogs(initialLogs(initialRan));
      setPageTitle(null);
      setNonce((n) => n + 1);
    }
    // initialRan / transpileError は閉じている間しか変わらない（モーダル表示中はインラインを操作できない）。
    // visible の立ち上がりで初期化するのが目的。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { type?: string; entry?: LogEntry; title?: string };
      if (data.type === 'title') {
        setPageTitle(typeof data.title === 'string' ? data.title.trim() : '');
        return;
      }
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

  // ▶ 実行：本文を実行した状態にする。実行中に押せば「初期状態から再実行」（DOM も console も戻る）。
  const runNow = useCallback(() => {
    setRan(true);
    setLogs(initialLogs(true));
    setPageTitle(null);
    setNonce((n) => n + 1);
  }, [initialLogs]);

  // ⟲ リセット：実行前（土台のみ）へ戻す＝インラインの ⟲（onClear）と同じ意味。
  const resetToPreRun = useCallback(() => {
    setRan(false);
    setLogs([]);
    setPageTitle(null);
    setNonce((n) => n + 1);
  }, []);

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
        {/* ヘッダー（左右のグループを同じ最小幅にしてタイトルを中央に保つ） */}
        <View style={styles.header}>
          <View style={styles.headerSide}>
            <Pressable onPress={onClose} hitSlop={10} style={styles.headerBtn}>
              <Ionicons name="close" size={Math.round(theme.fontSize.xxl)} color="#E5E7EB" />
            </Pressable>
          </View>
          <Text style={[styles.headerTitle, { fontSize: theme.fontSize.md }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {pageTitle || LANG_LABELS[language] || language}
          </Text>
          <View style={[styles.headerSide, styles.headerSideRight]}>
            {ran && canShowPreRun && (
              <Pressable onPress={resetToPreRun} hitSlop={10} style={styles.headerBtn}>
                <Ionicons name="refresh" size={Math.round(theme.fontSize.xl)} color="#E5E7EB" />
              </Pressable>
            )}
            {/* 実行前は ▶ を塗りボタン（コードブロックの実行ボタンと同じ青）にして「押せば動く」と読ませる。
                実行前は無反応な土台だけが出るため、状態表示より次の行動が伝わる形を優先した。
                実行後はゴースト（アイコンのみ）＝控えめな再実行ボタンに戻す。 */}
            <Pressable onPress={runNow} hitSlop={10} style={[styles.headerBtn, !ran && styles.headerRunBtnFilled]}>
              <Ionicons name="caret-forward" size={Math.round(theme.fontSize.xl)} color={ran ? '#E5E7EB' : '#FFFFFF'} />
            </Pressable>
          </View>
        </View>

        {/* 操作可能な WebView（別 VC のためカードの ScrollView/FlipCard と競合しない） */}
        <View style={styles.webviewWrap}>
          {visible && html !== null && (
            <WebView
              key={`${nonce}-${reloadNonce}`}
              style={styles.webview}
              source={{ html, baseUrl: 'about:blank' }}
              onMessage={handleMessage}
              onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
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
                {t(ran ? 'code.interactHint' : 'code.beforeRunHint')}
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
  headerSide: {
    // ✕ 側と ⟲/▶ 側を同じ最小幅にすることで、ボタン数が変わってもタイトルが中央に留まる
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 88,
  },
  headerSideRight: {
    justifyContent: 'flex-end',
  },
  headerRunBtnFilled: {
    // コードブロックのヘッダーの ▶ と同じ青。幅は headerBtn のままなのでタイトルの中央はずれない
    backgroundColor: '#1976D2',
    borderRadius: 8,
    paddingVertical: 6,
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
