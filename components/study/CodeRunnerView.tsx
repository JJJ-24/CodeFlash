import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { useTranslation } from "react-i18next";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

import { ExecutionOutput } from "@/components/code/ExecutionOutput";
import { InteractivePreviewModal } from "@/components/code/InteractivePreviewModal";
import { SymbolPalette } from "@/components/code/SymbolPalette";
import { SyntaxHighlightedCode } from "@/components/study/SyntaxHighlightedCode";
import { InfoModal } from "@/components/InfoModal";
import { useCodeExecution } from "@/hooks/useCodeExecution";
import { useInsertPair } from "@/hooks/useInsertPair";
import { LANG_LABELS, PRO_LANGUAGES } from "@/lib/code-execution/constants";
import { useProStore } from "@/store/pro";
import { resolveDeckStageHtml, resolveDeckStageSql } from "@/lib/deckStages";
import { useFlipSuppress } from "@/lib/FlipSuppressContext";
import { useInteractivePreview } from "@/lib/InteractivePreviewContext";
import { useTheme, MAX_FONT_MULTIPLIER, CODE_STATE_HEADERS } from "@/lib/theme";
import type { CodeBlock, DeckImage, DeckStage } from "@/types";

interface Props {
  block: CodeBlock;
  editable?: boolean;
  editedContent?: string;
  onContentChange?: (text: string) => void;
  onEditFocus?: () => void;
  onEditBlur?: () => void;
  onEditRequest?: () => void;
  onSelectRequest?: () => void;
  onRunRequest?: () => void;
  exitEditTrigger?: number;
  runTrigger?: number;
  editTrigger?: number;
  isSelected?: boolean;
  onRunStart?: () => void;
  /** 同じ BlocksView 内の別ブロックが編集中かどうか */
  anotherBlockEditing?: boolean;
  /** 実行ボタン経由での編集終了時にキーボードフォーカスを強制復元するコールバック */
  onForceKeyboardFocus?: () => void;
  /** デッキ共通の SQL 初期化（SQL ブロック実行時に本体の前に流す。ブロック固有 sqlInit の前に積まれる） */
  deckSqlStages?: DeckStage[];
  /** 044: デッキの HTML/CSS 土台の一覧。ブロックは deckStageId で1つを選ぶ（未指定＝先頭） */
  deckHtmlStages?: DeckStage[];
  /** デッキの HTML 画像ライブラリ（043）。本文/土台の `img://name` を data URI へ解決する */
  deckHtmlImages?: DeckImage[];
}

