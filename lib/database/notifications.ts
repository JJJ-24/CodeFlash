import type { SQLiteDatabase } from 'expo-sqlite';

import type { NotificationSchedule } from '@/types';

import { generateId } from './utils';

/** 通知スケジュールの最大件数（031）。**iOS の保留通知64件上限の見積もりに使うので、
 *  増やすときは `npm run verify:db` の予約本数の検証が通ることを必ず確認する**
 *  （曜日指定つきスケジュールは曜日ごとに1件、未達成リマインダーは先読み日数ぶん予約を消費する）。 */
export const MAX_SCHEDULES = 5;

type ScheduleRow = {
  id: string;
  hour: number;
  minute: number;
  weekdays: string;
  label: string;
  enabled: number;
  onlyIfGoalUnmet: number;
};

function rowToSchedule(r: ScheduleRow): NotificationSchedule {
  let weekdays: number[] = [];
  try { weekdays = JSON.parse(r.weekdays); } catch { /* ignore */ }
  // SQLite は 0/1 を返すので boolean に正規化する（旧行は列の DEFAULT 0 で false）
  return { id: r.id, hour: r.hour, minute: r.minute, weekdays, label: r.label, enabled: r.enabled === 1, onlyIfGoalUnmet: r.onlyIfGoalUnmet === 1 };
}

export async function getAllSchedules(db: SQLiteDatabase): Promise<NotificationSchedule[]> {
  const rows = await db.getAllAsync<ScheduleRow>(
    'SELECT id, hour, minute, weekdays, label, enabled, onlyIfGoalUnmet FROM notification_schedules ORDER BY hour ASC, minute ASC'
  );
  return rows.map(rowToSchedule);
}

export async function createSchedule(
  db: SQLiteDatabase,
  schedule: Omit<NotificationSchedule, 'id'>
): Promise<NotificationSchedule> {
  const id = generateId();
  await db.runAsync(
    'INSERT INTO notification_schedules (id, hour, minute, weekdays, label, enabled, onlyIfGoalUnmet) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, schedule.hour, schedule.minute, JSON.stringify(schedule.weekdays), schedule.label, schedule.enabled ? 1 : 0, schedule.onlyIfGoalUnmet ? 1 : 0]
  );
  return { ...schedule, id };
}

export async function updateSchedule(db: SQLiteDatabase, schedule: NotificationSchedule): Promise<void> {
  await db.runAsync(
    'UPDATE notification_schedules SET hour = ?, minute = ?, weekdays = ?, label = ?, enabled = ?, onlyIfGoalUnmet = ? WHERE id = ?',
    [schedule.hour, schedule.minute, JSON.stringify(schedule.weekdays), schedule.label, schedule.enabled ? 1 : 0, schedule.onlyIfGoalUnmet ? 1 : 0, schedule.id]
  );
}

export async function deleteSchedule(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM notification_schedules WHERE id = ?', [id]);
}

export async function toggleScheduleEnabled(db: SQLiteDatabase, id: string, enabled: boolean): Promise<void> {
  await db.runAsync('UPDATE notification_schedules SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
}

export async function countSchedules(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM notification_schedules');
  return row?.cnt ?? 0;
}
