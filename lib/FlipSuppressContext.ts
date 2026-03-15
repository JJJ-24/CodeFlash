import { createContext, useContext } from 'react';

/** コードブロックのボタンなどインタラクティブ要素がタッチされたとき、
 *  カードのフリップを一時的に抑制するための Context */
export const FlipSuppressContext = createContext<() => void>(() => {});

export function useFlipSuppress() {
  return useContext(FlipSuppressContext);
}
