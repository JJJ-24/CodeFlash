---
name: 学習画面 編集→実行後ショートカット無効バグ（解決済み）
description: 学習画面でコードブロックを編集→実行するとショートカットキーが効かなくなる問題の根本原因と解決策
type: project
---

## 現象（解決済み）

- 編集モード → 実行ボタン：ショートカット無効（**修正済み**）
- 編集モード → 完了 → 実行：ショートカット有効（元から正常）
- 裏面↔メモ欄をまたいで編集→実行：ショートカット無効（**修正済み**）

**Why:** `handleCodeEditBlur` が `setKeyboardInputKey` を呼ぶことで keyboard TextInput をリマウント＋autoFocus させてショートカットを復元する仕組みだが、特定条件でこの呼び出しがスキップされていた。

## 真の根本原因

Edit ボタンを押すと内部で `handleEditRequest` → `makeSelectHandler` → `switchingCodeBlockRef.current = true`（300ms タイマー）がセットされる。

300ms 以内に Run ボタンを押すと `handleCodeEditBlur` 内の `!switchingCodeBlockRef.current` ガードが false になり、`setKeyboardInputKey(k+1)` がスキップされる → keyboard TextInput がリマウントされずフォーカス復元されない → ショートカット無効。

## 解決策（コミット 8659553）

### 核心: `handleForceKeyboardFocus`（session.tsx）

`switchingCodeBlockRef` を完全に無視して強制的にリマウントする専用関数を追加:
```javascript
const handleForceKeyboardFocus = useCallback(() => {
  codeEditingRef.current = false;
  Keyboard.dismiss();
  setKeyboardInputKey((k) => k + 1);
}, []);
```

### 3パターンの対応

**① 同ブロック（編集中に自分の実行ボタン）**
- `CodeRunnerView.handleRun` で `wasThisEditing` が true のとき `onForceKeyboardFocus?.()` を呼ぶ
- 300ms delay で WebView マウント前に keyboard TextInput を autoFocus させる

**② 同 BlocksView 内の別ブロック（ブロック A 編集中にブロック B を実行）**
- `BlocksView.handleRunRequest` で別ブロックが編集中なら `onForceKeyboardFocus?.()` を呼ぶ
- `anotherBlockEditing` prop で CodeRunnerView に通知 → 300ms delay 適用

**③ 他面またぎ（裏面編集中にメモ欄を実行、またはその逆）**
- `makeSelectHandler` に追加:
```javascript
const willExitOtherFace = triggerOther === 'back' || triggerOther === 'memo' ||
  (triggerOther === 'memoIfFlipped' && isFlipped);
if (willExitOtherFace && codeEditingRef.current) {
  handleForceKeyboardFocus();
}
```

### その他の改善（CodeRunnerView.tsx）

- `isEditingRef` を追加 → RNGH worklet の stale closure 回避（`setIsEditing` と常に同期）
- `handleRunRef` + `callHandleRun` パターン → worklet が常に最新の `handleRun` を参照
- run ボタンは編集中でも有効（グレーアウトなし）。`suppress?.()` でカードフリップ抑制

**How to apply:** 解決済み。類似のショートカット不具合が発生した場合は `switchingCodeBlockRef` ガードと `handleForceKeyboardFocus` の呼び出し有無を確認する。
