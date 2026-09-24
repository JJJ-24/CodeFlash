import { Ionicons } from '@expo/vector-icons';

/**
 * コードブロックの実行ボタンの中身。実行前は ▶、実行中は ■（停止）。
 * 実行中もボタンは押せて、押すと中止する（useCodeExecution の stop()）。▶ ⇄ ■ の切り替えは
 * Xcode・VS Code・Jupyter と同じ定番の表現＝「押せば止まる」が形だけで伝わる。
 * 実行中であること自体はヘッダー/枠の緑とログの逐次表示が示すので、スピナーは使わない
 * （スピナーに ■ を重ねる形は放射状の線に埋もれて停止ボタンと気づかれなかった）。
 * 学習画面（CodeRunnerView）と編集画面（CodeBlockItem）で共用。ボタンの背景は実行中 RUN_STOP_BG。
 */
export function RunButtonIcon({ running, size }: { running: boolean; size: number }) {
  return <Ionicons name={running ? 'stop' : 'caret-forward'} size={size} color="#FFF" />;
}

/** 実行中（＝停止ボタン）の背景色。削除ボタンと同じ「止める側」の赤（theme.colors.danger と同値）。 */
export const RUN_STOP_BG = '#E53935';
