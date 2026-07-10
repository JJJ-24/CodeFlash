import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

// 旧 isPro（実課金フラグ）と同じキーを踏襲する。従来 setIsPro が保存していたのは
// RevenueCat の実エンタイトルメント＝purchased そのものなので、既存ユーザーの値をそのまま引き継げる。
const PURCHASED_STORAGE_KEY = '@codeflash_is_pro';

interface ProState {
  /** 実効 Pro（purchased || trialActive）。UI・機能ゲートはこの値だけを見る */
  isPro: boolean;
  /** 実課金（RevenueCat エンタイトルメント） */
  purchased: boolean;
  /** トライアル開始時刻（epoch ms）。null = 未体験。体験済み判定にも使う */
  trialStartedAt: number | null;
  /** トライアルが期限内かつ無効化されていないか。判定は lib/proTrial.ts の refreshTrial() が行う */
  trialActive: boolean;
  hydrated: boolean;
  setPurchased: (v: boolean) => void;
  setTrialState: (startedAt: number | null, active: boolean) => void;
}

export const useProStore = create<ProState>((set, get) => ({
  isPro: false,
  purchased: false,
  trialStartedAt: null,
  trialActive: false,
  hydrated: false,
  setPurchased: (v) => {
    set({ purchased: v, isPro: v || get().trialActive });
    AsyncStorage.setItem(PURCHASED_STORAGE_KEY, String(v));
  },
  setTrialState: (startedAt, active) => {
    set({ trialStartedAt: startedAt, trialActive: active, isPro: get().purchased || active });
  },
}));

AsyncStorage.getItem(PURCHASED_STORAGE_KEY).then((stored) => {
  const purchased = stored === 'true';
  useProStore.setState((s) => ({ purchased, isPro: purchased || s.trialActive, hydrated: true }));
});
