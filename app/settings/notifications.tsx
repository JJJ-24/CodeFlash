import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch, Text, View } from 'react-native';

import { InfoModal } from '@/components/InfoModal';
import { SettingsDetail } from '@/components/settings/SettingsDetail';
import { settingsStyles as styles } from '@/components/settings/styles';

import { cancelAllReminders, requestPermission, scheduleDailyReminder } from '@/lib/notifications';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useSettingsStore } from '@/store/settings';

export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const {
    notificationEnabled, notificationHour, notificationMinute,
    setNotificationEnabled, setNotificationTime,
  } = useSettingsStore();
  const [permissionDenied, setPermissionDenied] = useState(false);

  async function handleNotificationToggle(value: boolean) {
    if (value) {
      const granted = await requestPermission();
      if (!granted) {
        setPermissionDenied(true);
        return;
      }
      setNotificationEnabled(true);
      await scheduleDailyReminder(notificationHour, notificationMinute).catch(() => {});
    } else {
      setNotificationEnabled(false);
      await cancelAllReminders().catch(() => {});
    }
  }

  async function handleNotificationTimeChange(_: unknown, date?: Date) {
    if (!date) return;
    const hour = date.getHours();
    const minute = date.getMinutes();
    setNotificationTime(hour, minute);
    await scheduleDailyReminder(hour, minute).catch(() => {});
  }

  const notificationTimeDate = new Date();
  notificationTimeDate.setHours(notificationHour, notificationMinute, 0, 0);

  return (
    <SettingsDetail
      title={t('notification.title')}
      overlay={
        permissionDenied && (
          <InfoModal
            visible
            title={t('notification.permissionDenied')}
            message={t('notification.permissionDeniedMessage')}
            onClose={() => setPermissionDenied(false)}
          />
        )
      }
    >
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.notificationRow}>
          <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('notification.dailyReminder')}
          </Text>
          <Switch
            value={notificationEnabled}
            onValueChange={handleNotificationToggle}
            trackColor={{ true: theme.colors.primary }}
          />
        </View>
        {notificationEnabled && (
          <View style={styles.notificationRow}>
            <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('notification.reminderTime')}
            </Text>
            <DateTimePicker
              value={notificationTimeDate}
              mode="time"
              display="compact"
              onChange={handleNotificationTimeChange}
              themeVariant={theme.dark ? 'dark' : 'light'}
            />
          </View>
        )}
      </View>
    </SettingsDetail>
  );
}
