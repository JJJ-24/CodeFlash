import { createContext, useContext, type MutableRefObject } from 'react';

interface FlipSuppressContextValue {
  suppress: () => void;
  suppressedRef: MutableRefObject<boolean>;
}

/** コードブロックのボタンなどインタラクティブ要素がタッチされたとき、
 *  カードのフリップを一時的に抑制するための Context */
export const FlipSuppressContext = createContext<FlipSuppressContextValue>({
  suppress: () => {},
  suppressedRef: { current: false },
});

export function useFlipSuppress() {
  return useContext(FlipSuppressContext);
}
