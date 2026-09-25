import { useEffect, useState } from 'react';
import { TextInput } from 'react-native';

import { useSettingsStore } from '@/store/settings';

/**
 * 054：アラート（`ConfirmModal`・`ConfirmDeleteModal`・`InfoModal`）と、裏で編集中の入力欄の受け渡し。
 *
 * **なぜカーソルを外すか**：入力欄にカーソルが入ったままアラートを出すと、入力欄が first responder のまま残り、
 * キーが入力欄に吸われてアラートに届かない（カード編集でブロック編集中に削除/閉じるを押すと J/K も Esc も効かず、
 * J/K は裏の入力欄に文字として入った）。
 *
 * **なぜ表示を遅らせるか**：カーソルを外すとブロックが「編集中の見た目」から戻る（入力欄が片付き装飾パレットも消える）。
 * それをアラートの表示と同時に起こすと画面の大枠が一瞬横へずれるちらつきが出た。先に外して見た目が落ち着いてから出す
 * （Esc で編集をやめてから削除を押したときと同じ順番）。遅らせるのは入力欄にカーソルがあったときだけ。
 *
 * **キャンセルで戻す**：キャンセル（Esc・背景タップ・OK だけのアラートの OK）で閉じたときだけ元の編集へ戻す。
 * 選択肢を実行したとき（削除・破棄・保存など）は戻さない＝削除でブロックが消える・画面が閉じていく途中にキーボードが出るため。
 *
 * カード編集のブロックは**編集をやめると入力欄そのものが消える**（`TextBlockItem`/`CodeBlockItem` は編集中だけ入力欄を置く）ので、
 * 入力欄へ直接カーソルを戻せない。エディタ（`BlockEditor`）が `registerAlertRestoreProvider` で「どのブロックを編集していたか」
 * を覚えて再開する手段を渡す。それ以外の入力欄（常にある入力欄）は、入力欄へ直接フォーカスを戻す。
 *
 * キーボードショートカットが OFF のときは何もしない（カーソルも外さない＝従来どおり）。
 */

type RestoreProvider = () => (() => void) | null;
const providers = new Set<RestoreProvider>();

/** 入力欄の編集を「外してから戻す」手段を持つ部品（エディタ）が登録する。戻り値は登録解除。 */
export function registerAlertRestoreProvider(p: RestoreProvider): () => void {
  providers.add(p);
  return () => { providers.delete(p); };
}

let pendingRestore: (() => void) | null = null;
let openAlerts = 0;

/** 入力欄にカーソルがあれば、戻し方を控えてから外す。外したら true。 */
function blurForAlert(): boolean {
  const input = TextInput.State.currentlyFocusedInput();
  if (!input) return false;
  // ⚠️ 戻し方は**外す前に**聞く（外すとエディタの「編集中のブロック」の記録が消えるため）
  let restore: (() => void) | null = null;
  for (const p of providers) {
    restore = p();
    if (restore) break;
  }
  pendingRestore = restore ?? (() => {
    // 入力欄がその間に消えていても落とさない（戻す先が無いだけ）
    try { TextInput.State.focusTextInput(input); } catch { /* noop */ }
  });
  TextInput.State.blurTextInput(input);
  return true;
}

/** キャンセルで閉じたとき：元の編集へ戻す（アラートが閉じ切ってから）。 */
export function restoreAfterAlert() {
  const r = pendingRestore;
  pendingRestore = null;
  if (r) setTimeout(r, 100);
}

/** 選択肢を実行したとき：戻さずに忘れる。 */
export function forgetAfterAlert() {
  pendingRestore = null;
}

/** カーソルを外してから見た目が落ち着くまでの待ち。 */
const PRESENT_DELAY_MS = 100;

/**
 * アラートの表示を管理する。`visible` になったら、入力欄にカーソルがあれば外して少し待ってから true を返す
 * （無ければすぐ true）。アラートの `Modal` の `visible` にはこの戻り値を渡す。
 */
export function useAlertPresence(visible: boolean): boolean {
  const enabled = useSettingsStore((s) => s.keyboardShortcutsEnabled);
  const [shown, setShown] = useState(
    () => visible && !(enabled && TextInput.State.currentlyFocusedInput()),
  );
  useEffect(() => {
    if (!visible) { setShown(false); return; }
    openAlerts += 1;
    // 最初のアラートが開くときに控えを取り直す（前のアラートが onClose を通らずに閉じて残った控えで、
    // 別の画面の入力欄へ戻さないため）。重なったアラートは最初の控えを引き継ぐ。
    if (openAlerts === 1) pendingRestore = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (enabled && blurForAlert()) timer = setTimeout(() => setShown(true), PRESENT_DELAY_MS);
    else setShown(true);
    return () => {
      if (timer) clearTimeout(timer);
      openAlerts -= 1;
    };
  }, [visible, enabled]);
  return visible && shown;
}
