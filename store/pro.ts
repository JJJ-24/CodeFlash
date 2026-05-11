import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const PRO_STORAGE_KEY = '@codeflash_is_pro';

interface ProState {
  isPro: boolean;
  hydrated: boolean;
  setIsPro: (v: boolean) => void;
}

export const useProStore = create<ProState>((set) => ({
  isPro: false,
  hydrated: false,
  setIsPro: (v) => {
    set({ isPro: v });
    AsyncStorage.setItem(PRO_STORAGE_KEY, String(v));
  },
}));

AsyncStorage.getItem(PRO_STORAGE_KEY).then((stored) => {
  useProStore.setState({ isPro: stored === 'true', hydrated: true });
});
