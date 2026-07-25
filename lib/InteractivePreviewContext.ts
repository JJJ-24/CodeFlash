import { createContext, useContext } from 'react';

interface InteractivePreviewContextValue {
  /**
   * 全画面インタラクティブプレビュー（041）の開閉を親（学習の session / 編集の BlockEditor）へ伝える。
   * 親はこの bool を見て背後のキー（フリップ/採点/カード送り/戻る・編集キー等）を抑止する。
   * モーダルは同時に1つしか開けないため単一 bool で足りる。
   */
  setOpen: (open: boolean) => void;
}

/** コードブロックの全画面インタラクティブプレビュー（041）の開閉を、深い子（CodeRunnerView /
 *  CodeBlockItem）から親のキー抑止へ伝えるための Context（FlipSuppressContext と同型）。 */
export const InteractivePreviewContext = createContext<InteractivePreviewContextValue>({
  setOpen: () => {},
});

export function useInteractivePreview() {
  return useContext(InteractivePreviewContext);
}
