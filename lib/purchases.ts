import Purchases, { type PurchasesPackage } from 'react-native-purchases';
import { Platform } from 'react-native';
import { useProStore } from '@/store/pro';

export { type PurchasesPackage };

const ENTITLEMENT_ID  = 'Pro';
export const APPLE_API_KEY  = 'appl_XqczZtgVWlvjjltqFwvShBaUuqs';
export const GOOGLE_API_KEY = 'goog_REPLACE_WITH_YOUR_KEY';

export function initializePurchases() {
  const apiKey = Platform.OS === 'ios' ? APPLE_API_KEY : GOOGLE_API_KEY;
  Purchases.configure({ apiKey });
}

export async function restoreProStatus(): Promise<boolean> {
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
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current?.lifetime ?? null;
  } catch {
    return null;
  }
}

export async function purchasePro(pkg: PurchasesPackage): Promise<boolean> {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  const isPro = customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;
  useProStore.getState().setIsPro(isPro);
  return isPro;
}

export async function restorePurchases(): Promise<boolean> {
  const customerInfo = await Purchases.restorePurchases();
  const isPro = customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;
  useProStore.getState().setIsPro(isPro);
  return isPro;
}
