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
import { ConfirmModal } from '@/components/ConfirmModal';
import { InfoModal } from '@/components/InfoModal';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { PRIVACY_URL, TERMS_URL } from '@/lib/links';
import { getTrialRemainingMs, resetTrialForDev, startTrial } from '@/lib/proTrial';
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
  // 実効 isPro ではなく内訳を見る：トライアル中（isPro=true）でも購入導線は出し続ける（035）
  const { purchased, trialActive, trialStartedAt } = useProStore();

  const [pkg, setPkg]               = useState<PurchasesPackage | null>(null);
  const [loading, setLoading]       = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring]   = useState(false);
  const [startingTrial, setStartingTrial] = useState(false);
  const [trialConfirmVisible, setTrialConfirmVisible] = useState(false);
  const [infoModal, setInfoModal]   = useState<{ message: string; onClose?: () => void } | null>(null);
  // 閉じる（null）瞬間にフェード中の中身が空にならないよう、直前の内容を保持する。
  const lastInfoModalRef = useRef<{ message: string; onClose?: () => void } | null>(null);
  if (infoModal) lastInfoModalRef.current = infoModal;

  // Esc / B = 戻る（体験開始確認・情報モーダル表示中は先に閉じる）。
  const goBack = () => {
    if (trialConfirmVisible) { setTrialConfirmVisible(false); return; }
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

  async function handleStartTrial() {
    setTrialConfirmVisible(false);
    setStartingTrial(true);
    try {
      // startTrial() 冒頭の refreshTrial() が iCloud KV を照合し、別端末や再インストール前の
      // 体験記録があれば alreadyUsed になる（ボタン表示も store 更新で「体験済み」へ自動追従）
      const result = await startTrial();
      if (result === 'started') {
        setInfoModal({ message: t('pro.trialStarted'), onClose: () => router.back() });
      } else {
        setInfoModal({ message: t('pro.trialAlreadyUsed') });
      }
    } finally {
      setStartingTrial(false);
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

  // 体験済み（期限切れ・無効化含む）＝開始記録はあるが現在アクティブでない
  const trialUsed = trialStartedAt != null && !trialActive;
  const trialDaysLeft = trialActive
    ? Math.max(1, Math.ceil(getTrialRemainingMs() / (24 * 60 * 60 * 1000)))
    : 0;

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
          {/* __DEV__: PRO バッジ長押し＝トライアル記録リセット（iCloud KV は通常消せないため）。
              バッジ末尾の「*」は dev バンドルが読み込まれている目印（リリースでは出ない） */}
          <Pressable
            style={s.proBadge}
            onLongPress={() => {
              if (!__DEV__) return;
              resetTrialForDev()
                .then((debug) => setInfoModal({ message: `DEV: trial reset\n${debug}` }))
                .catch((e) => setInfoModal({ message: `DEV: reset error\n${String(e)}` }));
            }}
          >
            <Text style={s.proBadgeText} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {__DEV__ ? `${t('pro.badge')} *` : t('pro.badge')}
            </Text>
          </Pressable>
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

        {/* 購入・体験ボタン（購入済みなら案内のみ。トライアル中も購入導線は出し続ける） */}
        {purchased ? (
          <View style={s.alreadyPro}>
            <Ionicons name="checkmark-circle" size={20} color={theme.colors.primary} />
            <Text style={[s.alreadyProText, { color: theme.colors.primary }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('pro.alreadyPro')}
            </Text>
          </View>
        ) : (
          <>
            {trialActive && (
              <View style={s.trialActiveBox}>
                <Ionicons name="time-outline" size={18} color={theme.colors.primary} />
                <Text style={[s.trialActiveText, { color: theme.colors.primary }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('pro.trialRemaining', { count: trialDaysLeft })}
                </Text>
              </View>
            )}

            <Pressable
              style={[s.purchaseBtn, purchasing && { opacity: 0.6 }]}
              onPress={handlePurchase}
              disabled={purchasing || loading || restoring || startingTrial}
            >
              {purchasing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.purchaseBtnText} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {loading ? t('pro.loading') : priceLabel}
                </Text>
              )}
            </Pressable>

            {/* 1週間無料体験（未体験時のみ活性。体験中はバッジ表示に切替済みなので出さない） */}
            {!trialActive && (
              <Pressable
                style={[s.trialBtn, { borderColor: theme.colors.primary }, (trialUsed || startingTrial) && { opacity: 0.4 }]}
                onPress={() => setTrialConfirmVisible(true)}
                disabled={trialUsed || startingTrial || purchasing || restoring}
              >
                {startingTrial ? (
                  <ActivityIndicator color={theme.colors.primary} />
                ) : (
                  <Text style={[s.trialBtnText, { color: theme.colors.primary }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                    {trialUsed ? t('pro.trialUsed') : t('pro.trialButton')}
                  </Text>
                )}
              </Pressable>
            )}
            {trialUsed && (
              <Text style={s.trialUsedHint} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                {t('pro.trialUsedHint')}
              </Text>
            )}

            <Pressable
              style={[s.restoreBtn, restoring && { opacity: 0.6 }]}
              onPress={handleRestore}
              disabled={purchasing || restoring || startingTrial}
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
      {/* 体験開始の確認（一度きりの明示）。確定操作なので Return は割り当てない（タップ/Esc のみ） */}
      <ConfirmModal
        visible={trialConfirmVisible}
        title={t('pro.trialConfirmTitle')}
        message={t('pro.trialConfirmMessage')}
        actions={[{ label: t('pro.trialConfirmAction'), onPress: handleStartTrial }]}
        onClose={() => setTrialConfirmVisible(false)}
      />
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
    trialBtn: {
      borderWidth: 2,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: -8,
    },
    trialBtnText: {
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    trialActiveBox: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.surface,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    trialActiveText: {
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    trialUsedHint: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: -12,
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
