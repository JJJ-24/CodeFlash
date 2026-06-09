import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { InfoModal } from '@/components/InfoModal';
import { SettingsDetail } from '@/components/settings/SettingsDetail';
import { settingsStyles as styles } from '@/components/settings/styles';
import {
  countSchedules, createSchedule, deleteSchedule, getAllSchedules,
  toggleScheduleEnabled, updateSchedule,
} from '@/lib/database/notifications';
import {
  cancelAllScheduledNotifications, requestPermission, scheduleFromDb,
} from '@/lib/notifications';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useSettingsStore } from '@/store/settings';
import type { NotificationSchedule } from '@/types';

const MAX_SCHEDULES = 5;
const WEEKDAY_COUNT = 7;

function formatTime(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

const WEEKDAY_SHORT_JA = ['日', '月', '火', '水', '木', '金', '土'];
const WEEKDAY_SHORT_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function getWeekdayShort(t: ReturnType<typeof useTranslation>['t']): string[] {
  const sample = t('notification.weekdayShort.0');
  return sample === '日' ? WEEKDAY_SHORT_JA : WEEKDAY_SHORT_EN;
}

function formatWeekdays(weekdays: number[], dayNames: string[], t: ReturnType<typeof useTranslation>['t']): string {
  const sorted = [...weekdays].sort((a, b) => a - b);
  if (sorted.length === 0 || sorted.length === WEEKDAY_COUNT) return t('notification.weekdayEvery');
  const isWeekdays = sorted.length === 5 && sorted.every((d) => d >= 1 && d <= 5);
  if (isWeekdays) return t('notification.weekdayWeekdays');
  const isWeekend = sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6;
  if (isWeekend) return t('notification.weekdayWeekend');
  return sorted.map((d) => dayNames[d]).join('・');
}

// ────────────────────────────────────────────────────────
// スケジュール追加・編集モーダル（ボトムシート）
// ────────────────────────────────────────────────────────

interface ScheduleModalProps {
  visible: boolean;
  isNew: boolean;
  hour: number;
  minute: number;
  weekdays: number[];
  label: string;
  theme: ReturnType<typeof useTheme>;
  bottomInset: number;
  onChangeTime: (h: number, m: number) => void;
  onToggleWeekday: (day: number) => void;
  onChangeLabel: (v: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function ScheduleModal({
  visible, isNew, hour, minute, weekdays, label, theme, bottomInset,
  onChangeTime, onToggleWeekday, onChangeLabel, onSave, onDelete, onClose,
}: ScheduleModalProps) {
  const { t } = useTranslation();
  const { height: screenHeight } = useWindowDimensions();
  const sheetY = useSharedValue(screenHeight);
  const overlayOpacity = useSharedValue(0);

  const timeDate = new Date();
  timeDate.setHours(hour, minute, 0, 0);

  useEffect(() => {
    if (visible) {
      overlayOpacity.value = withTiming(1, { duration: 200 });
      sheetY.value = withTiming(0, { duration: 250 });
    } else {
      overlayOpacity.value = withTiming(0, { duration: 200 });
      sheetY.value = withTiming(screenHeight, { duration: 250 });
    }
  }, [visible, screenHeight]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));

  const dayNames = getWeekdayShort(t);
  const DELETE_COLOR = theme.dark ? '#EF9A9A' : '#B71C1C';

  return (
    <View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]}
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, overlayStyle, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[sheetStyle, sheetStyles.sheet, { backgroundColor: theme.colors.surface }]}>
        {/* ヘッダー */}
        <View style={sheetStyles.sheetHeader}>
          <Text style={[sheetStyles.sheetTitle, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {isNew ? t('notification.addSchedule') : t('notification.editSchedule')}
          </Text>
          <Pressable onPress={onClose} style={{ padding: 4 }}>
            <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 20 }}>
          {/* 時刻 */}
          <View style={{ alignItems: 'center', paddingTop: 8 }}>
            <DateTimePicker
              value={timeDate}
              mode="time"
              display="spinner"
              onChange={(_, date) => {
                if (!date) return;
                onChangeTime(date.getHours(), date.getMinutes());
              }}
              themeVariant={theme.dark ? 'dark' : 'light'}
              style={{ width: 220 }}
            />
          </View>

          {/* 曜日選択 */}
          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('notification.weekdays')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {dayNames.map((name, i) => {
                const sel = weekdays.includes(i);
                return (
                  <Pressable
                    key={i}
                    onPress={() => onToggleWeekday(i)}
                    style={[
                      sheetStyles.dayBtn,
                      { borderColor: sel ? theme.colors.primary : theme.colors.buttonBorder },
                      sel && { backgroundColor: theme.colors.primary },
                    ]}
                  >
                    <Text style={{ color: sel ? theme.colors.primaryText : theme.colors.textSecondary, fontSize: theme.fontSize.xs, fontWeight: sel ? '700' : '400' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
              {formatWeekdays(weekdays, dayNames, t)}
            </Text>
          </View>

          {/* ラベル */}
          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('notification.label')}
            </Text>
            <TextInput
              value={label}
              onChangeText={onChangeLabel}
              placeholder={t('notification.labelPlaceholder')}
              placeholderTextColor={theme.colors.textTertiary}
              style={[sheetStyles.labelInput, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.background, fontSize: theme.fontSize.md }]}
              maxLength={40}
              returnKeyType="done"
            />
          </View>
        </ScrollView>

        {/* フッター（デッキ・タグ編集画面と同スタイル） */}
        <View style={[sheetStyles.sheetFooter, { borderTopColor: theme.colors.border, paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          {!isNew && (
            <TouchableOpacity style={[sheetStyles.actionBtn, { backgroundColor: theme.colors.danger }]} onPress={onDelete}>
              <Ionicons name="trash-outline" size={26} color="#FFF" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[sheetStyles.actionBtn, { backgroundColor: theme.colors.primary }]} onPress={onSave}>
            <Ionicons name="checkmark-sharp" size={26} color="#FFF" />
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

// ────────────────────────────────────────────────────────
// メイン画面
// ────────────────────────────────────────────────────────

export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useSQLiteContext();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const { notificationEnabled, notificationHour, notificationMinute, setNotificationEnabled } = useSettingsStore();

  const [schedules, setSchedules] = useState<NotificationSchedule[]>([]);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // モーダル状態
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = 新規
  const [editHour, setEditHour] = useState(8);
  const [editMinute, setEditMinute] = useState(0);
  const [editWeekdays, setEditWeekdays] = useState<number[]>([]);
  const [editLabel, setEditLabel] = useState('');

  const loadSchedules = useCallback(async () => {
    const rows = await getAllSchedules(db);

    // 旧設定からの移行: schedules が空かつ notificationEnabled が true なら1件作成
    if (rows.length === 0 && notificationEnabled) {
      const created = await createSchedule(db, {
        hour: notificationHour, minute: notificationMinute,
        weekdays: [], label: '', enabled: true,
      });
      setSchedules([created]);
      scheduleFromDb(db).catch(() => {});
    } else {
      setSchedules(rows);
    }
  }, [db, notificationEnabled, notificationHour, notificationMinute]);

  useFocusEffect(useCallback(() => {
    loadSchedules();
  }, [loadSchedules]));

  // グローバルトグル
  async function handleGlobalToggle(value: boolean) {
    if (value) {
      const granted = await requestPermission();
      if (!granted) { setPermissionDenied(true); return; }
      setNotificationEnabled(true);
      scheduleFromDb(db).catch(() => {});
    } else {
      setNotificationEnabled(false);
      cancelAllScheduledNotifications().catch(() => {});
    }
  }

  // スケジュール行の enabled トグル
  async function handleToggleEnabled(id: string, enabled: boolean) {
    await toggleScheduleEnabled(db, id, enabled);
    setSchedules((prev) => prev.map((s) => s.id === id ? { ...s, enabled } : s));
    if (notificationEnabled) scheduleFromDb(db).catch(() => {});
  }

  // スケジュール行タップ → 編集モーダルを開く
  function openEditModal(s: NotificationSchedule) {
    setEditingId(s.id);
    setEditHour(s.hour);
    setEditMinute(s.minute);
    setEditWeekdays([...s.weekdays]);
    setEditLabel(s.label);
    setModalVisible(true);
  }

  // 追加ボタン → 新規モーダルを開く
  async function openAddModal() {
    const cnt = await countSchedules(db);
    if (cnt >= MAX_SCHEDULES) {
      return;
    }
    setEditingId(null);
    setEditHour(8);
    setEditMinute(0);
    setEditWeekdays([]);
    setEditLabel('');
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
  }

  function toggleWeekday(day: number) {
    setEditWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  // 保存
  async function handleSave() {
    if (editingId === null) {
      // 新規作成
      const created = await createSchedule(db, {
        hour: editHour, minute: editMinute,
        weekdays: editWeekdays, label: editLabel.trim(), enabled: true,
      });
      setSchedules((prev) => [...prev, created].sort((a, b) => a.hour !== b.hour ? a.hour - b.hour : a.minute - b.minute));
    } else {
      // 更新
      const updated: NotificationSchedule = {
        id: editingId, hour: editHour, minute: editMinute,
        weekdays: editWeekdays, label: editLabel.trim(),
        enabled: schedules.find((s) => s.id === editingId)?.enabled ?? true,
      };
      await updateSchedule(db, updated);
      setSchedules((prev) => prev.map((s) => s.id === editingId ? updated : s).sort((a, b) => a.hour !== b.hour ? a.hour - b.hour : a.minute - b.minute));
    }
    closeModal();
    if (notificationEnabled) scheduleFromDb(db).catch(() => {});
  }

  // 削除ボタン → 確認モーダルを表示
  function handleDelete() {
    if (!editingId) return;
    setShowDeleteModal(true);
  }

  // 削除確認後の実行
  async function handleDeleteConfirm() {
    if (!editingId) return;
    setShowDeleteModal(false);
    await deleteSchedule(db, editingId);
    setSchedules((prev) => prev.filter((s) => s.id !== editingId));
    closeModal();
    if (notificationEnabled) scheduleFromDb(db).catch(() => {});
  }

  const dayNames = getWeekdayShort(t);

  return (
    <SettingsDetail
      title={t('notification.title')}
      overlay={
        <>
          {permissionDenied && (
            <InfoModal
              visible
              title={t('notification.permissionDenied')}
              message={t('notification.permissionDeniedMessage')}
              onClose={() => setPermissionDenied(false)}
            />
          )}
          <ScheduleModal
            visible={modalVisible}
            isNew={editingId === null}
            hour={editHour}
            minute={editMinute}
            weekdays={editWeekdays}
            label={editLabel}
            theme={theme}
            bottomInset={bottomInset}
            onChangeTime={(h, m) => { setEditHour(h); setEditMinute(m); }}
            onToggleWeekday={toggleWeekday}
            onChangeLabel={setEditLabel}
            onSave={handleSave}
            onDelete={handleDelete}
            onClose={closeModal}
          />
          <ConfirmDeleteModal
            visible={showDeleteModal}
            message={t('notification.deleteScheduleConfirm')}
            onConfirm={handleDeleteConfirm}
            onClose={() => setShowDeleteModal(false)}
          />
        </>
      }
    >
      {/* グローバルトグル */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.notificationRow}>
          <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('notification.dailyReminder')}
          </Text>
          <Switch
            value={notificationEnabled}
            onValueChange={handleGlobalToggle}
            trackColor={{ true: theme.colors.primary }}
          />
        </View>
      </View>

      {/* スケジュール一覧 */}
      <Text style={[localStyles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
        {t('notification.schedules')}
      </Text>

      {schedules.length === 0 ? (
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.sm, textAlign: 'center', paddingVertical: 8 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('notification.noSchedules')}
          </Text>
        </View>
      ) : (
        schedules.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => openEditModal(s)}
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: theme.colors.surface },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: s.enabled ? theme.colors.text : theme.colors.textTertiary, fontSize: theme.fontSize.xxl, fontWeight: '300', letterSpacing: 1 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {formatTime(s.hour, s.minute)}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <Text style={{ color: s.enabled ? theme.colors.textSecondary : theme.colors.textTertiary, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                    {formatWeekdays(s.weekdays, dayNames, t)}
                  </Text>
                  {/* 曜日ドット（指定曜日のみ） */}
                  {s.weekdays.length > 0 && s.weekdays.length < WEEKDAY_COUNT && (
                    <View style={{ flexDirection: 'row', gap: 3 }}>
                      {Array.from({ length: WEEKDAY_COUNT }, (_, i) => (
                        <View
                          key={i}
                          style={{
                            width: 6, height: 6, borderRadius: 3,
                            backgroundColor: s.weekdays.includes(i)
                              ? (s.enabled ? theme.colors.primary : theme.colors.textTertiary)
                              : theme.colors.buttonBorder,
                          }}
                        />
                      ))}
                    </View>
                  )}
                  {s.label !== '' && (
                    <Text style={{ color: s.enabled ? theme.colors.textSecondary : theme.colors.textTertiary, fontSize: theme.fontSize.sm }} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                      {s.label}
                    </Text>
                  )}
                </View>
              </View>
              <Switch
                value={s.enabled}
                onValueChange={(v) => handleToggleEnabled(s.id, v)}
                trackColor={{ true: theme.colors.primary }}
              />
            </View>
          </Pressable>
        ))
      )}

      {/* 追加ボタン */}
      {schedules.length < MAX_SCHEDULES && (
        <Pressable
          onPress={openAddModal}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: theme.colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Ionicons name="add-circle-outline" size={Math.max(theme.fontSize.xl, 22)} color={theme.colors.primary} />
          <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.md, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('notification.addSchedule')}
          </Text>
        </Pressable>
      )}
      {schedules.length >= MAX_SCHEDULES && (
        <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs, textAlign: 'center' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
          {t('notification.maxSchedules')}
        </Text>
      )}
    </SettingsDetail>
  );
}

const sheetStyles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 20,
    overflow: 'hidden',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  sheetTitle: { fontWeight: '700' },
  dayBtn: {
    flex: 1,
    minWidth: 36,
    minHeight: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sheetFooter: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
});

const localStyles = StyleSheet.create({
  sectionTitle: {
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 2,
    marginLeft: 4,
  },
});
