import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { constants as KeyCommand } from 'react-native-key-command';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { InfoModal } from '@/components/InfoModal';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { PRIVACY_URL, TERMS_URL } from '@/lib/links';
import { fetchOfferings, purchasePro, restorePurchases, type PurchasesPackage } from '@/lib/purchases';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useProStore } from '@/store/pro';

type Feature = {
  icon: keyof typeof Ionicons.glyphMap;
  titleKey: string;
  descKey: string;
};

const CURRENT_FEATURES: Feature[] = [
  {
    icon: 'cloud-outline',
    titleKey: 'pro.featureICloud',
    descKey:  'pro.featureICloudDesc',
  },
  {
    icon: 'color-palette-outline',
    titleKey: 'pro.featureCustomization',
    descKey:  'pro.featureCustomizationDesc',
  },
  {
    icon: 'bar-chart-outline',
    titleKey: 'pro.featureStats',
    descKey:  'pro.featureStatsDesc',
  },
  {
    icon: 'options-outline',
    titleKey: 'pro.featureFSRS',
    descKey:  'pro.featureFSRSDesc',
  },
  {
    icon: 'terminal-outline',
    titleKey: 'pro.featureSQL',
    descKey:  'pro.featureSQLDesc',
  },
];

export default function PaywallScreen() {
  const { t } = useTranslation();
  const theme  = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isPro } = useProStore();

  const [pkg, setPkg]               = useState<PurchasesPackage | null>(null);
  const [loading, setLoading]       = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring]   = useState(false);
  const [infoModal, setInfoModal]   = useState<{ message: string; onClose?: () => void } | null>(null);
  // 閉じる（null）瞬間にフェード中の中身が空にならないよう、直前の内容を保持する。
  const lastInfoModalRef = useRef<{ message: string; onClose?: () => void } | null>(null);
  if (infoModal) lastInfoModalRef.current = infoModal;

  // Esc / B = 戻る（情報モーダル表示中は先に閉じる）。
  const goBack = () => {
    if (infoModal) { const cb = infoModal.onClose; setInfoModal(null); cb?.(); return; }
    router.back();
  };
  useKeyCommands([
    { input: 'b', handler: goBack },
    { input: KeyCommand.keyInputEscape, handler: goBack },
    // 情報モーダル（OK のみ・購入/復元の結果）表示中は Return=OK で閉じる。
    { input: KeyCommand.keyInputEnter, handler: () => { if (infoModal) { const cb = infoModal.onClose; setInfoModal(null); cb?.(); } } },
  ]);

  useEffect(() => {
    fetchOfferings()
      .then(setPkg)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handlePurchase() {
    if (!pkg) return;
    setPurchasing(true);
    try {
      await purchasePro(pkg);
      router.back();
    } catch (e: any) {
      if (!e?.userCancelled) {
        setInfoModal({ message: t('pro.purchaseError') });
      }
    } finally {
      setPurchasing(false);
    }
  }

  async function handleRestore() {
    setRestoring(true);
    try {
      const ok = await restorePurchases();
      setInfoModal({
        message: ok ? t('pro.restoreSuccess') : t('pro.alreadyPro'),
        onClose: ok ? () => router.back() : undefined,
      });
    } catch {
      setInfoModal({ message: t('pro.restoreError') });
    } finally {
      setRestoring(false);
    }
  }

  const priceLabel = pkg
    ? t('pro.purchaseButton', { price: pkg.product.priceString })
    : t('pro.loading');

  const s = styles(theme.colors, theme.fontSize);

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerStyle: { backgroundColor: theme.colors.surface },
          headerTintColor: theme.colors.text,
          headerShadowVisible: false,
        }}
      />
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={[s.container, { paddingBottom: insets.bottom + 24 }]}
      >
        {/* ヘッダー */}
        <View style={s.header}>
          <View style={s.proBadge}>
            <Text style={s.proBadgeText} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('pro.badge')}</Text>
          </View>
          <Text style={s.title} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('pro.paywallTitle')}</Text>
          <Text style={s.subtitle} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('pro.paywallSubtitle')}</Text>
        </View>

        {/* 現在のPro機能 */}
        <Text style={s.sectionTitle} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
          {t('pro.sectionCurrent')}
        </Text>
        <View style={s.featureList}>
          {CURRENT_FEATURES.map((f) => (
            <View key={f.titleKey} style={s.featureRow}>
              <View style={s.featureIcon}>
                <Ionicons name={f.icon} size={22} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.featureTitle} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t(f.titleKey)}</Text>
                <Text style={s.featureDesc} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>{t(f.descKey)}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* 購入ボタン */}
        {isPro ? (
          <View style={s.alreadyPro}>
            <Ionicons name="checkmark-circle" size={20} color={theme.colors.primary} />
            <Text style={[s.alreadyProText, { color: theme.colors.primary }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('pro.alreadyPro')}
            </Text>
          </View>
        ) : (
          <>
            <Pressable
              style={[s.purchaseBtn, purchasing && { opacity: 0.6 }]}
              onPress={handlePurchase}
              disabled={purchasing || loading || restoring}
            >
              {purchasing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.purchaseBtnText} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {loading ? t('pro.loading') : priceLabel}
                </Text>
              )}
            </Pressable>

            <Pressable
              style={[s.restoreBtn, restoring && { opacity: 0.6 }]}
              onPress={handleRestore}
              disabled={purchasing || restoring}
            >
              {restoring ? (
                <ActivityIndicator color={theme.colors.primary} />
              ) : (
                <Text style={[s.restoreBtnText, { color: theme.colors.primary }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('pro.restoreButton')}
                </Text>
              )}
            </Pressable>
          </>
        )}

        {/* フッターリンク */}
        <View style={s.footer}>
          <Pressable onPress={() => Linking.openURL(PRIVACY_URL)}>
            <Text style={s.footerLink} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>{t('pro.privacyPolicy')}</Text>
          </Pressable>
          <Text style={s.footerSep} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>・</Text>
          <Pressable onPress={() => Linking.openURL(TERMS_URL)}>
            <Text style={s.footerLink} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>{t('pro.terms')}</Text>
          </Pressable>
        </View>

        {Platform.OS === 'ios' && (
          <Text style={s.iapNotice} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
            {t('pro.iapNotice')}
          </Text>
        )}
      </ScrollView>
      <InfoModal
        visible={infoModal !== null}
        message={lastInfoModalRef.current?.message ?? ''}
        onClose={() => {
          const cb = infoModal?.onClose;
          setInfoModal(null);
          cb?.();
        }}
      />
    </>
  );
}

