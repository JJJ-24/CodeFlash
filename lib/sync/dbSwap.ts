import { useEffect, useState } from 'react';
import { create } from 'zustand';

interface DbSwapRequest {
  action: () => Promise<void>;
  onDone: (err: Error | null) => void;
}

interface DbSwapState {
  request: DbSwapRequest | null;
}

const useDbSwapInternal = create<DbSwapState>(() => ({ request: null }));

/**
 * iCloud 同期エンジンから呼び出す DB ファイル差し替え要求。
 * RootLayout の useDbSwapController が SQLiteProvider をアンマウントし、
 * action 実行後に再マウントする。
 */
export function requestDbSwap(action: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    useDbSwapInternal.setState({
      request: {
        action,
        onDone: (err) => {
          useDbSwapInternal.setState({ request: null });
          if (err) reject(err);
          else resolve();
        },
      },
    });
  });
}

/**
 * RootLayout 専用のコントローラ。
 * - `swapping` が true の間は SQLiteProvider を描画しない（DB ハンドルを閉じる）
 * - `dbKey` を SQLiteProvider の key に渡すことで、swap 後に新規ハンドルで開き直される
 */
export function useDbSwapController() {
  const [swapping, setSwapping] = useState(false);
  const [dbKey, setDbKey] = useState(0);
  const request = useDbSwapInternal((s) => s.request);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;

    (async () => {
      setSwapping(true);
      // SQLiteProvider のアンマウントが完了するまで 2 フレーム待機
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => setTimeout(r, 50));

      try {
        await request.action();
        if (cancelled) return;
        setDbKey((k) => k + 1);
        // 新しい SQLiteProvider のマウントと onInit 完了を待つ
        await new Promise<void>((r) => setTimeout(r, 200));
        setSwapping(false);
        request.onDone(null);
      } catch (e) {
        if (cancelled) return;
        setSwapping(false);
        request.onDone(e instanceof Error ? e : new Error(String(e)));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [request]);

  return { swapping, dbKey };
}
