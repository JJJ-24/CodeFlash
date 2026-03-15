import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { ExecutionOutput } from '@/components/code/ExecutionOutput';
import { LANG_LABELS } from '@/lib/code-execution/constants';
import { useTheme } from '@/lib/theme';
import { useCodeExecution } from '@/hooks/useCodeExecution';
import type { CodeBlock } from '@/types';

interface Props {
  block: CodeBlock;
  editable?: boolean;
  editedContent?: string;
  onContentChange?: (text: string) => void;
  onEditFocus?: () => void;
  onEditBlur?: () => void;
}

export function CodeRunnerView({ block, editable, editedContent, onContentChange, onEditFocus, onEditBlur }: Props) {
  const theme = useTheme();
  const { result, htmlSource, isRunning, run, clear, handleMessage, reset } = useCodeExecution();
  const [isEditing, setIsEditing] = useState(false);
  const codeInputRef = useRef<TextInput>(null);

  useEffect(() => {
    reset();
    setIsEditing(false);
  }, [block.content]);

  useEffect(() => {
    if (isEditing) {
      setTimeout(() => codeInputRef.current?.focus(), 50);
    }
  }, [isEditing]);

  function handleRun() {
    if (isEditing) {
      setIsEditing(false);
      onEditBlur?.();
    }
    const content = (editable && editedContent !== undefined) ? editedContent : block.content;
    run(content, block.language);
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.codeBackground }]}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <Text style={styles.langLabel}>
          {LANG_LABELS[block.language] ?? block.language}
        </Text>

        <View style={styles.headerRight}>
          {editable && (
            <TouchableOpacity
              style={[styles.editBtn, isEditing && styles.editBtnActive]}
              onPress={() => {
                if (isEditing) {
                  setIsEditing(false);
                  onEditBlur?.();
                } else {
                  setIsEditing(true);
                  onEditFocus?.();
                }
              }}
            >
              <Text style={[styles.editBtnText, isEditing && styles.editBtnTextActive]}>
                {isEditing ? '完了' : '✏'}
              </Text>
            </TouchableOpacity>
          )}

          {block.executable && (
            <TouchableOpacity
              style={[styles.runBtn, isRunning && styles.runBtnDisabled]}
              onPress={handleRun}
              disabled={isRunning}
            >
              {isRunning
                ? <ActivityIndicator size="small" color="#FFF" style={styles.spinner} />
                : <Text style={styles.runBtnText}>▶ 実行</Text>
              }
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* コード表示 / 編集 */}
      {editable && isEditing ? (
        <TextInput
          ref={codeInputRef}
          style={[styles.codeText, styles.codeInput]}
          value={editedContent ?? block.content}
          onChangeText={onContentChange}
          multiline
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          keyboardType="ascii-capable"
        />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Text style={styles.codeText}>{editedContent ?? block.content}</Text>
        </ScrollView>
      )}

      <ExecutionOutput
        result={result}
        htmlSource={htmlSource}
        onClear={clear}
        onMessage={handleMessage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  langLabel: {
    fontSize: 11,
    color: '#9CDCFE',
    fontWeight: '600',
  },
  editBtn: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#555',
  },
  editBtnActive: {
    backgroundColor: '#2A4A2A',
    borderColor: '#43A047',
  },
  editBtnText: {
    color: '#9CDCFE',
    fontSize: 12,
    fontWeight: '600',
  },
  editBtnTextActive: {
    color: '#43A047',
  },
  runBtn: {
    backgroundColor: '#1976D2',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  runBtnDisabled: {
    backgroundColor: '#555',
  },
  runBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  spinner: {
    marginHorizontal: 4,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 14,
    color: '#D4D4D4',
    paddingHorizontal: 12,
    paddingBottom: 12,
    lineHeight: 22,
  },
  codeInput: {
    width: '100%',
    textAlignVertical: 'top',
  },
});
