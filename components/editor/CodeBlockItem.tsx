import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState, useCallback } from 'react';
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

import { BlockItemHeader } from './BlockItemHeader';
import { ExecutionOutput } from '@/components/code/ExecutionOutput';
import { SymbolPalette } from '@/components/code/SymbolPalette';
import { SyntaxHighlightedCode } from '@/components/study/SyntaxHighlightedCode';
import { EXECUTABLE_LANGUAGES, LANG_LABELS, LANGUAGES } from '@/lib/code-execution/constants';
import { useCodeExecution } from '@/hooks/useCodeExecution';
import { useInsertPair } from '@/hooks/useInsertPair';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
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
  isLast?: boolean;
  onFocusInput?: () => void;
  autoFocus?: boolean;
  isFocused?: boolean;
  editTrigger?: number;
  onEditBlur?: () => void;
  runTrigger?: number;
  /** スクロール中かどうかを返す（スクロールによる誤フォーカス防止） */
  getIsScrolling?: () => boolean;
}

export function CodeBlockItem({ block, isPreview, onChange, onDelete, onRunStart, onMoveUp, onMoveDown, collapsed, flashTrigger = 0, isLast, onFocusInput, autoFocus, isFocused, editTrigger, onEditBlur, runTrigger, getIsScrolling }: Props) {
  const { t } = useTranslation();
  const [langModalVisible, setLangModalVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const { width } = useWindowDimensions();
  const { result, htmlSource, baseUrl, isRunning, run, clear, reset, handleMessage } = useCodeExecution(onRunStart);
  const isEmpty = block.content.trim() === '';
  const prevCollapsedRef = useRef(collapsed);
  const flashAnim = useRef(new Animated.Value(0)).current;
  const codeInputRef = useRef<TextInput>(null);
  const { insertPair, selection, handleSelectionChange } = useInsertPair(
    block.content,
    (text) => onChange({ content: text }),
    codeInputRef,
  );

  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => codeInputRef.current?.focus(), 50);
    }
  }, []);

  useEffect(() => {
    if ((editTrigger ?? 0) > 0) {
      setTimeout(() => codeInputRef.current?.focus(), 50);
    }
  }, [editTrigger]);

  useEffect(() => {
    if ((runTrigger ?? 0) > 0 && block.executable) {
      run(block.content, block.language);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runTrigger]);

  const theme = useTheme();

  useEffect(() => {
    if (prevCollapsedRef.current === true && collapsed === false) {
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
        isLast={isLast}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        style={{ backgroundColor: isRunning ? '#1E5024' : focused ? '#4A3400' : isFocused ? '#1A3050' : (theme.dark ? '#333333' : '#2D2D2D') }}
      >
        <Pressable onPress={() => setLangModalVisible(true)} style={styles.langBtn}>
          <Text style={[styles.langText, { fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{LANG_LABELS[block.language] ?? block.language}</Text>
          <Text style={[styles.langChevron, { fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>▾</Text>
        </Pressable>

        <View style={styles.headerRight}>
          {!collapsed && EXECUTABLE_LANGUAGES.includes(block.language) && (
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
              onPress={() => run(block.content, block.language)}
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
          {block.content || t('card.emptyCodeBlock')}
        </Text>
      ) : (
        <>
          <View style={styles.codeArea}>
            {isPreview ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <SyntaxHighlightedCode code={block.content} language={block.language} />
              </ScrollView>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <TextInput
                  ref={codeInputRef}
                  style={[styles.codeInput, { fontSize: theme.fontSize.md }]}
                  value={block.content}
                  selection={selection}
                  onChangeText={(v) =>
                    onChange({
                      content: v
                        .replace(/[\u201c\u201d]/g, '"')
                        .replace(/[\u2018\u2019]/g, "'"),
                    })
                  }
                  onSelectionChange={handleSelectionChange}
                  multiline
                  scrollEnabled={false}
                  placeholder={t('card.codePlaceholder')}
                  placeholderTextColor="#6B7280"
                  onFocus={() => {
                    if (getIsScrolling?.()) {
                      setTimeout(() => codeInputRef.current?.blur(), 0);
                      return;
                    }
                    setFocused(true);
                    onFocusInput?.();
                  }}
                  onBlur={() => { setFocused(false); onEditBlur?.(); }}
                  textAlignVertical="top"
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                />
              </ScrollView>
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

          <ExecutionOutput
            result={result}
            htmlSource={htmlSource}
            baseUrl={baseUrl}
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
            <ScrollView>
              {LANGUAGES.map((lang) => (
                <TouchableOpacity
                  key={lang}
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
  collapsedPreview: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    lineHeight: 20,
    color: '#9E9E9E',
    fontFamily: 'monospace',
  },
});