export function CodeRunnerView({
  block,
  editable,
  editedContent,
  onContentChange,
  onEditFocus,
  onEditBlur,
  onEditRequest,
  onSelectRequest,
  onRunRequest,
  exitEditTrigger,
  runTrigger,
  editTrigger,
  isSelected,
  onRunStart,
  anotherBlockEditing,
  onForceKeyboardFocus,
  deckSqlStages,
  deckHtmlStages,
  deckHtmlImages,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { suppress } = useFlipSuppress();
  const { setOpen: setPreviewOpen } = useInteractivePreview();
  const {
    result,
    liveLogs,
    htmlSource,
    baseUrl,
    previewMode,
    runNonce,
    isRunning,
    run,
    clear,
    handleMessage,
    reset,
  } = useCodeExecution(onRunStart);
  const isPro = useProStore(s => s.isPro);
  // Web 系4言語（html / js・ts / css）で body 先頭に加算する HTML/CSS 土台（デッキ土台 → ブロック固有）。
  // 044: デッキ側はブロックの deckStageId で選ばれた1つ（未指定＝先頭・削除済み参照は積まない）。
  // html も 2026-08-08 からブロック土台を持つ（カード単位の「出題の前提」を置けるようにするため。
  // 土台＝実行前から見える前提／本文＝実行して初めて出る答え、という軸は 4 言語で共通）。
  // `noDeckHtmlInit` のブロックはデッキ共通の土台を積まない（土台が無関係なブロックで
  // 無関係なプレビューを出さないため。js/ts は土台が空になるのでコンソール実行に戻る）。
  // 土台は Pro 機能なので**非 Pro では積まない**（体験終了後や配布デッキで、土台つきの
  // js/ts を実行すると可視プレビューが出てしまい html/css の実行ゲートが素通しになる）。
  // 積まなければ js/ts は hasStage=false でコンソール実行に落ち、実行前プレビュー・
  // ソースタブ・⛶ も previewSource が空になるので自動的に消える。
  const htmlInits = useMemo(
    () => {
      // block 丸ごとではなく必要な2フィールドだけ渡す（useMemo の依存を最小に保つため）
      const deckStage = isPro
        ? resolveDeckStageHtml(deckHtmlStages, { deckStageId: block.deckStageId, noDeckHtmlInit: block.noDeckHtmlInit })
        : '';
      const blockStage = isPro ? (block.htmlInit ?? '') : '';
      return (block.language === 'html' || block.language === 'javascript' || block.language === 'typescript' || block.language === 'css')
        ? [deckStage, blockStage]
        : undefined;
    },
    [block.language, block.htmlInit, block.noDeckHtmlInit, block.deckStageId, deckHtmlStages, isPro],
  );
  // 「ソース」タブに出す土台テキスト（案a）。非空の土台だけを結合する。
  const previewSource = (htmlInits ?? []).filter((s) => s && s.trim() !== '').join('\n');
  const [isEditing, setIsEditing] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [proModalVisible, setProModalVisible] = useState(false);
  const [expandVisible, setExpandVisible] = useState(false);
  // 非 Pro のため土台を落として実行した js/ts か（＝Pro なら土台を積んだはずのブロック）。
  // 実行はブロックしない：JS 実行は無料機能で、デッキ共通土台は既定 ON かつ切る手段（noDeckHtmlInit）が
  // Pro 限定のため、止めると「土台のあるデッキでは console.log すら実行できない」逃げ場のない状態になる。
  // 代わりに結果パネルへ理由を1行出す（DOM を触るコードはそこで null 参照エラーになる）。
  const stageDroppedByPro =
    !isPro &&
    (block.language === 'javascript' || block.language === 'typescript') &&
    (resolveDeckStageHtml(deckHtmlStages, block).trim() !== '' || !!block.htmlInit?.trim());
  // 041: 全画面インタラクティブプレビューを開ける条件。html は常に、js/ts は土台がある時のみ（＝Web プレビュー対象）。Pro 限定。
  const canExpand =
    isPro &&
    (block.language === 'html' ||
      // css は土台が無くても web プレビュー（＝全画面で開ける）。js/ts だけが土台必須。
      block.language === 'css' ||
      ((block.language === 'javascript' || block.language === 'typescript') && previewSource.trim() !== ''));

  // 実行前プレビュー（土台の初期状態）を出す対象。**html も含める**：土台に追記して完成させる
  // 出題（土台を見てから本文を書く）で「実行前に土台が見えている」ことに意味があるため。
  // 040 当初は html を対象外にしていたが、その用途が出てきたので方針変更（docs/040 参照）。
  // 表示されるのはどの言語でもデッキ/ブロックの土台だけで、本文は実行するまで描画されない
  // （本文まで追従描画すると答えが書きながら見えてしまい、カードの「書いて→実行して答え合わせ」と衝突する）。
  // 土台が空なら previewSource も空になり枠自体が出ないので、土台を使わないカードは従来どおり。
  const canStaticPreview =
    isPro &&
    (block.language === 'javascript' || block.language === 'typescript' || block.language === 'html' || block.language === 'css');

  // 実行前プレビューで土台の後ろに描く本文。html で `previewInit` が ON のときだけ。
  // js/ts では渡さない（本文は JS なので実行前に走らせてはいけない）。
  const staticBody = block.language === 'html' && block.previewInit ? block.content : undefined;

  // ⛶ 全画面（041）はインラインの「実行前＝土台だけ／実行後＝結果」と**同じ軸**に乗る。
  // 開いた時点のインラインの状態（execActive）で実行前/実行後が決まり、モーダル内の ▶/⟲ で往復できる。
  // 未実行から本文を走らせると 040 の「実行するまで本文の結果は見せない（答えを先に見せない）」原則が
  // 全画面だけ素通しになるため、実行前に描くのは土台＋staticBody（html の previewInit が ON のときだけ）。
  const execActive = previewMode && !!htmlSource;
  // 実行後にライブ実行する本文＝run() に渡すのと同じもの（学習者の編集を含む）
  const runBody = editable && editedContent !== undefined ? editedContent : block.content;

  const stages = useMemo(() => (htmlInits ?? []).filter((s) => s && s.trim() !== ''), [htmlInits]);
  const codeInputRef = useRef<TextInput>(null);
  // onBlur での二重実行防止フラグ（完了ボタン・▶実行ボタン押下時はtrueにセット）
  const intentionalExitRef = useRef(false);
  // パレットタップ中フラグ（onTouchStart でセット、onFocus でリセット）
  const paletteActiveRef = useRef(false);
  // isEditing の ref 版（RNGH worklet の stale closure 問題を回避するため、
  // setIsEditing と同時に同期更新する）
  const isEditingRef = useRef(false);
  // 別ブロックが編集中かどうかの ref 版（prop 変化時に useEffect で更新）
  const anotherBlockEditingRef = useRef(false);
  useEffect(() => { anotherBlockEditingRef.current = anotherBlockEditing ?? false; }, [anotherBlockEditing]);
  const { insertPair, selection, handleSelectionChange, initCursorPosition } = useInsertPair(
    editedContent ?? block.content,
    onContentChange ?? (() => {}),
    codeInputRef,
  );

  useEffect(() => {
    reset();
    isEditingRef.current = false;
    setIsEditing(false);
  }, [block.content]);

  useEffect(() => {
    if (!block.executable) reset();
  }, [block.executable]);

  useEffect(() => {
    if (isEditing) {
      // focus() によるプログラム的フォーカスでは onSelectionChange が発火しない（iOS の挙動）ため、
      // カーソル位置をテキスト末尾で初期化する。これにより、ユーザーが手動でタップする前でも
      // パレットからの挿入が正しい位置（末尾）に行われる。
      const textLength = (editedContent ?? block.content).length;
      setTimeout(() => {
        codeInputRef.current?.focus();
        initCursorPosition(textLength);
      }, 50);
    }
  }, [isEditing]);

  useEffect(() => {
    if (runTrigger && block.executable) handleRun();
  }, [runTrigger]);

  useEffect(() => {
    if (editTrigger && editable && !isEditingRef.current) {
      isEditingRef.current = true;
      onEditRequest?.();
      setIsEditing(true);
      clear();
      onEditFocus?.();
    }
  }, [editTrigger]);

  // 編集終了のみ（実行なし）- 完了ボタン・exitEditTrigger 用
  const handleEditEnd = useCallback(() => {
    isEditingRef.current = false;
    intentionalExitRef.current = true;
    setIsEditing(false);
    onEditBlur?.();
  }, [onEditBlur]);

  // 外部からの強制終了（別ブロックが編集開始した時）
  useEffect(() => {
    if (exitEditTrigger) handleEditEnd();
  }, [exitEditTrigger]);

  // 編集開始/終了トグル - 編集ボタン用
  const handleEditToggle = useCallback(() => {
    if (isEditing) {
      suppress?.(); // Done タップ時にフリップを抑制
      handleEditEnd();
    } else {
      suppress?.(); // 編集開始タップがカードフリップに伝播しないよう抑制
      isEditingRef.current = true;
      onEditRequest?.();
      setIsEditing(true);
      clear();
      onEditFocus?.();
    }
  }, [isEditing, handleEditEnd, clear, onEditFocus, onEditRequest, suppress]);

  // コード本体タップ - 編集画面と同じく、タップで入力モードへ入る。
  // 表示中（!isEditing）のみ呼ばれるが、念のためガードする。
  const handleCodeAreaTap = useCallback(() => {
    if (isEditingRef.current) return;
    handleEditToggle();
  }, [handleEditToggle]);

  // 実行 - ▶実行ボタン・r キー用
  // isEditingRef / anotherBlockEditingRef を使って stale closure を回避する。
  // 編集中の場合は編集終了 → 300ms 後に実行（keyboardRef の focus 復元を待つ）。
  const handleRun = useCallback(() => {
    if (PRO_LANGUAGES.includes(block.language) && !isPro) {
      setProModalVisible(true);
      return;
    }
    if (isRunning) return;
    suppress?.(); // カードフリップを抑制
    const wasThisEditing = isEditingRef.current;
    if (wasThisEditing) {
      isEditingRef.current = false;
      intentionalExitRef.current = true;
      setIsEditing(false);
      onEditBlur?.();
      // switchingCodeBlockRef ガードを迂回してキーボードフォーカスを確実に復元する
      onForceKeyboardFocus?.();
    }
    const anotherWasEditing = anotherBlockEditingRef.current;
    onRunRequest?.(); // 別ブロックが編集中なら終了させる
    onSelectRequest?.();
    const content =
      editable && editedContent !== undefined ? editedContent : block.content;
    // 045: デッキ側は deckSqlStageId で選ばれた1つ（未指定＝先頭・削除済み参照は積まない）。
    // htmlInits と同じく **block 丸ごとではなく必要な2フィールドだけ**渡す（依存配列を最小に保つ）
    const sqlInits =
      block.language === 'sql'
        ? [
            resolveDeckStageSql(deckSqlStages, { deckSqlStageId: block.deckSqlStageId, noDeckSqlInit: block.noDeckSqlInit }),
            block.sqlInit ?? '',
          ]
        : undefined;
    if (wasThisEditing || anotherWasEditing) {
      // keyboard TextInput の focus 復元を待ってから WebView をマウントする
      setTimeout(() => run(content, block.language, sqlInits, htmlInits, deckHtmlImages), 300);
    } else {
      run(content, block.language, sqlInits, htmlInits, deckHtmlImages);
    }
  }, [
    isRunning,
    isPro,
    suppress,
    editable,
    editedContent,
    block.content,
    block.language,
    block.sqlInit,
    block.deckSqlStageId,
    block.noDeckSqlInit,
    deckSqlStages,
    htmlInits,
    deckHtmlImages,
    run,
    onEditBlur,
    onForceKeyboardFocus,
    onSelectRequest,
    onRunRequest,
  ]);

  // RNGH worklet の stale capture を防ぐための安定した ref パターン
  // handleRun は deps が変わるたびに再生成されるが、callHandleRun は常に同じ参照を保つ。
  // worklet は callHandleRun を capture するだけでよく、最新の handleRun は ref 経由で参照される。
  const handleRunRef = useRef(handleRun);
  handleRunRef.current = handleRun; // 毎レンダーで最新版に更新
  const callHandleRun = useCallback(() => { handleRunRef.current(); }, []);

  // パレット onTouchStart: タッチ開始時点でフラグをセットし onBlur の誤終了を防ぐ
  // 200ms 後に自動リセット（onBlur タイマー 50ms より長く保持することで、
  // rAF 内の focus() → onFocus によるリセットより後まで true を維持できる）
  const handlePaletteTouchStart = useCallback(() => {
    paletteActiveRef.current = true;
    setTimeout(() => { paletteActiveRef.current = false; }, 200);
    suppress?.();
  }, [suppress]);

  const handleCodeCopy = useCallback(async () => {
    await Clipboard.setStringAsync(editedContent ?? block.content);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1000);
  }, [editedContent, block.content]);

  const editGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(10)
        .onEnd(() => runOnJS(handleEditToggle)()),
    [handleEditToggle],
  );

  const runGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(10)
        .enabled(!isRunning)
        .onEnd(() => runOnJS(callHandleRun)()),
    [isRunning, callHandleRun],
  );

  const copyGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(10)
        .onEnd(() => runOnJS(handleCodeCopy)()),
    [handleCodeCopy],
  );

  // コード本体（表示中）タップで編集へ。editable のときだけ有効化し、
  // それ以外はタップを親の FlipCard へ通してカードを裏返せるようにする。
  const codeAreaGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(10)
        .enabled(!!editable)
        .onEnd(() => runOnJS(handleCodeAreaTap)()),
    [editable, handleCodeAreaTap],
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.cardTheme.codeBackground },
        isRunning && { borderWidth: 2, borderColor: "#43A047" },
        isEditing && { borderWidth: 2, borderColor: "#FB8C00" },
        isSelected &&
          !isEditing &&
          !isRunning && { borderWidth: 2, borderColor: theme.colors.primary },
      ]}
    >
      {/* ヘッダー */}
      <View
        style={[
          styles.header,
          isRunning && { backgroundColor: CODE_STATE_HEADERS[theme.dark ? 'dark' : 'light'].running },
          isEditing && { backgroundColor: CODE_STATE_HEADERS[theme.dark ? 'dark' : 'light'].editing },
          isSelected && !isEditing && !isRunning && { backgroundColor: CODE_STATE_HEADERS[theme.dark ? 'dark' : 'light'].focus },
        ]}
      >
        <Pressable
          style={styles.langLabelArea}
          onTouchStart={() => { if (isEditingRef.current) suppress?.(); }}
          onPress={() => { if (isEditingRef.current) handleEditEnd(); }}
        >
          <Text style={[styles.langLabel, { fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {LANG_LABELS[block.language] ?? block.language}
          </Text>
        </Pressable>

        <View style={styles.headerRight}>
          {editable && (
            <GestureDetector gesture={editGesture}>
              <TouchableOpacity
                style={[
                  styles.editBtn,
                  { paddingVertical: Math.round(theme.fontSize.xs * 0.58), paddingHorizontal: theme.fontSize.sm },
                  isEditing && styles.editBtnActive,
                ]}
                activeOpacity={0.7}
              >
                {isEditing ? (
                  <Ionicons name="checkmark-sharp" size={Math.round(theme.fontSize.lg)} color="#9CDCFE" />
                ) : (
                  <Ionicons name="pencil-sharp" size={Math.round(theme.fontSize.lg)} color="#9CDCFE" />
                )}
              </TouchableOpacity>
            </GestureDetector>
          )}

          {block.executable && (
            <GestureDetector gesture={runGesture}>
              <TouchableOpacity
                style={[
                  styles.runBtn,
                  { paddingVertical: Math.round(theme.fontSize.xs * 0.58), paddingHorizontal: Math.round(theme.fontSize.sm * 1.5) },
                  isRunning && styles.runBtnDisabled,
                ]}
                activeOpacity={0.7}
                disabled={isRunning}
              >
                {isRunning ? (
                  <ActivityIndicator
                    size="small"
                    color="#FFF"
                    style={styles.spinner}
                  />
                ) : (
                  <Ionicons name="caret-forward" size={Math.round(theme.fontSize.lg)} color="#FFF" />
                )}
              </TouchableOpacity>
            </GestureDetector>
          )}
        </View>
      </View>

      {/* コード表示 / 編集 */}
      <View style={styles.codeArea}>
        {editable && isEditing ? (
          <TextInput
            ref={codeInputRef}
            style={[styles.codeText, styles.codeInput, { fontSize: theme.fontSize.md, lineHeight: theme.fontSize.md * 1.57 }]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            value={editedContent ?? block.content}
            selection={selection}
            onChangeText={onContentChange}
            onSelectionChange={handleSelectionChange}
            multiline
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            keyboardType="default"
            showSoftInputOnFocus={true}
            onFocus={() => {
              intentionalExitRef.current = false;
              // paletteActiveRef はここでリセットしない。
              // insertPair 内の focus() がこの onFocus を発火させるため、
              // ここでリセットすると onBlur タイマー（50ms）が発火する前に
              // paletteActiveRef が false になり handleEditEnd() が誤呼出しされる。
              // 代わりに handlePaletteTouchStart 内の 200ms タイマーでリセットする。
            }}
            onKeyPress={({ nativeEvent }) => {
              const { key } = nativeEvent;
              // 編集中に Tab キーが押された場合は onBlur での実行を抑制する
              if (key === "Tab") {
                intentionalExitRef.current = true;
              }
            }}
            onBlur={() => {
              // 外タップ等でフォーカスが外れた場合は編集終了のみ（実行しない）
              // 完了ボタン・▶実行ボタン・Tab キー経由は intentionalExitRef で防ぐ
              // パレットタップ経由は paletteActiveRef で防ぐ
              // （handlePaletteTouchStart の 200ms タイマーが onBlur の 50ms タイマーより
              //   長く paletteActiveRef=true を保持するため、onFocus によるリセットに依存しない）
              setTimeout(() => {
                if (!intentionalExitRef.current && !paletteActiveRef.current) {
                  handleEditEnd();
                }
                intentionalExitRef.current = false;
              }, 50);
            }}
          />
        ) : (
          <GestureDetector gesture={codeAreaGesture}>
            {/* alwaysBounceHorizontal={false}：コードが幅に収まっているときは横ドラッグを
                掴まない＝その上でもカード送りのスワイプ（useSwipeGesture）が通る。既定の true だと
                スクロールの余地が無くてもドラッグを取り、コード領域が横スワイプの死角になる。 */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} alwaysBounceHorizontal={false}>
              <SyntaxHighlightedCode
                code={editedContent ?? block.content}
                language={block.language}
                wrap={false}
              />
            </ScrollView>
          </GestureDetector>
        )}
        <GestureDetector gesture={copyGesture}>
          <View style={styles.codeCopyBtn}>
            <Ionicons
              name={codeCopied ? "checkmark-sharp" : "copy-outline"}
              size={theme.fontSize.sm}
              color="#4B5563"
            />
          </View>
        </GestureDetector>
      </View>

      <SymbolPalette
        visible={isEditing}
        onInsertPair={insertPair}
        suppress={handlePaletteTouchStart}
        theme={theme}
      />

      {!isEditing && (
        <ExecutionOutput
          result={result}
          liveLogs={liveLogs}
          htmlSource={htmlSource}
          baseUrl={baseUrl}
          previewMode={previewMode}
          previewSource={previewSource}
          runNonce={runNonce}
          staticPreview={canStaticPreview}
          staticBody={staticBody}
          onInteract={suppress}
          onClear={clear}
          onMessage={handleMessage}
          onExpand={canExpand ? () => { setExpandVisible(true); setPreviewOpen(true); } : undefined}
          deckImages={deckHtmlImages}
          proStageHint={stageDroppedByPro}
        />
      )}
      <InteractivePreviewModal
        visible={expandVisible}
        onClose={() => { setExpandVisible(false); setPreviewOpen(false); }}
        language={block.language}
        body={runBody}
        previewBody={staticBody ?? ''}
        initialRan={execActive}
        stages={stages}
        deckImages={deckHtmlImages}
      />
      <InfoModal
        visible={proModalVisible}
        title={t('code.proTitle')}
        message={t('code.proMessage')}
        onClose={() => setProModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  langLabelArea: {
    flex: 1,
    justifyContent: "center",
  },
  langLabel: {
    color: "#9CDCFE",
    fontWeight: "600",
  },
  editBtn: {
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "#555",
    alignSelf: "stretch",
    justifyContent: "center",
  },
  editBtnActive: {
    backgroundColor: "#2A4A2A",
    borderColor: "#43A047",
  },
  runBtn: {
    backgroundColor: "#1976D2",
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  runBtnDisabled: {
    backgroundColor: "#555",
  },
  spinner: {
    marginHorizontal: 4,
  },
  codeArea: {
    position: "relative",
  },
  codeCopyBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    padding: 4,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 4,
  },
  codeText: {
    fontFamily: "monospace",
    color: "#D4D4D4",
    paddingHorizontal: 12,
    paddingBottom: 12,
    lineHeight: 22,
  },
  codeInput: {
    width: "100%",
    textAlignVertical: "top",
  },
});
