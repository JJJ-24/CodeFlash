import { transform } from 'sucrase';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import { useTheme } from '@/lib/theme';
import type { CodeBlock } from '@/types';

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
  editable?: boolean;
  editedContent?: string;
  onContentChange?: (text: string) => void;
  onEditFocus?: () => void;
  onEditBlur?: () => void;
}

export function CodeRunnerView({ block, editable, editedContent, onContentChange, onEditFocus, onEditBlur }: Props) {
  const theme = useTheme();
  const [status, setStatus] = useState<ExecStatus>('idle');
  const [result, setResult] = useState<ExecResult | null>(null);
  const [htmlSource, setHtmlSource] = useState<string | null>(null);

  useEffect(() => {
    setStatus('idle');
    setResult(null);
    setHtmlSource(null);
  }, [block.content]);

  function handleRun() {
    setStatus('running');
    setResult(null);

    let code = (editable && editedContent !== undefined) ? editedContent : block.content;
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
    <View style={[styles.container, { backgroundColor: theme.colors.codeBackground }]}>
      {/* 言語ラベル */}
      <View style={styles.header}>
        <Text style={styles.langLabel}>
          {LANG_LABELS[block.language] ?? block.language}
        </Text>

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

      {/* コード表示 / 編集 */}
      {editable ? (
        <TextInput
          style={[styles.codeText, styles.codeInput]}
          value={editedContent ?? block.content}
          onChangeText={onContentChange}
          onFocus={onEditFocus}
          onBlur={onEditBlur}
          multiline
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          keyboardType="ascii-capable"
        />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Text style={styles.codeText}>{block.content}</Text>
        </ScrollView>
      )}

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

      {/* 非表示 WebView（実行エンジン）— 画面外に配置して確実に読み込ませる */}
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
  langLabel: {
    fontSize: 11,
    color: '#9CDCFE',
    fontWeight: '600',
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
  output: {
    borderTopWidth: 1,
    borderTopColor: '#333',
    backgroundColor: '#0D1117',
    padding: 10,
    gap: 4,
  },
  outputError: {
    backgroundColor: '#1A0000',
  },
  outputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  outputTitle: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '600',
  },
  clearBtn: {
    fontSize: 12,
    color: '#4B5563',
  },
  logLine: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#E5E7EB',
    lineHeight: 20,
  },
  logError: {
    color: '#F87171',
  },
  logWarn: {
    color: '#FBBF24',
  },
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
  hiddenWebView: {
    flex: 1,
  },
});
