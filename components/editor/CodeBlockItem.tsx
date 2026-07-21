import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';

import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector, ScrollView as GHScrollView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { BlockItemHeader } from './BlockItemHeader';
import { ExecutionOutput } from '@/components/code/ExecutionOutput';
import { SymbolPalette } from '@/components/code/SymbolPalette';
import { SyntaxHighlightedCode } from '@/components/study/SyntaxHighlightedCode';
import { InfoModal } from '@/components/InfoModal';
import { EXECUTABLE_LANGUAGES, LANG_LABELS, LANGUAGES, PRO_LANGUAGES } from '@/lib/code-execution/constants';
import { useCodeExecution } from '@/hooks/useCodeExecution';
import { useInsertPair } from '@/hooks/useInsertPair';
import { useTheme, MAX_FONT_MULTIPLIER, CODE_STATE_HEADERS } from '@/lib/theme';
import { useProStore } from '@/store/pro';
import { useSettingsStore } from '@/store/settings';
import type { CodeBlock } from '@/types';

interface Props {
  block: CodeBlock;
  isPreview: boolean;
  onChange: (patch: Partial<CodeBlock>) => void;
  onDelete: () => void;
  onRunStart?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  collapsed?: boolean;
  flashTrigger?: number;
  onFocusInput?: () => void;
  autoFocus?: boolean;
  isFocused?: boolean;
  editTrigger?: number;
  onEditBlur?: () => void;
  onRunButtonPress?: () => void;
  runTrigger?: number;
  onAutoFocused?: () => void;
  blurTrigger?: number;
  /** デッキ共通の SQL 初期化（SQL ブロック実行時に本体の前に流す。ブロック固有 sqlInit の前に積まれる） */
  deckSqlInit?: string | null;
  /** デッキ共通の HTML/CSS 土台（web 系ブロックのプレビュー土台。ブロック固有 htmlInit の前に積まれる） */
  deckHtmlInit?: string | null;
}

