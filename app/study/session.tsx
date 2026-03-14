import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { BlocksView } from '@/components/study/BlocksView';
import { FlipCard } from '@/components/study/FlipCard';
import { useStudySession } from '@/hooks/useStudySession';
import type { Grade } from '@/lib/sm2';

const GRADES: { grade: Grade; labelKey: string; color: string }[] = [
  { grade: 0, labelKey: 'grade.again', color: '#E53935' },
  { grade: 1, labelKey: 'grade.hard',  color: '#FB8C00' },
  { grade: 2, labelKey: 'grade.good',  color: '#43A047' },
  { grade: 3, labelKey: 'grade.easy',  color: '#1976D2' },
];

export default function StudySessionScreen() {
  const { deckId, tagId } = useLocalSearchParams<{ deckId?: string; tagId?: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { loading, completed, currentCard, currentIndex, result, loadSession, submitGrade } =
    useStudySession();

  const [isFlipped, setIsFlipped] = useState(false);
  const [showMemo, setShowMemo] = useState(false);
  const [grading, setGrading] = useState(false);

  useEffect(() => {
    loadSession({ deckId, tagId });
  }, [deckId, tagId]);

  // 新しいカードに移ったらフリップ・メモをリセット
  useEffect(() => {
    setIsFlipped(false);
    setShowMemo(false);
  }, [currentIndex]);

  async function handleGrade(grade: Grade) {
    if (grading) return;
    setGrading(true);
    await submitGrade(grade);
    setGrading(false);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // セッション完了画面
  if (completed) {
    return (
      <>
        <Stack.Screen options={{ title: t('study.title'), headerBackTitle: '' }} />
        <View style={styles.completeScreen}>
          <Ionicons name="checkmark-circle" size={80} color="#43A047" />
          <Text style={styles.completeTitle}>{t('study.complete')}</Text>
          <Text style={styles.completeCount}>
            {t('study.reviewedCount', { count: result.reviewed })}
          </Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
            <Text style={styles.backBtnText}>{t('common.ok')}</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  if (!currentCard) return null;

  const progressRatio = result.totalCards > 0 ? result.reviewed / result.totalCards : 0;

  return (
    <>
      <Stack.Screen options={{ title: t('study.title'), headerBackTitle: '' }} />
      <View style={styles.container}>
        {/* プログレスバー */}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { flex: progressRatio }]} />
          <View style={{ flex: 1 - progressRatio }} />
        </View>
        <Text style={styles.progressText}>
          {t('study.progress', { current: result.reviewed, total: result.totalCards })}
        </Text>

        {/* カード */}
        <View style={styles.cardArea}>
          <FlipCard
            isFlipped={isFlipped}
            onFlip={() => setIsFlipped((v) => !v)}
            front={
              <ScrollView contentContainerStyle={styles.faceContent} showsVerticalScrollIndicator={false}>
                <BlocksView blocks={currentCard.frontContent} />
              </ScrollView>
            }
            back={
              <ScrollView contentContainerStyle={styles.faceContent} showsVerticalScrollIndicator={false}>
                <Text style={styles.faceLabel}>{t('card.back')}</Text>
                <BlocksView blocks={currentCard.backContent} />
                {/* メモ */}
                {currentCard.memoContent.length > 0 && (
                  <View style={styles.memoSection}>
                    <Pressable
                      style={styles.memoToggle}
                      onPress={() => setShowMemo((v) => !v)}
                    >
                      <Ionicons
                        name={showMemo ? 'eye-off-outline' : 'eye-outline'}
                        size={16}
                        color="#9E9E9E"
                      />
                      <Text style={styles.memoToggleText}>
                        {showMemo ? t('study.hideMemo') : t('study.showMemo')}
                      </Text>
                    </Pressable>
                    {showMemo && (
                      <View style={styles.memoContent}>
                        <BlocksView blocks={currentCard.memoContent} />
                      </View>
                    )}
                  </View>
                )}
              </ScrollView>
            }
          />
        </View>

        {/* ヒント or 自己評価ボタン */}
        <View style={styles.bottom}>
          {!isFlipped ? (
            <Pressable style={styles.flipHint} onPress={() => setIsFlipped(true)}>
              <Ionicons name="sync-outline" size={18} color="#9E9E9E" />
              <Text style={styles.flipHintText}>{t('study.tapToFlip')}</Text>
            </Pressable>
          ) : (
            <View style={styles.gradeRow}>
              {GRADES.map(({ grade, labelKey, color }) => (
                <TouchableOpacity
                  key={grade}
                  style={[styles.gradeBtn, { borderColor: color }, grading && styles.gradeBtnDisabled]}
                  onPress={() => handleGrade(grade)}
                  disabled={grading}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.gradeBtnText, { color }]}>{t(labelKey)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F4F8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  progressBar: {
    height: 4,
    flexDirection: 'row',
    backgroundColor: '#E0E0E0',
  },
  progressFill: { backgroundColor: '#1976D2' },
  progressText: {
    fontSize: 12,
    color: '#9E9E9E',
    textAlign: 'right',
    paddingHorizontal: 20,
    paddingTop: 6,
  },
  cardArea: { flex: 1, paddingHorizontal: 20, paddingVertical: 12 },
  faceContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 8 },
  faceLabel: { fontSize: 11, fontWeight: '700', color: '#BDBDBD', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  memoSection: { marginTop: 20, gap: 8 },
  memoToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  memoToggleText: { fontSize: 13, color: '#9E9E9E' },
  memoContent: {
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#E0E0E0',
  },
  bottom: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 8,
  },
  flipHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    backgroundColor: '#FFF',
    borderRadius: 12,
  },
  flipHintText: { fontSize: 15, color: '#9E9E9E' },
  gradeRow: { flexDirection: 'row', gap: 8 },
  gradeBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    backgroundColor: '#FFF',
  },
  gradeBtnDisabled: { opacity: 0.4 },
  gradeBtnText: { fontSize: 13, fontWeight: '700' },
  completeScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: '#F0F4F8',
    padding: 32,
  },
  completeTitle: { fontSize: 24, fontWeight: '700', color: '#212121' },
  completeCount: { fontSize: 16, color: '#616161' },
  backBtn: {
    marginTop: 8,
    backgroundColor: '#1976D2',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  backBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
});
