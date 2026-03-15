import { transform } from 'sucrase';
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
import { WebView } from 'react-native-webview';

import { useTheme } from '@/lib/theme';
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

type LogEntry = { type: 'log' | 'error' | 'warn'; text: string };
type ExecStatus = 'idle' | 'running' | 'success' | 'error' | 'timeout';

interface ExecResult {
  status: ExecStatus;
  logs: LogEntry[];
  errorMessage?: string;
}

function buildSandboxHtml(code: string): string {
  const escaped = JSON.stringify(code);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body><script>
(function() {
  window.fetch = undefined;
  window.XMLHttpRequest = undefined;
  window.WebSocket = undefined;
  window.open = undefined;
  window.alert = undefined;

  var _logs = [];
  function fmt(args) {
    return Array.prototype.map.call(args, function(v) {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      if (typeof v === 'object') { try { return JSON.stringify(v); } catch(e) { return String(v); } }
      return String(v);
    }).join(' ');
  }
  console.log   = function() { _logs.push({ type: 'log',   text: fmt(arguments) }); };
  console.error = function() { _logs.push({ type: 'error', text: fmt(arguments) }); };
  console.warn  = function() { _logs.push({ type: 'warn',  text: fmt(arguments) }); };

  var _done = false;
  var _timer = setTimeout(function() {
    if (_done) return;
    _done = true;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'timeout', logs: _logs }));
  }, 5000);

  try {
    (new Function(${escaped}))();
    if (!_done) {
      _done = true;
      clearTimeout(_timer);
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'success', logs: _logs }));
    }
  } catch(e) {
    if (!_done) {
      _done = true;
      clearTimeout(_timer);
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: e.message, logs: _logs }));
    }
  }
})();
<\/script></body></html>`;
}

interface Props {
  block: CodeBlock;
  isPreview: boolean;
  onChange: (patch: Partial<CodeBlock>) => void;
  onDelete: () => void;
}

export function CodeBlockItem({ block, isPreview, onChange, onDelete }: Props) {
  const [langModalVisible, setLangModalVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const [status, setStatus] = useState<ExecStatus>('idle');
  const [result, setResult] = useState<ExecResult | null>(null);
  const [htmlSource, setHtmlSource] = useState<string | null>(null);
  const theme = useTheme();

  function handleRun() {
    setStatus('running');
    setResult(null);

    let code = block.content;
    if (block.language === 'typescript') {
      try {
        code = transform(code, { transforms: ['typescript'] }).code;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus('error');
        setResult({ status: 'error', logs: [], errorMessage: msg });
        return;
      }
    }
    setHtmlSource(buildSandboxHtml(code));
  }

  function handleClear() {
    setStatus('idle');
    setResult(null);
  }

  function handleMessage(event: { nativeEvent: { data: string } }) {
    const data = JSON.parse(event.nativeEvent.data) as {
      type: string;
      logs?: LogEntry[];
      message?: string;
    };
    const newResult: ExecResult = {
      status: data.type as ExecStatus,
      logs: data.logs ?? [],
      errorMessage: data.message,
    };
    setStatus(newResult.status);
    setResult(newResult);
    setHtmlSource(null);
  }

  const isRunning = status === 'running';

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

        <Pressable onPress={onDelete} hitSlop={8} style={styles.deleteBtn}>
          <Text style={styles.deleteBtnText}>✕</Text>
        </Pressable>
      </View>

      {/* コード表示エリア */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <TextInput
          style={[styles.codeInput, isPreview && styles.codePreview]}
          value={block.content}
          onChangeText={(v) =>
            onChange({
              content: v
                .replace(/[\u201c\u201d]/g, '"')
                .replace(/[\u2018\u2019]/g, "'"),
            })
          }
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

      {/* 実行結果 */}
      {result && (
        <View
          style={[
            styles.output,
            result.status === 'error' && styles.outputError,
            result.status === 'timeout' && styles.outputError,
          ]}
        >
          <View style={styles.outputHeader}>
            <Text style={styles.outputTitle}>
              {result.status === 'timeout' ? '⏱ タイムアウト（5秒）' :
               result.status === 'error'   ? '✕ エラー' : '▶ 出力'}
            </Text>
            <Pressable onPress={handleClear} hitSlop={8}>
              <Text style={styles.clearBtn}>✕</Text>
            </Pressable>
          </View>

          {result.status === 'error' && result.errorMessage && (
            <Text style={styles.errorMessage}>{result.errorMessage}</Text>
          )}
          {result.status === 'timeout' && (
            <Text style={styles.errorMessage}>実行が5秒を超えたため中断されました</Text>
          )}
          {result.logs.length === 0 && result.status === 'success' && (
            <Text style={styles.emptyOutput}>（出力なし）</Text>
          )}
          {result.logs.map((log, i) => (
            <Text
              key={i}
              style={[
                styles.logLine,
                log.type === 'error' && styles.logError,
                log.type === 'warn'  && styles.logWarn,
              ]}
            >
              {log.text}
            </Text>
          ))}
        </View>
      )}

      {/* 非表示 WebView（実行エンジン） */}
      {htmlSource && (
        <View style={styles.hiddenWebViewContainer} pointerEvents="none">
          <WebView
            style={styles.hiddenWebView}
            source={{ html: htmlSource }}
            onMessage={handleMessage}
            javaScriptEnabled
            originWhitelist={['*']}
            scrollEnabled={false}
            allowsInlineMediaPlayback={false}
          />
        </View>
      )}

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
    paddingVertical: 6,
    gap: 8,
  },
  langBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  langText: { fontSize: 12, color: '#9CDCFE', fontWeight: '600' },
  langChevron: { fontSize: 10, color: '#9CDCFE' },
  headerRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  execLabel: { fontSize: 11, color: '#9E9E9E' },
  execSwitch: { transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] },
  runBtn: {
    backgroundColor: '#1976D2',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  runBtnDisabled: { backgroundColor: '#555' },
  runBtnText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  spinner: { marginHorizontal: 4 },
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
  output: {
    borderTopWidth: 1,
    borderTopColor: '#333',
    backgroundColor: '#0D1117',
    padding: 10,
    gap: 4,
  },
  outputError: { backgroundColor: '#1A0000' },
  outputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  outputTitle: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
  clearBtn: { fontSize: 12, color: '#4B5563' },
  logLine: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#E5E7EB',
    lineHeight: 20,
  },
  logError: { color: '#F87171' },
  logWarn: { color: '#FBBF24' },
  errorMessage: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#F87171',
    lineHeight: 20,
  },
  emptyOutput: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#4B5563',
    fontStyle: 'italic',
  },
  hiddenWebViewContainer: {
    position: 'absolute',
    top: -500,
    left: -500,
    width: 100,
    height: 100,
    opacity: 0,
  },
  hiddenWebView: { flex: 1 },
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
  langOptionActive: { backgroundColor: '#E3F2FD' },
  langOptionText: { fontSize: 15 },
  langOptionTextActive: { color: '#1976D2', fontWeight: '600' },
});