export function CodeBlockItem({ block, isPreview, onChange, onDelete, onRunStart, onMoveUp, onMoveDown, collapsed, flashTrigger = 0, onFocusInput, autoFocus, isFocused, editTrigger, blurTrigger, onEditBlur, onRunButtonPress, runTrigger, onAutoFocused, deckSqlInit, deckHtmlInit }: Props) {
  const { t } = useTranslation();
  const [langModalVisible, setLangModalVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [proModalVisible, setProModalVisible] = useState(false);
  const isPro = useProStore(s => s.isPro);
  const { width } = useWindowDimensions();
  const { result, htmlSource, baseUrl, previewMode, isRunning, run, clear, reset, handleMessage } = useCodeExecution(onRunStart);
  const isEmpty = block.content.trim() === '';
  const prevCollapsedRef = useRef(collapsed);
  const flashAnim = useRef(new Animated.Value(0)).current;
  const codeInputRef = useRef<TextInput>(null);
  const initSqlInputRef = useRef<TextInput>(null);
  const initHtmlInputRef = useRef<TextInput>(null);
  const [initSqlFocused, setInitSqlFocused] = useState(false);
  const [initHtmlFocused, setInitHtmlFocused] = useState(false);
  // 言語選択モーダルを開いたとき、選択中の言語までスクロールするための ref
  const langScrollRef = useRef<ScrollView>(null);
  const selectedLangYRef = useRef(0);
  const { insertPair, selection, handleSelectionChange, setSelectionToPos } = useInsertPair(
    block.content,
    (text) => onChange({ content: text }),
    codeInputRef,
  );

  const skipEditBlurRef = useRef(false);
  // SQL ブロック固有の初期化SQL欄の開閉（内容があれば初期展開）
  const [showInitSql, setShowInitSql] = useState(!!block.sqlInit);
  // js/ts ブロック固有の HTML/CSS 土台欄の開閉（内容があれば初期展開）
  const [showInitHtml, setShowInitHtml] = useState(!!block.htmlInit);

  const contentRef = useRef(block.content);
  contentRef.current = block.content;

  // SQL 実行時にクエリ本体の前に流す初期化SQL（デッキ共通 → ブロック固有）。SQL 以外は undefined
  const sqlInits = block.language === 'sql' ? [deckSqlInit ?? '', block.sqlInit ?? ''] : undefined;

  // Web 系（html / js・ts）で body 先頭に加算する HTML/CSS 土台（デッキ共通 → ブロック固有）。
  // html はブロック土台を持たない（本文が主役）ためデッキ土台のみ。それ以外の言語は undefined。
  const htmlInits =
    block.language === 'html' ? [deckHtmlInit ?? '']
    : (block.language === 'javascript' || block.language === 'typescript') ? [deckHtmlInit ?? '', block.htmlInit ?? '']
    : undefined;
  // 「ソース」タブに出す土台テキスト（案a）。非空の土台だけを結合する。
  const previewSource = (htmlInits ?? []).filter((s) => s && s.trim() !== '').join('\n');

  const enterEditMode = useCallback(() => {
    setFocused(true);
    const lastNewline = contentRef.current.lastIndexOf('\n');
    const lastLineStart = lastNewline === -1 ? 0 : lastNewline + 1;
    setSelectionToPos(lastLineStart);
    setTimeout(() => codeInputRef.current?.focus(), 50);
  }, [setSelectionToPos]);

  const tapGesture = useMemo(
    () => Gesture.Tap().maxDeltaX(8).maxDeltaY(8).onEnd(() => { runOnJS(enterEditMode)(); }),
    [enterEditMode],
  );

  useEffect(() => {
    if (autoFocus) { setFocused(true); setTimeout(() => codeInputRef.current?.focus(), 50); onAutoFocused?.(); }
  }, []);

  useEffect(() => {
    if ((editTrigger ?? 0) > 0) { setFocused(true); setTimeout(() => codeInputRef.current?.focus(), 50); }
  }, [editTrigger]);

  useEffect(() => {
    if ((blurTrigger ?? 0) > 0) { codeInputRef.current?.blur(); initSqlInputRef.current?.blur(); initHtmlInputRef.current?.blur(); }
  }, [blurTrigger]);

  // 言語選択モーダルを開いたら選択中の言語が見える位置までスクロールする
  useEffect(() => {
    if (!langModalVisible) return;
    const id = setTimeout(() => {
      langScrollRef.current?.scrollTo({ y: Math.max(0, selectedLangYRef.current - 40), animated: false });
    }, 30);
    return () => clearTimeout(id);
  }, [langModalVisible]);

  useEffect(() => {
    if ((runTrigger ?? 0) > 0 && block.executable) {
      if (PRO_LANGUAGES.includes(block.language) && !isPro) {
        setProModalVisible(true);
        return;
      }
      run(block.content, block.language, sqlInits, htmlInits);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runTrigger]);

  const theme = useTheme();

  useEffect(() => {
    if (isPreview) {
      setFocused(false);
      codeInputRef.current?.blur();
    }
  }, [isPreview]);

  useEffect(() => {
    if (collapsed) {
      setFocused(false);
      codeInputRef.current?.blur();
    } else if (prevCollapsedRef.current === true) {
      setFocused(false);
    }
    prevCollapsedRef.current = collapsed;
  }, [collapsed]);

  useEffect(() => {
    if (flashTrigger > 0) {
      flashAnim.setValue(1);
      Animated.timing(flashAnim, { toValue: 0, duration: 600, useNativeDriver: true }).start();
    }
  }, [flashTrigger]);

  async function handleCodeCopy() {
    await Clipboard.setStringAsync(block.content);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1000);
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.codeBackground, borderColor: isRunning ? '#43A047' : flashTrigger > 0 ? theme.colors.primary : focused ? '#FB8C00' : isFocused ? theme.colors.primary : (theme.dark ? '#3A3A3A' : '#333'), borderWidth: (isRunning || focused || isFocused) ? 2 : 1 }]}>
      <BlockItemHeader
        onDelete={onDelete}
        collapsed={collapsed}
        isEmpty={isEmpty}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onHeaderPress={(focused || initSqlFocused || initHtmlFocused) ? () => { codeInputRef.current?.blur(); initSqlInputRef.current?.blur(); initHtmlInputRef.current?.blur(); } : undefined}
        hideDelete={isPreview}
        style={{ backgroundColor: isRunning ? CODE_STATE_HEADERS[theme.dark ? 'dark' : 'light'].running : focused ? CODE_STATE_HEADERS[theme.dark ? 'dark' : 'light'].editing : isFocused ? CODE_STATE_HEADERS[theme.dark ? 'dark' : 'light'].focus : (theme.dark ? '#333333' : '#2D2D2D') }}
      >
        {isPreview ? (
          <View style={styles.langBtn}>
            <Text style={[styles.langText, { fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{LANG_LABELS[block.language] ?? block.language}</Text>
          </View>
        ) : (
          <Pressable onPress={() => setLangModalVisible(true)} style={styles.langBtn}>
            <Text style={[styles.langText, { fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{LANG_LABELS[block.language] ?? block.language}</Text>
            <Text style={[styles.langChevron, { fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>▾</Text>
          </Pressable>
        )}

        <View style={styles.headerRight}>
          {!collapsed && !isPreview && EXECUTABLE_LANGUAGES.includes(block.language) && (
            <>
              {!block.executable && <Text style={[styles.execLabel, { fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('code.run')}</Text>}
              <Switch
                value={block.executable}
                onValueChange={(v) => onChange({ executable: v })}
                trackColor={{ true: '#1976D2' }}
                thumbColor="#FFF"
                style={styles.execSwitch}
              />
            </>
          )}

          {!collapsed && block.executable && (
            <TouchableOpacity
              style={[styles.runBtn, { paddingHorizontal: Math.round(theme.fontSize.sm * 1.5) }, isRunning && styles.runBtnDisabled]}
              onPress={() => {
                if (PRO_LANGUAGES.includes(block.language) && !isPro) {
                  setProModalVisible(true);
                  return;
                }
                if (focused) {
                  skipEditBlurRef.current = true;
                  codeInputRef.current?.blur();
                  setFocused(false);
                }
                onRunButtonPress?.();
                run(block.content, block.language, sqlInits, htmlInits);
              }}
              disabled={isRunning}
            >
              {isRunning
                ? <ActivityIndicator size="small" color="#FFF" style={styles.spinner} />
                : <Ionicons name="caret-forward" size={Math.round(theme.fontSize.lg)} color="#FFF" />
              }
            </TouchableOpacity>
          )}
        </View>
      </BlockItemHeader>

      {/* コード入力エリア */}
      {collapsed ? (
        <Text style={[styles.collapsedPreview, { fontSize: theme.fontSize.sm }]} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
          {block.content || t('editor.emptyCodeBlock')}
        </Text>
      ) : (
        <>
          <View style={styles.codeArea}>
            {isPreview ? (
              <GHScrollView horizontal showsHorizontalScrollIndicator={false}>
                <SyntaxHighlightedCode code={block.content} language={block.language} wrap={false} />
              </GHScrollView>
            ) : focused ? (
              <ScrollView horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} style={{ width: width - 32 }}>
                <TextInput
                  ref={codeInputRef}
                  style={[styles.codeInput, { fontSize: theme.fontSize.md, width: width - 32 }]}
                  value={block.content}
                  selection={selection}
                  onChangeText={(v) =>
                    onChange({
                      content: v
                        .replace(/[\u201c\u201d]/g, '"')
                        .replace(/[\u2018\u2019]/g, "'")
                        .replace(/[\u2028\u2029]/g, '\n'),
                    })
                  }
                  onSelectionChange={handleSelectionChange}
                  multiline
                  scrollEnabled={false}
                  placeholder={t('editor.codePlaceholder')}
                  placeholderTextColor="#6B7280"
                  onFocus={() => { setFocused(true); onFocusInput?.(); }}
                  onBlur={() => { setFocused(false); if (!skipEditBlurRef.current) { onEditBlur?.(); } skipEditBlurRef.current = false; }}
                  textAlignVertical="top"
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                />
              </ScrollView>
            ) : (
              <GestureDetector gesture={tapGesture}>
                {isEmpty ? (
                  <Text style={[styles.codeEmptyPrompt, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                    {t('editor.codePlaceholder')}
                  </Text>
                ) : (
                  <View style={{ minHeight: 56 }}>
                    <SyntaxHighlightedCode code={block.content} language={block.language} />
                  </View>
                )}
              </GestureDetector>
            )}
            <Pressable style={styles.codeCopyBtn} onPress={handleCodeCopy} hitSlop={8}>
              <Ionicons name={codeCopied ? 'checkmark-sharp' : 'copy-outline'} size={theme.fontSize.sm} color="#4B5563" />
            </Pressable>
          </View>

          <SymbolPalette
            visible={focused && !isPreview}
            onInsertPair={insertPair}
            theme={theme}
          />

          {/* SQL ブロック固有の初期化SQL（クエリ本体の前にデッキ共通の後で流す）。SQL は Pro 機能のため非Proでは非表示 */}
          {block.language === 'sql' && isPro && (
            <View style={[styles.initSqlSection, { borderTopColor: theme.colors.border }]}>
              <Pressable style={styles.initSqlHeader} onPress={() => setShowInitSql((v) => !v)} hitSlop={6}>
                <Ionicons name={showInitSql ? 'chevron-down' : 'chevron-forward'} size={theme.fontSize.sm} color="#C9C9C9" />
                <Text style={{ color: '#C9C9C9', fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {t('editor.sqlInitLabel')}
                </Text>
                {!!block.sqlInit && !showInitSql && <View style={[styles.initSqlDot, { backgroundColor: theme.colors.primary }]} />}
              </Pressable>
              {showInitSql && (
                isPreview ? (
                  block.sqlInit ? (
                    <GHScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <SyntaxHighlightedCode code={block.sqlInit} language="sql" wrap={false} />
                    </GHScrollView>
                  ) : (
                    <Text style={{ color: '#9CA3AF', fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                      {t('editor.sqlInitEmpty')}
                    </Text>
                  )
                ) : (
                  <>
                    <Text style={{ color: '#9CA3AF', fontSize: theme.fontSize.xs, marginBottom: 4 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {t('editor.sqlInitHint')}
                    </Text>
                    <TextInput
                      ref={initSqlInputRef}
                      style={[styles.initSqlInput, { fontSize: theme.fontSize.sm, color: '#D4D4D4', backgroundColor: 'rgba(0,0,0,0.25)', borderColor: '#3A3A3A' }]}
                      value={block.sqlInit ?? ''}
                      onChangeText={(v) => onChange({ sqlInit: v })}
                      onFocus={() => { setInitSqlFocused(true); onFocusInput?.(); }}
                      onBlur={() => { setInitSqlFocused(false); onEditBlur?.(); }}
                      multiline
                      placeholder={t('editor.sqlInitPlaceholder')}
                      placeholderTextColor="#6B7280"
                      textAlignVertical="top"
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                    />
                  </>
                )
              )}
            </View>
          )}

          {/* js/ts ブロック固有の HTML/CSS 土台（web プレビューの土台。デッキ共通の後に積む）。Pro 機能のため非Proでは非表示 */}
          {(block.language === 'javascript' || block.language === 'typescript') && isPro && (
            <View style={[styles.initSqlSection, { borderTopColor: theme.colors.border }]}>
              <Pressable style={styles.initSqlHeader} onPress={() => setShowInitHtml((v) => !v)} hitSlop={6}>
                <Ionicons name={showInitHtml ? 'chevron-down' : 'chevron-forward'} size={theme.fontSize.sm} color="#C9C9C9" />
                <Text style={{ color: '#C9C9C9', fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {t('editor.htmlInitLabel')}
                </Text>
                {!!block.htmlInit && !showInitHtml && <View style={[styles.initSqlDot, { backgroundColor: theme.colors.primary }]} />}
              </Pressable>
              {showInitHtml && (
                isPreview ? (
                  block.htmlInit ? (
                    <GHScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <SyntaxHighlightedCode code={block.htmlInit} language="html" wrap={false} />
                    </GHScrollView>
                  ) : (
                    <Text style={{ color: '#9CA3AF', fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                      {t('editor.htmlInitEmpty')}
                    </Text>
                  )
                ) : (
                  <>
                    <Text style={{ color: '#9CA3AF', fontSize: theme.fontSize.xs, marginBottom: 4 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {t('editor.htmlInitHint')}
                    </Text>
                    <TextInput
                      ref={initHtmlInputRef}
                      style={[styles.initSqlInput, { fontSize: theme.fontSize.sm, color: '#D4D4D4', backgroundColor: 'rgba(0,0,0,0.25)', borderColor: '#3A3A3A' }]}
                      value={block.htmlInit ?? ''}
                      onChangeText={(v) => onChange({ htmlInit: v })}
                      onFocus={() => { setInitHtmlFocused(true); onFocusInput?.(); }}
                      onBlur={() => { setInitHtmlFocused(false); onEditBlur?.(); }}
                      multiline
                      placeholder={t('editor.htmlInitPlaceholder')}
                      placeholderTextColor="#6B7280"
                      textAlignVertical="top"
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                    />
                  </>
                )
              )}
            </View>
          )}

          <ExecutionOutput
            result={result}
            htmlSource={htmlSource}
            baseUrl={baseUrl}
            previewMode={previewMode}
            previewSource={previewSource}
            onClear={clear}
            onMessage={handleMessage}
          />
        </>
      )}

      {/* 言語選択モーダル */}
      <Modal visible={langModalVisible} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setLangModalVisible(false)}>
          <View style={[styles.langModal, { backgroundColor: theme.colors.surface, width: Math.max(220, width * 0.5) }]}>
            <Text style={[styles.langModalTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('editor.selectLanguage')}</Text>
            <ScrollView ref={langScrollRef}>
              {LANGUAGES.map((lang) => (
                <TouchableOpacity
                  key={lang}
                  onLayout={block.language === lang ? (e) => { selectedLangYRef.current = e.nativeEvent.layout.y; } : undefined}
                  style={[styles.langOption, block.language === lang && { backgroundColor: theme.colors.primaryLight }]}
                  onPress={() => {
                    if (!EXECUTABLE_LANGUAGES.includes(lang)) reset();
                    onChange({
                      language: lang,
                      ...(!EXECUTABLE_LANGUAGES.includes(lang) && { executable: false }),
                    });
                    useSettingsStore.getState().setLastSelectedCodeLanguage(lang);
                    setLangModalVisible(false);
                  }}
                >
                  <Text
                    style={[
                      styles.langOptionText,
                      { color: theme.colors.textSecondary, fontSize: theme.fontSize.md },
                      block.language === lang && { color: theme.colors.primary, fontWeight: '600' },
                    ]}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                  >
                    {LANG_LABELS[lang]}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: flashAnim, backgroundColor: theme.colors.primaryLight, borderRadius: 10 }]}
        pointerEvents="none"
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
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
langBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  langText: { color: '#9CDCFE', fontWeight: '600' },
  langChevron: { color: '#9CDCFE' },
  headerRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  execLabel: { color: '#9E9E9E' },
  execSwitch: { transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }], alignSelf: 'center' },
  runBtn: {
    backgroundColor: '#1976D2',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  runBtnDisabled: { backgroundColor: '#555' },
  runBtnText: { color: '#FFF', fontWeight: '600' },
  spinner: { marginHorizontal: 4 },
  codeArea: {
    position: 'relative',
  },
  codeCopyBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 4,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 4,
  },
  codeInput: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#D4D4D4',
    fontFamily: 'monospace',
    minHeight: 100,
    minWidth: '100%',
    lineHeight: 22,
  },
  initSqlSection: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  initSqlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
  },
  initSqlDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 2,
  },
  initSqlInput: {
    fontFamily: 'monospace',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 70,
    lineHeight: 20,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  langModal: {
    borderRadius: 12,
    padding: 16,
    width: 220,
    gap: 4,
    maxHeight: 400,
  },
  langModalTitle: {
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  langOption: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8 },
  langOptionText: {},
  collapsedPreview: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    lineHeight: 20,
    color: '#9E9E9E',
    fontFamily: 'monospace',
  },
  codeEmptyPrompt: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 56,
    lineHeight: 22,
    fontStyle: 'italic',
  },
});
