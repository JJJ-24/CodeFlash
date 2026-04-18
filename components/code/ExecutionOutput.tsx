import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { WebView } from 'react-native-webview';

import type { ExecResult } from '@/lib/code-execution/types';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

function buildCopyText(result: ExecResult): string {
  const lines: string[] = [];
  if (result.errorMessage) lines.push(result.errorMessage);
  result.logs.forEach(l => lines.push(l.text));
  return lines.join('\n');
}

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
  const { t } = useTranslation();
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!result) return;
    await Clipboard.setStringAsync(buildCopyText(result));
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  }, [result]);

  const clearGesture = useMemo(
    () => Gesture.Tap().maxDistance(10).hitSlop(8).onEnd(() => runOnJS(onClear)()),
    [onClear]
  );

  const copyGesture = useMemo(
    () => Gesture.Tap().maxDistance(10).hitSlop(8).onEnd(() => runOnJS(handleCopy)()),
    [handleCopy]
  );

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
            <Text style={[styles.outputTitle, { fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {result.status === 'timeout' ? t('code.timeout') :
               result.status === 'error'   ? t('code.error') : t('code.output')}
            </Text>
            <GestureDetector gesture={clearGesture}>
              <View style={styles.clearBtnWrapper}>
                <Text style={styles.clearBtn} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>✕</Text>
              </View>
            </GestureDetector>
          </View>
          <View style={styles.outputContent}>
            {result.status === 'error' && result.errorMessage && (
              <Text style={[styles.errorMessage, { fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{result.errorMessage}</Text>
            )}
            {result.status === 'timeout' && (
              <Text style={[styles.errorMessage, { fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('code.timeoutMessage')}</Text>
            )}
            {result.logs.length === 0 && result.status === 'success' && (
              <Text style={[styles.emptyOutput, { fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('code.empty')}</Text>
            )}
            {result.logs.map((log, i) => (
              <Text
                key={i}
                style={[
                  styles.logLine,
                  { fontSize: theme.fontSize.md },
                  log.type === 'error' && styles.logError,
                  log.type === 'warn'  && styles.logWarn,
                ]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {log.text}
              </Text>
            ))}
            <GestureDetector gesture={copyGesture}>
              <View style={styles.copyBtn}>
                <Ionicons name={copied ? 'checkmark-outline' : 'copy-outline'} size={theme.fontSize.sm} color="#4B5563" />
              </View>
            </GestureDetector>
          </View>
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
    paddingHorizontal: 2,
    marginBottom: 4,
  },
  outputTitle: {
    color: '#6B7280',
    fontWeight: '600',
  },
  outputContent: {
    position: 'relative',
  },
  copyBtn: {
    position: 'absolute',
    top: 0,
    right: 0,
    padding: 4,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 4,
  },
  clearBtnWrapper: { padding: 2 },
  clearBtn: {
    color: '#4B5563',
  },
  logLine: {
    fontFamily: 'monospace',
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
    color: '#F87171',
    lineHeight: 20,
  },
  emptyOutput: {
    fontFamily: 'monospace',
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
