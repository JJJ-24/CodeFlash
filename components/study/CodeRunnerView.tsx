import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

import { useTranslation } from "react-i18next";

import { ExecutionOutput } from "@/components/code/ExecutionOutput";
import { SymbolPalette } from "@/components/code/SymbolPalette";
import { SyntaxHighlightedCode } from "@/components/study/SyntaxHighlightedCode";
import { useCodeExecution } from "@/hooks/useCodeExecution";
import { useInsertPair } from "@/hooks/useInsertPair";
import { LANG_LABELS } from "@/lib/code-execution/constants";
import { useFlipSuppress } from "@/lib/FlipSuppressContext";
import { useTheme } from "@/lib/theme";
import { useSettingsStore } from "@/store/settings";
import type { CodeBlock } from "@/types";

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
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { suppress } = useFlipSuppress();
  const { keyboardShortcutsEnabled } = useSettingsStore();
  const {
    result,
    htmlSource,
    baseUrl,
    isRunning,
    run,
    clear,
    handleMessage,
    reset,
  } = useCodeExecution(onRunStart);
  const [isEditing, setIsEditing] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const codeInputRef = useRef<TextInput>(null);
  // onBlur での二重実行防止フラグ（完了ボタン・▶実行ボタン押下時はtrueにセット）
  const intentionalExitRef = useRef(false);
  // パレットタップ中フラグ（onTouchStart でセット、onFocus でリセット）
  const paletteActiveRef = useRef(false);
  const { insertPair, selection, handleSelectionChange, initCursorPosition } = useInsertPair(
    editedContent ?? block.content,
    onContentChange ?? (() => {}),
    codeInputRef,
  );

  useEffect(() => {
    reset();
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
    if (editTrigger && editable && !isEditing) {
      onEditRequest?.();
      setIsEditing(true);
      clear();
      onEditFocus?.();
    }
  }, [editTrigger]);

  // 編集終了のみ（実行なし）- 完了ボタン・exitEditTrigger 用
  const handleEditEnd = useCallback(() => {
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
      handleEditEnd();
    } else {
      onEditRequest?.();
      setIsEditing(true);
      clear();
      onEditFocus?.();
    }
  }, [isEditing, handleEditEnd, clear, onEditFocus, onEditRequest]);

  // 編集終了 + 実行 - ▶実行ボタン・r キー・Escape キー用
  const handleRun = useCallback(() => {
    onRunRequest?.();
    onSelectRequest?.();
    if (isEditing) {
      // 編集中の場合のみ onBlur 二重実行防止フラグをセット
      intentionalExitRef.current = true;
      setIsEditing(false);
      onEditBlur?.();
    }
    const content =
      editable && editedContent !== undefined ? editedContent : block.content;
    run(content, block.language);
  }, [
    isEditing,
    editable,
    editedContent,
    block.content,
    block.language,
    run,
    onEditBlur,
    onSelectRequest,
    onRunRequest,
  ]);

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
        .onEnd(() => {
          if (!isRunning) runOnJS(handleRun)();
        }),
    [isRunning, handleRun],
  );

  const copyGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(10)
        .onEnd(() => runOnJS(handleCodeCopy)()),
    [handleCodeCopy],
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.codeBackground },
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
          isRunning && { backgroundColor: '#1E5024' },
          isEditing && { backgroundColor: '#4A3400' },
          isSelected && !isEditing && !isRunning && { backgroundColor: '#1A3050' },
        ]}
      >
        <Text style={styles.langLabel}>
          {LANG_LABELS[block.language] ?? block.language}
        </Text>

        <View style={styles.headerRight}>
          {editable && (
            <GestureDetector gesture={editGesture}>
              <TouchableOpacity
                style={[styles.editBtn, isEditing && styles.editBtnActive]}
                activeOpacity={0.7}
              >
                {isEditing ? (
                  <Text style={[styles.editBtnText, styles.editBtnTextActive]}>{t('code.done')}</Text>
                ) : (
                  <Ionicons name="pencil" size={15} color="#9CDCFE" />
                )}
              </TouchableOpacity>
            </GestureDetector>
          )}

          {block.executable && (
            <GestureDetector gesture={runGesture}>
              <TouchableOpacity
                style={[styles.runBtn, isRunning && styles.runBtnDisabled]}
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
                  <Text style={styles.runBtnText}>{'▶ ' + t('code.run')}</Text>
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
            style={[styles.codeText, styles.codeInput]}
            value={editedContent ?? block.content}
            selection={selection}
            onChangeText={onContentChange}
            onSelectionChange={handleSelectionChange}
            multiline
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            keyboardType={keyboardShortcutsEnabled ? "ascii-capable" : "default"}
            showSoftInputOnFocus={!keyboardShortcutsEnabled}
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <SyntaxHighlightedCode
              code={editedContent ?? block.content}
              language={block.language}
            />
          </ScrollView>
        )}
        <GestureDetector gesture={copyGesture}>
          <View style={styles.codeCopyBtn}>
            <Ionicons
              name={codeCopied ? "checkmark-outline" : "copy-outline"}
              size={14}
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
          htmlSource={htmlSource}
          baseUrl={baseUrl}
          onClear={clear}
          onMessage={handleMessage}
        />
      )}
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
  langLabel: {
    fontSize: 14,
    color: "#9CDCFE",
    fontWeight: "600",
  },
  editBtn: {
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "#555",
  },
  editBtnActive: {
    backgroundColor: "#2A4A2A",
    borderColor: "#43A047",
  },
  editBtnText: {
    color: "#9CDCFE",
    fontSize: 14,
    fontWeight: "600",
  },
  editBtnTextActive: {
    color: "#43A047",
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
  runBtnText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
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
    fontSize: 14,
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
