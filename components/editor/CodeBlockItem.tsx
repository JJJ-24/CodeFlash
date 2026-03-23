import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTranslation } from 'react-i18next';

import { BlockItemHeader } from './BlockItemHeader';
import { ExecutionOutput } from '@/components/code/ExecutionOutput';
import { SyntaxHighlightedCode } from '@/components/study/SyntaxHighlightedCode';
import { EXECUTABLE_LANGUAGES, LANG_LABELS, LANGUAGES } from '@/lib/code-execution/constants';
import { useCodeExecution } from '@/hooks/useCodeExecution';
import { useTheme } from '@/lib/theme';
import { useSettingsStore } from '@/store/settings';
import type { CodeBlock } from '@/types';

interface Props {
  block: CodeBlock;
  isPreview: boolean;
  onChange: (patch: Partial<CodeBlock>) => void;
  onDelete: () => void;
  onRunStart?: () => void;
  onDragStart?: () => void;
  collapsed?: boolean;
  isLast?: boolean;
}

export function CodeBlockItem({ block, isPreview, onChange, onDelete, onRunStart, onDragStart, collapsed, isLast }: Props) {
  const { t } = useTranslation();
  const [langModalVisible, setLangModalVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const { result, htmlSource, baseUrl, isRunning, run, clear, reset, handleMessage } = useCodeExecution(onRunStart);
  const isEmpty = block.content.trim() === '';
  const prevCollapsedRef = useRef(collapsed);

  const theme = useTheme();

  useEffect(() => {
    if (prevCollapsedRef.current === true && collapsed === false) {
      setFocused(false);
    }
    prevCollapsedRef.current = collapsed;
  }, [collapsed]);

  async function handleCodeCopy() {
    await Clipboard.setStringAsync(block.content);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1000);
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.codeBackground, borderColor: theme.dark ? '#3A3A3A' : '#333' }, focused && styles.containerFocused]}>
      <BlockItemHeader
        onDragStart={onDragStart}
        onDelete={onDelete}
        collapsed={collapsed}
        isEmpty={isEmpty}
        isLast={isLast}
        style={{ backgroundColor: theme.dark ? '#333333' : '#2D2D2D' }}
      >
        <Pressable onPress={() => setLangModalVisible(true)} style={styles.langBtn}>
          <Text style={[styles.langText, { fontSize: theme.fontSize.md }]}>{LANG_LABELS[block.language] ?? block.language}</Text>
          <Text style={[styles.langChevron, { fontSize: theme.fontSize.xs }]}>▾</Text>
        </Pressable>

        <View style={styles.headerRight}>
          {EXECUTABLE_LANGUAGES.includes(block.language) && (
            <>
              <Text style={[styles.execLabel, { fontSize: theme.fontSize.sm }]}>{t('code.run')}</Text>
              <Switch
                value={block.executable}
                onValueChange={(v) => onChange({ executable: v })}
                trackColor={{ true: '#1976D2' }}
                thumbColor="#FFF"
                style={styles.execSwitch}
              />
            </>
          )}

          {block.executable && (
            <TouchableOpacity
              style={[styles.runBtn, isRunning && styles.runBtnDisabled]}
              onPress={() => run(block.content, block.language)}
              disabled={isRunning}
            >
              {isRunning
                ? <ActivityIndicator size="small" color="#FFF" style={styles.spinner} />
                : <Text style={[styles.runBtnText, { fontSize: theme.fontSize.md }]}>{'▶ ' + t('code.run')}</Text>
              }
            </TouchableOpacity>
          )}
        </View>
      </BlockItemHeader>

      {/* コード入力エリア */}
      {collapsed ? (
        <Text style={[styles.collapsedPreview, { fontSize: theme.fontSize.sm }]} numberOfLines={2}>
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
                  style={[styles.codeInput, { fontSize: theme.fontSize.md }]}
                  value={block.content}
                  onChangeText={(v) =>
                    onChange({
                      content: v
                        .replace(/[\u201c\u201d]/g, '"')
                        .replace(/[\u2018\u2019]/g, "'"),
                    })
                  }
                  multiline
                  placeholder={t('card.codePlaceholder')}
                  placeholderTextColor="#6B7280"
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  textAlignVertical="top"
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                />
              </ScrollView>
            )}
            <Pressable style={styles.codeCopyBtn} onPress={handleCodeCopy} hitSlop={8}>
              <Ionicons name={codeCopied ? 'checkmark-outline' : 'copy-outline'} size={14} color="#4B5563" />
            </Pressable>
          </View>

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
          <View style={[styles.langModal, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.langModalTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]}>{t('editor.selectLanguage')}</Text>
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
                  >
                    {LANG_LABELS[lang]}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  containerFocused: { borderColor: '#64B5F6' },
  langBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  langText: { color: '#9CDCFE', fontWeight: '600' },
  langChevron: { color: '#9CDCFE' },
  headerRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  execLabel: { color: '#9E9E9E' },
  execSwitch: { transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] },
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
    maxHeight: 320,
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
  langOptionText: {},
  collapsedPreview: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    lineHeight: 20,
    color: '#9E9E9E',
    fontFamily: 'monospace',
  },
});
