import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import type { ExecResult } from '@/lib/code-execution/types';

interface Props {
  result: ExecResult | null;
  htmlSource: string | null;
  baseUrl?: string;
  onClear: () => void;
  onMessage: (event: { nativeEvent: { data: string } }) => void;
}

/**
 * コード実行結果の表示と hidden WebView（実行エンジン）を担う共有コンポーネント。
 * CodeRunnerView（学習画面）と CodeBlockItem（エディタ）で共用する。
 */
export function ExecutionOutput({ result, htmlSource, baseUrl, onClear, onMessage }: Props) {
  return (
    <>
      {result && (
        <View
          style={[
            styles.output,
            (result.status === 'error' || result.status === 'timeout') && styles.outputError,
          ]}
        >
          <View style={styles.outputHeader}>
            <Text style={styles.outputTitle}>
              {result.status === 'timeout' ? '⏱ タイムアウト（5秒）' :
               result.status === 'error'   ? '✕ エラー' : '▶ 出力'}
            </Text>
            <Pressable onPress={onClear} hitSlop={8}>
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
            source={{ html: htmlSource, baseUrl: baseUrl ?? 'about:blank' }}
            onMessage={onMessage}
            javaScriptEnabled
            originWhitelist={['*']}
            scrollEnabled={false}
            allowsInlineMediaPlayback={false}
            mixedContentMode="always"
          />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
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
