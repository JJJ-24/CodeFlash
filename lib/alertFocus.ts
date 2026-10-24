import { useEffect, useRef, useState } from 'react';
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

/**
 * カーソルを外しても「編集をやめた」と扱わない間 true（`useAlertPresence(visible, { keepEditing: true })`）。
 * ショートカット一覧は閉じれば必ず戻すので、編集をやめて入力欄を片付けると、開くときにブロックが縮み、
 * 閉じたあと少しして伸びる（遅れて見える）。入力欄の onBlur でこれを見て編集を続けたことにすれば、
 * キーボードが下がるだけで済み、閉じたら同じ入力欄へカーソルが戻る（学習画面の CodeRunnerView が使う）。
 */
let keepEditingBlur = false;
export function isBlurKeepingEdit(): boolean {
  return keepEditingBlur;
}

/**
 * keepEditing で外したあと、ブロックが実際に「編集中の見た目」のまま残っている間 true（ブロックの onBlur が
 * `markEditHeld()` で知らせる）。このとき：
 * - 閉じたら**何を選んでも戻す**（`forgetAfterAlert` を効かせない）＝戻さないと、カーソルの無い編集中の見た目のまま
 *   取り残される（タグを付け外した・言語を変えた後など）。編集中のブロックの横での操作なので、戻って続きを書くのが自然
 * - 学習画面はキーボードぶんの下余白を残す（`isEditHeld()`）＝キーボードが下がって余白が消えると、中央寄せの
 *   カードの中身がシートの後ろで下へ動き、閉じると戻る
 * 常にある入力欄（デッキ名・検索欄）は見た目が変わらないので知らせない＝従来どおり「選んだら戻さない」。
 */
let editHeld = false;
export function markEditHeld() {
  editHeld = true;
}
export function isEditHeld(): boolean {
  return editHeld;
}

/** 入力欄にカーソルがあれば、戻し方を控えてから外す。外したら true。 */
function blurForAlert(keepEditing = false): boolean {
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
  if (keepEditing) {
    keepEditingBlur = true;
    // 入力欄の onBlur は少し遅れて判定する（CodeRunnerView は 50ms）ので、それより長く立てておく
    setTimeout(() => { keepEditingBlur = false; }, 300);
  }
  TextInput.State.blurTextInput(input);
  return true;
}

/** キャンセルで閉じたとき：元の編集へ戻す（アラートが閉じ切ってから）。 */
export function restoreAfterAlert() {
  if (!pendingRestore) return;
  setTimeout(() => {
    // まだ上に何か開いている（一覧の中で出した削除の確認をキャンセルした等）＝一番下が閉じたときに戻す
    if (openAlerts > 0) return;
    const r = pendingRestore;
    pendingRestore = null;
    editHeld = false;
    r?.();
  }, 100);
}

/** 選択肢を実行したとき：戻さずに忘れる。 */
export function forgetAfterAlert() {
  if (editHeld) return; // 編集中の見た目のまま残っている＝戻す（上の editHeld の説明）
  pendingRestore = null;
}

/** カーソルを外してから見た目が落ち着くまでの待ち。 */
const PRESENT_DELAY_MS = 100;

/**
 * アラートの表示を管理する。`visible` になったら、入力欄にカーソルがあれば外して少し待ってから true を返す
 * （無ければすぐ true）。アラートの `Modal` の `visible` にはこの戻り値を渡す。
 */
export function useAlertPresence(visible: boolean, opts?: { keepEditing?: boolean; always?: boolean }): boolean {
  const keepEditing = opts?.keepEditing === true;
  // always＝キーボードショートカットが OFF でも外して戻す（タップで開く一覧・シート。開く側が元々
  // Keyboard.dismiss() していた＝OFF でもキーボードを下げる必要がある）。アラートは OFF なら何もしない
  const enabled = useSettingsStore((s) => s.keyboardShortcutsEnabled) || opts?.always === true;
  const [shown, setShown] = useState(
    () => visible && !(enabled && TextInput.State.currentlyFocusedInput()),
  );
  useEffect(() => {
    if (!visible) { setShown(false); return; }
    openAlerts += 1;
    // 最初のアラートが開くときに控えを取り直す（前のアラートが onClose を通らずに閉じて残った控えで、
    // 別の画面の入力欄へ戻さないため）。重なったアラートは最初の控えを引き継ぐ。
    if (openAlerts === 1) { pendingRestore = null; editHeld = false; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    // keepEditing は見た目が変わらない（編集の見た目のまま）ので待たずに出す
    if (enabled && blurForAlert(keepEditing) && !keepEditing) timer = setTimeout(() => setShown(true), PRESENT_DELAY_MS);
    else setShown(true);
    return () => {
      if (timer) clearTimeout(timer);
      openAlerts -= 1;
    };
  }, [visible, enabled, keepEditing]);
  return visible && shown;
}

/**
 * タップで開く一覧・シート（裏に入力欄が残りうるもの）用。開いたらカーソルを外し、閉じたら戻す。
 * **何かを選んだら `forgetAfterAlert()` を呼ぶ**＝戻さない（選んだ結果を見たい場面でキーボードが出ないように＝
 * アラートの「実行したら戻さない」と同じ規則）。RN の `Modal` は返り値を `visible` に、`restoreAfterAlert` を
 * `onDismiss` に渡す（閉じ終わってから戻す）。重ねた View のシートは `restoreOnHide: true`＝隠れたら戻す。
 */
export function useOverlayFocus(visible: boolean, opts?: { keepEditing?: boolean; restoreOnHide?: boolean }): boolean {
  const shown = useAlertPresence(visible, { keepEditing: opts?.keepEditing, always: true });
  const wasVisible = useRef(visible);
  const restoreOnHide = opts?.restoreOnHide === true;
  useEffect(() => {
    if (restoreOnHide && wasVisible.current && !visible) restoreAfterAlert();
    wasVisible.current = visible;
  }, [visible, restoreOnHide]);
  return shown;
}
