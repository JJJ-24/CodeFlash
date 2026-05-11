import { useProStore } from '@/store/pro';

export const PRO_PRODUCT_ID = 'codeflash_pro';

// App Store Connect / RevenueCat のキー（TestFlight 接続時に差し替える）
export const APPLE_API_KEY  = 'appl_REPLACE_WITH_YOUR_KEY';
export const GOOGLE_API_KEY = 'goog_REPLACE_WITH_YOUR_KEY';

export type MockPackage = {
  product: { priceString: string; productIdentifier: string };
};

export function initializePurchases() {
  // TestFlight 接続時に react-native-purchases の初期化コードをここに追加する
}

export async function restoreProStatus(): Promise<boolean> {
  return useProStore.getState().isPro;
}

export async function fetchOfferings(): Promise<MockPackage | null> {
  // TestFlight 接続時に RevenueCat の getOfferings() に差し替える
  return { product: { priceString: '¥980', productIdentifier: PRO_PRODUCT_ID } };
}

export async function purchasePro(_pkg: MockPackage): Promise<boolean> {
  // TestFlight 接続時に RevenueCat の purchasePackage() に差し替える
  // 開発中は常に成功扱いにして isPro を true にする
  useProStore.getState().setIsPro(true);
  return true;
}

export async function restorePurchases(): Promise<boolean> {
  // TestFlight 接続時に RevenueCat の restorePurchases() に差し替える
  return useProStore.getState().isPro;
}
