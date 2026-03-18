import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
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

import { ExecutionOutput } from '@/components/code/ExecutionOutput';
import { SyntaxHighlightedCode } from '@/components/study/SyntaxHighlightedCode';
import { LANG_LABELS, LANGUAGES } from '@/lib/code-execution/constants';
import { useCodeExecution } from '@/hooks/useCodeExecution';
import { useTheme } from '@/lib/theme';
import type { CodeBlock } from '@/types';

interface Props {
  block: CodeBlock;
  isPreview: boolean;
  onChange: (patch: Partial<CodeBlock>) => void;
  onDelete: () => void;
  onRunStart?: () => void;
}

export function CodeBlockItem({ block, isPreview, onChange, onDelete, onRunStart }: Props) {
  const [langModalVisible, setLangModalVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const { result, htmlSource, baseUrl, isRunning, run, clear, handleMessage } = useCodeExecution(onRunStart);
  const theme = useTheme();

  async function handleCodeCopy() {
    await Clipboard.setStringAsync(block.content);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1000);
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.codeBackground, borderColor: theme.dark ? '#3A3A3A' : '#333' }, focused && styles.containerFocused]}>
      {/* ヘッダー: 言語選択 / executable / 実行 / 削除 */}
      <View style={[styles.header, { backgroundColor: theme.dark ? '#333333' : '#2D2D2D' }]}>
        <Pressable onPress={() => setLangModalVisible(true)} style={styles.langBtn}>
          <Text style={styles.langText}>{LANG_LABELS[block.language] ?? block.language}</Text>
          <Text style={styles.langChevron}>▾</Text>
        </Pressable>

        <View style={styles.headerRight}>
          <Text style={styles.execLabel}>実行</Text>
          <Switch
            value={block.executable}
            onValueChange={(v) => onChange({ executable: v })}
            trackColor={{ true: '#1976D2' }}
            thumbColor="#FFF"
            style={styles.execSwitch}
          />

          {block.executable && (
            <TouchableOpacity
              style={[styles.runBtn, isRunning && styles.runBtnDisabled]}
              onPress={() => run(block.content, block.language)}
              disabled={isRunning}
            >
              {isRunning
                ? <ActivityIndicator size="small" color="#FFF" style={styles.spinner} />
                : <Text style={styles.runBtnText}>▶ 実行</Text>
              }
            </TouchableOpacity>
          )}
        </View>

        <Pressable onPress={onDelete} hitSlop={8} style={styles.deleteBtn}>
          <Text style={styles.deleteBtnText}>✕</Text>
        </Pressable>
      </View>

      {/* コード入力エリア */}
      <View style={styles.codeArea}>
        {isPreview ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <SyntaxHighlightedCode code={block.content} language={block.language} />
          </ScrollView>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <TextInput
              style={styles.codeInput}
              value={block.content}
              onChangeText={(v) =>
                onChange({
                  content: v
                    .replace(/[\u201c\u201d]/g, '"')
                    .replace(/[\u2018\u2019]/g, "'"),
                })
              }
              multiline
              placeholder="コードを入力"
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

      {/* 言語選択モーダル */}
      <Modal visible={langModalVisible} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setLangModalVisible(false)}>
          <View style={[styles.langModal, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.langModalTitle, { color: theme.colors.text }]}>言語を選択</Text>
            <ScrollView>
              {LANGUAGES.map((lang) => (
                <TouchableOpacity
                  key={lang}
                  style={[styles.langOption, block.language === lang && { backgroundColor: theme.colors.primaryLight }]}
                  onPress={() => {
                    onChange({ language: lang });
                    setLangModalVisible(false);
                  }}
                >
                  <Text
                    style={[
                      styles.langOptionText,
                      { color: theme.colors.textSecondary },
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  langBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  langText: { fontSize: 14, color: '#9CDCFE', fontWeight: '600' },
  langChevron: { fontSize: 12, color: '#9CDCFE' },
  headerRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  execLabel: { fontSize: 13, color: '#9E9E9E' },
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
  runBtnText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  spinner: { marginHorizontal: 4 },
  deleteBtn: { padding: 6 },
  deleteBtnText: { fontSize: 16, color: '#616161' },
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
    fontSize: 14,
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
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  langOption: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8 },
  langOptionText: { fontSize: 15 },
});
