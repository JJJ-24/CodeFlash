import { useState } from 'react';
import {
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

import type { CodeBlock } from '@/types';

const LANGUAGES = [
  'javascript', 'typescript', 'python', 'sql',
  'cpp', 'java', 'swift', 'bash', 'json', 'html', 'css', 'text',
];

const LANG_LABELS: Record<string, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python',
  sql: 'SQL', cpp: 'C++', java: 'Java', swift: 'Swift',
  bash: 'Bash', json: 'JSON', html: 'HTML', css: 'CSS', text: 'Plain',
};

interface Props {
  block: CodeBlock;
  isPreview: boolean;
  onChange: (patch: Partial<CodeBlock>) => void;
  onDelete: () => void;
}

export function CodeBlockItem({ block, isPreview, onChange, onDelete }: Props) {
  const [langModalVisible, setLangModalVisible] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.container, focused && styles.containerFocused]}>
      {/* ヘッダー: 言語選択 / executable / 削除 */}
      <View style={styles.header}>
        <Pressable onPress={() => setLangModalVisible(true)} style={styles.langBtn}>
          <Text style={styles.langText}>{LANG_LABELS[block.language] ?? block.language}</Text>
          <Text style={styles.langChevron}>▾</Text>
        </Pressable>

        <View style={styles.execRow}>
          <Text style={styles.execLabel}>実行</Text>
          <Switch
            value={block.executable}
            onValueChange={(v) => onChange({ executable: v })}
            trackColor={{ true: '#1976D2' }}
            thumbColor="#FFF"
            style={styles.execSwitch}
          />
        </View>

        <Pressable onPress={onDelete} hitSlop={8} style={styles.deleteBtn}>
          <Text style={styles.deleteBtnText}>✕</Text>
        </Pressable>
      </View>

      {/* コード表示エリア */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <TextInput
          style={[styles.codeInput, isPreview && styles.codePreview]}
          value={block.content}
          onChangeText={(v) => onChange({ content: v })}
          multiline
          editable={!isPreview}
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

      {/* 言語選択モーダル */}
      <Modal visible={langModalVisible} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setLangModalVisible(false)}>
          <View style={styles.langModal}>
            <Text style={styles.langModalTitle}>言語を選択</Text>
            {LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang}
                style={[styles.langOption, block.language === lang && styles.langOptionActive]}
                onPress={() => {
                  onChange({ language: lang });
                  setLangModalVisible(false);
                }}
              >
                <Text
                  style={[
                    styles.langOptionText,
                    block.language === lang && styles.langOptionTextActive,
                  ]}
                >
                  {LANG_LABELS[lang]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1E1E1E',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    overflow: 'hidden',
  },
  containerFocused: { borderColor: '#64B5F6' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#2D2D2D',
    gap: 8,
  },
  langBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  langText: { fontSize: 12, color: '#9CDCFE', fontWeight: '600' },
  langChevron: { fontSize: 10, color: '#9CDCFE' },
  execRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  execLabel: { fontSize: 11, color: '#9E9E9E' },
  execSwitch: { transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] },
  deleteBtn: { padding: 2 },
  deleteBtnText: { fontSize: 12, color: '#616161' },
  codeInput: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#D4D4D4',
    fontFamily: 'monospace',
    minHeight: 100,
    minWidth: '100%',
    lineHeight: 22,
  },
  codePreview: { color: '#CE9178' },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  langModal: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    width: 220,
    gap: 4,
    maxHeight: 400,
  },
  langModalTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#212121',
    marginBottom: 8,
    textAlign: 'center',
  },
  langOption: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8 },
  langOptionActive: { backgroundColor: '#E3F2FD' },
  langOptionText: { fontSize: 15, color: '#424242' },
  langOptionTextActive: { color: '#1976D2', fontWeight: '600' },
});