const styles = (colors: ReturnType<typeof useTheme>['colors'], fontSize: ReturnType<typeof useTheme>['fontSize']) =>
  StyleSheet.create({
    container: {
      padding: 20,
      gap: 20,
    },
    header: {
      alignItems: 'center',
      gap: 8,
      paddingVertical: 12,
    },
    proBadge: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 4,
    },
    proBadgeText: {
      color: '#fff',
      fontSize: fontSize.sm,
      fontWeight: '700',
      letterSpacing: 1.5,
    },
    title: {
      fontSize: fontSize.xxl,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    sectionTitle: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: colors.textSecondary,
      marginTop: 4,
      marginBottom: -8,
      paddingHorizontal: 4,
    },
    featureList: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      overflow: 'hidden',
      paddingVertical: 4,
    },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    featureIcon: {
      width: 36,
      alignItems: 'center',
      paddingTop: 1,
    },
    featureTitle: {
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: colors.text,
    },
    featureDesc: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginTop: 2,
    },
    purchaseBtn: {
      backgroundColor: colors.primary,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: 'center',
    },
    purchaseBtnText: {
      color: '#fff',
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    restoreBtn: {
      alignItems: 'center',
      paddingVertical: 12,
    },
    restoreBtnText: {
      fontSize: fontSize.sm,
    },
    alreadyPro: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 16,
    },
    alreadyProText: {
      fontSize: fontSize.md,
      fontWeight: '600',
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
    },
    footerLink: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      textDecorationLine: 'underline',
    },
    footerSep: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginHorizontal: 4,
    },
    iapNotice: {
      fontSize: 11,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 16,
    },
  });
