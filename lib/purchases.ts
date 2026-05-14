import Constants from 'expo-constants';
import Purchases, { type PurchasesPackage } from 'react-native-purchases';
import { Platform } from 'react-native';
import { useProStore } from '@/store/pro';

export { type PurchasesPackage };

const ENTITLEMENT_ID  = 'Pro';
export const APPLE_API_KEY  = 'appl_XqczZtgVWlvjjltqFwvShBaUuqs';
export const GOOGLE_API_KEY = 'goog_REPLACE_WITH_YOUR_KEY';

// Expo Go では native モジュール（react-native-purchases）が使えないため、SDK 呼び出しをスキップする。
// Development Build / TestFlight / 本番では通常通り動作する。
const IS_EXPO_GO = Constants.executionEnvironment === 'storeClient';

export function initializePurchases() {
  if (IS_EXPO_GO) return;
  const apiKey = Platform.OS === 'ios' ? APPLE_API_KEY : GOOGLE_API_KEY;
  Purchases.configure({ apiKey });
}

export async function restoreProStatus(): Promise<boolean> {
  if (IS_EXPO_GO) return useProStore.getState().isPro;
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    const isPro = customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;
    useProStore.getState().setIsPro(isPro);
    return isPro;
  } catch {
    return useProStore.getState().isPro;
  }
}

export async function fetchOfferings(): Promise<PurchasesPackage | null> {
  if (IS_EXPO_GO) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current?.lifetime ?? null;
  } catch {
    return null;
  }
}

export async function purchasePro(pkg: PurchasesPackage): Promise<boolean> {
  if (IS_EXPO_GO) {
    useProStore.getState().setIsPro(true);
    return true;
  }
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  const isPro = customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;
  useProStore.getState().setIsPro(isPro);
  return isPro;
}

export async function restorePurchases(): Promise<boolean> {
  if (IS_EXPO_GO) return useProStore.getState().isPro;
  const customerInfo = await Purchases.restorePurchases();
  const isPro = customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;
  useProStore.getState().setIsPro(isPro);
  return isPro;
}
