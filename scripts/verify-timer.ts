/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 学習タイマー（036/039）の**永続化・復元・日またぎ判定**を Node 上で検証する。
 *
 * この3つは実機だと端末の日付を進めながら「アプリ完全終了 → 起動」を繰り返す必要があり、
 * 確認に時間がかかるわりに取りこぼしやすい（実際、保存の引き金が時刻の変化頼みで
 * 同一ミリ秒だと残り時間が保存されない不具合をここで捕まえた）。
 * `store/studyTimer.ts` は AsyncStorage 以外に RN 依存が無いので、それだけスタブすれば本物を呼べる。
 *
 * 実行: `npm run verify:timer`
 *
 * ⚠️ アプリのモジュールは `import` ではなく `require()` で読む（`import` は巻き上げられ、
 * スタブを入れる前に解決されて落ちる）。db-harness と同じ流儀。
 * ⚠️ 「アプリ再起動」は **require キャッシュを捨てて読み直す**ことで再現する
 * （モジュール評価時に走る復元処理をもう一度走らせるため）。
 */
import { installModuleStubs } from './db-harness';

/** AsyncStorage の中身（アプリを再起動しても残る＝ネイティブ側の代役） */
const store: Record<string, string> = {};
const asyncStorage = {
  __esModule: true,
  default: {
    async getItem(k: string) { return k in store ? store[k] : null; },
    async setItem(k: string, v: string) { store[k] = v; },
    async removeItem(k: string) { delete store[k]; },
  },
};
installModuleStubs({ '@react-native-async-storage/async-storage': asyncStorage });

let fakeNow = new Date('2026-08-24T22:00:00+09:00').getTime();
const realNow = Date.now;
Date.now = () => fakeNow;

const tick = () => new Promise((r) => setTimeout(r, 10));
let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  if (cond) { pass++; console.log('  ✓', label); } else { fail++; console.log('  ✗', label); }
}

async function relaunch() {
  // モジュールキャッシュを捨てて「アプリ再起動」を再現（起動時の復元が走る）
  for (const k of Object.keys(require.cache)) if (k.includes('store/studyTimer')) delete require.cache[k];
  const mod = require('@/store/studyTimer');
  await tick();
  return mod;
}

(async () => {
  console.log('1) 20分タイマーを開始して5分ぶん進め、中断（バックグラウンド）');
  let { useStudyTimerStore } = await relaunch();
  useStudyTimerStore.getState().start(20 * 60_000, { cycleCount: 1, breakMs: 0 });
  fakeNow += 5 * 60_000;
  useStudyTimerStore.getState().setRemainingMs(15 * 60_000);
  useStudyTimerStore.getState().noteActive(Date.now());
  await tick();
  check('保存されている', Object.keys(store).length === 1);

  console.log('2) 同じ日に1時間後、強制終了→再起動');
  fakeNow += 60 * 60_000;
  ({ useStudyTimerStore } = await relaunch());
  check('復元される（running）', useStudyTimerStore.getState().phase === 'running');
  check('残り15分が続く', useStudyTimerStore.getState().remainingMs === 15 * 60_000);

  console.log('3) 翌朝（日をまたぐ）に再起動');
  fakeNow = new Date('2026-08-25T09:00:00+09:00').getTime();
  ({ useStudyTimerStore } = await relaunch());
  check('復元されない（idle）', useStudyTimerStore.getState().phase === 'idle');
  check('保存が消えている', Object.keys(store).length === 0);

  console.log('4) 23:55 に中断 → 0:05 に再起動（猶予10分以内）');
  fakeNow = new Date('2026-08-25T23:55:00+09:00').getTime();
  ({ useStudyTimerStore } = await relaunch());
  useStudyTimerStore.getState().start(20 * 60_000, { cycleCount: 1, breakMs: 0 });
  useStudyTimerStore.getState().setRemainingMs(12 * 60_000);
  useStudyTimerStore.getState().noteActive(Date.now());
  await tick();
  fakeNow = new Date('2026-08-26T00:05:00+09:00').getTime();
  ({ useStudyTimerStore } = await relaunch());
  check('日をまたいでも続き（残り12分）', useStudyTimerStore.getState().remainingMs === 12 * 60_000);

  console.log('5) 同じ状態で 0:20 に再起動（猶予超え）');
  fakeNow = new Date('2026-08-25T23:55:00+09:00').getTime();
  ({ useStudyTimerStore } = await relaunch());
  useStudyTimerStore.getState().start(20 * 60_000, { cycleCount: 1, breakMs: 0 });
  useStudyTimerStore.getState().setRemainingMs(12 * 60_000);
  useStudyTimerStore.getState().noteActive(Date.now());
  await tick();
  fakeNow = new Date('2026-08-26T00:20:00+09:00').getTime();
  ({ useStudyTimerStore } = await relaunch());
  check('リセットされる', useStudyTimerStore.getState().phase === 'idle');

  console.log('6) 休憩中に日をまたいで復帰（休憩はまだ終わっていない）');
  fakeNow = new Date('2026-08-26T23:50:00+09:00').getTime();
  ({ useStudyTimerStore } = await relaunch());
  useStudyTimerStore.getState().start(20 * 60_000, { cycleCount: 4, breakMs: 30 * 60_000 });
  useStudyTimerStore.getState().startBreak(Date.now());
  useStudyTimerStore.getState().noteActive(Date.now());
  await tick();
  fakeNow = new Date('2026-08-27T00:15:00+09:00').getTime();  // 休憩は 0:20 まで
  ({ useStudyTimerStore } = await relaunch());
  check('休憩は継続（running/break）',
    useStudyTimerStore.getState().phase === 'running' && useStudyTimerStore.getState().mode === 'break');

  console.log('7) 終了（finished）は保存しない');
  fakeNow = new Date('2026-08-27T10:00:00+09:00').getTime();
  ({ useStudyTimerStore } = await relaunch());
  useStudyTimerStore.getState().start(20 * 60_000, { cycleCount: 1, breakMs: 0 });
  await tick();
  useStudyTimerStore.getState().finish();
  await tick();
  check('保存が消えている', Object.keys(store).length === 0);

  Date.now = realNow;
  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
})();
