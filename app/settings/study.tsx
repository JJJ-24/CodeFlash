import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Switch, Text, View } from 'react-native';

import { ConfirmModal } from '@/components/ConfirmModal';
import { SettingsDetail } from '@/components/settings/SettingsDetail';
import { SPEECH_SCRIPT_LABEL_KEYS, SpeechLanguageModal } from '@/components/settings/SpeechLanguageModal';
import { SpeechVoiceModal } from '@/components/settings/SpeechVoiceModal';
import {
  CONFIGURABLE_SCRIPTS,
  getConfigurableScriptLanguages,
  getVoicesForLanguage,
  SCRIPT_DEFAULT_LANGS,
  SPEECH_RATES,
  speechLanguageLabel,
  type SpeechScript,
  type SpeechVoice,
} from '@/lib/speech';
import { getAllSchedules, toggleScheduleEnabled, updateSchedule } from '@/lib/database/notifications';
import type { NotificationSchedule } from '@/types';
import { settingsStyles as styles } from '@/components/settings/styles';

import { requestPermission, scheduleFromDb } from '@/lib/notifications';
import { useSQLiteContext } from 'expo-sqlite';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useProStore } from '@/store/pro';
import {
  FSRS_PRESET_RETENTION,
  FSRS_RETENTION_MAX,
  FSRS_RETENTION_MIN,
  STUDY_TIMER_BREAK_MINUTES_MAX,
  STUDY_TIMER_BREAK_MINUTES_MIN,
  STUDY_TIMER_CYCLES_MAX,
  STUDY_TIMER_CYCLES_MIN,
  STUDY_TIMER_ELEMENT_MODES,
  STUDY_GOAL_COUNT_MIN,
  STUDY_GOAL_SLIDER_MAX,
  STUDY_TIMER_MINUTES_MAX,
  STUDY_TIMER_MINUTES_MIN,
  useSettingsStore,
  type FsrsPreset,
  type StudyTimerElementMode,
  type StudyTimerEndBehavior,
} from '@/store/settings';

/** 読み上げ設定で「その他の文字体系」に畳む文字体系（ラテン・漢字は常時表示するので除く）。 */
const OTHER_SPEECH_SCRIPTS = CONFIGURABLE_SCRIPTS.filter((s) => s !== 'latin' && s !== 'han');

export default function StudySettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { isPro } = useProStore();
  const {
    fsrsDesiredRetention, setFsrsDesiredRetention,
    studyTimerEnabled, setStudyTimerEnabled,
    studyTimerMinutes, setStudyTimerMinutes,
    studyTimerRing, setStudyTimerRing,
    studyTimerTime, setStudyTimerTime,
    studyTimerEndBehavior, setStudyTimerEndBehavior,
    studyTimerBreakMinutes, setStudyTimerBreakMinutes,
    studyTimerCycles, setStudyTimerCycles,
    studyGoalEnabled, setStudyGoalEnabled,
    studyGoalCount, setStudyGoalCount,
    speechEnabled, setSpeechEnabled,
    speechRate, setSpeechRate,
    speechScriptLangs, setSpeechScriptLang,
    speechVoices, setSpeechVoice,
    speechNoMixedSwitch, setSpeechNoMixedSwitch,
  } = useSettingsStore();
  // 開いている言語ピッカー（null＝閉じている）。行は複数あるがモーダルは1つを使い回す。
  const [speechLangModal, setSpeechLangModal] = useState<SpeechScript | null>(null);
  // 「その他の文字体系」（キリル・アラビア・デーヴァナーガリー）の展開状態。
  const [speechOtherScriptsOpen, setSpeechOtherScriptsOpen] = useState(false);
  // 文字体系ごとに端末が持っている音声の言語。null＝未取得。**選択肢が2つ未満の行は出さない**
  // ための判定に使う（多くの端末でアラビア文字は ar-SA だけ＝選ばせる意味が無い）。
  const [scriptOptions, setScriptOptions] = useState<Partial<Record<SpeechScript, string[]>> | null>(null);
  useEffect(() => { getConfigurableScriptLanguages().then(setScriptOptions).catch(() => {}); }, []);
  // 050 Phase 3：声のピッカーを開いている言語（null＝閉じている）。
  // ⚠️ **どの文字体系の行から開いたか**も持つ＝説明文の言語名を行と同じ表記にするため
  //（同じ一覧に同じ言語が並ぶかで地域を出すか決めるので、並びの一覧が要る）。
  const [speechVoiceModal, setSpeechVoiceModal] = useState<{ language: string; script: SpeechScript } | null>(null);
  // 今表示している言語ごとの声の一覧。**声が2つ以上あるときだけ「声」の行を出す**ため。
  const [voicesByLang, setVoicesByLang] = useState<Record<string, SpeechVoice[]>>({});
  const db = useSQLiteContext();
  const { notificationEnabled } = useSettingsStore();
  // 046: 目標の変更は未達成リマインダーの予約内容を変える（OFF なら予約自体を止める）。
  // 通知が有効なときだけ積み直す（無効なら予約は無いので何もしなくてよい）。
  const rescheduleGoalReminders = () => { if (notificationEnabled) scheduleFromDb(db).catch(() => {}); };

  // 046: 目標を切り替えたとき、未達成リマインダーのスケジュールをどう扱うかを確認する。
  // **目標 OFF ＝「未達成かどうか」を判定できない**ので、条件つきスケジュールは予約されない。
  // 放置すると「一覧では有効（✓）なのに絶対に鳴らない」という嘘の状態になるため、
  // ユーザーに2択で決めてもらう（自動で書き換えない＝身に覚えのない変化を起こさないため）。
  const [goalConflict, setGoalConflict] = useState<{ turningOn: boolean; targets: NotificationSchedule[] } | null>(null);

  async function handleGoalEnabledChange(v: boolean) {
    const schedules = await getAllSchedules(db).catch(() => [] as NotificationSchedule[]);
    // OFF: これから鳴らなくなる（有効かつ条件つき）／ON: 戻せる（無効かつ条件つき）
    const targets = schedules.filter((s) => s.onlyIfGoalUnmet && (v ? !s.enabled : s.enabled));

    // **OFF は矛盾を生むので、選択されるまで設定を適用しない**（トグルは ON のまま）。
    // ダイアログの出口がひとつでも「目標 OFF ＋ 条件つきスケジュールが有効」に着地すると、
    // それは「一覧では有効なのに絶対に鳴らない」＝このダイアログが防ごうとしている状態そのもの。
    // 閉じる＝キャンセル（何も変えない）にすることで、全ての出口が整合した状態に着地する
    // （削除確認・破棄確認・032 のアーカイブ済みデッキ学習と同じ「閉じる＝キャンセル」の流儀）。
    if (!v && targets.length > 0) { setGoalConflict({ turningOn: false, targets }); return; }

    setStudyGoalEnabled(v);
    // **ON は矛盾を生まない**ので先に適用してよい。あとに出すのは「オフになっている未達成通知を
    // 戻しますか？」という任意のお誘いで、閉じても「目標 ON・それらは OFF」で整合している。
    if (v && targets.length > 0) { setGoalConflict({ turningOn: true, targets }); return; }
    rescheduleGoalReminders();
  }

  const handleGoalCountChange = (v: number) => { setStudyGoalCount(v); rescheduleGoalReminders(); };

  /** 選択されたアクションを適用する。OFF 側はここで初めて目標の設定も確定させる。 */
  async function applyGoalConflict(mutate: (s: NotificationSchedule) => Promise<void>) {
    const conflict = goalConflict;
    setGoalConflict(null);
    if (!conflict) return;
    if (!conflict.turningOn) setStudyGoalEnabled(false);   // OFF はここで確定
    for (const s of conflict.targets) await mutate(s).catch(() => {});
    rescheduleGoalReminders();
  }

  /** ダイアログを閉じる（余白タップ・Esc）。**OFF 側は完全なキャンセル**＝目標も変えない。
   *  ON 側は「そのままにする」と同義（すでに整合しているので積み直しだけ行う）。 */
  function dismissGoalConflict() {
    const turningOn = goalConflict?.turningOn ?? false;
    setGoalConflict(null);
    if (turningOn) rescheduleGoalReminders();
  }
  const [showRetentionInfo, setShowRetentionInfo] = useState(false);
  // 各設定の情報 i アイコン。開くのは1つずつ（キー: general/cycles/break/ring/time/end/goal/speech）。
  const [openInfo, setOpenInfo] = useState<string | null>(null);

  function handleFsrsPresetSelect(preset: FsrsPreset) {
    setFsrsDesiredRetention(FSRS_PRESET_RETENTION[preset]);
  }

  function handleFsrsRetentionChange(value: number) {
    setFsrsDesiredRetention(Math.round(value * 100) / 100);
  }

  // 繰り返し回数を 1→2以上 に変えた瞬間、休憩終了通知のために権限を fire-and-forget で要求する。
  // 未許可でも機能は完全動作（復帰時に即遷移）のため結果は見ない（039）。
  function handleCyclesChange(value: number) {
    if (studyTimerCycles <= 1 && value >= 2) requestPermission().catch(() => {});
    setStudyTimerCycles(value);
  }

  // 円/残り時間の表示モード（on/start/off）のラベル。
  const modeLabel = (m: StudyTimerElementMode) =>
    t(m === 'on' ? 'settings.studyTimerDisplayAlways'
      : m === 'start' ? 'settings.studyTimerDisplayStart'
      : 'settings.studyTimerDisplayOff');

  // セクション見出しの右に出す i アイコンと、その下に開くインライン説明ボックス。
  // ⚠️ **説明文は常時表示にせず必ずこの形にする**（このカードだけ常時表示にすると浮く）。
  const toggleInfo = (key: string) => setOpenInfo((cur) => (cur === key ? null : key));
  const infoIcon = (key: string) => (
    <Ionicons
      name={openInfo === key ? 'information-circle' : 'information-circle-outline'}
      size={Math.max(theme.fontSize.lg, 20)}
      color={theme.colors.textTertiary}
    />
  );
  const infoBox = (key: string, textKey: string) =>
    openInfo === key ? (
      <View style={[styles.syncInfoBox, { backgroundColor: theme.colors.background }]}>
        <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: 20 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
          {t(textKey)}
        </Text>
      </View>
    ) : null;

  // 046: 目標 ON/OFF に伴う未達成リマインダーの確認ダイアログ（無料機能なので非 Pro 分岐にも出す）。
  const goalConflictModal = (
    <ConfirmModal
      visible={goalConflict !== null}
      title={t(goalConflict?.turningOn ? 'settings.goalScheduleRestoreTitle' : 'settings.goalScheduleConflictTitle')}
      message={t(
        goalConflict?.turningOn ? 'settings.goalScheduleRestoreMessage' : 'settings.goalScheduleConflictMessage',
        { count: goalConflict?.targets.length ?? 0 }
      )}
      actions={goalConflict?.turningOn
        ? [
            { label: t('settings.goalScheduleRestore'), onPress: () => void applyGoalConflict((s) => toggleScheduleEnabled(db, s.id, true)) },
            { label: t('settings.goalScheduleKeep'), onPress: dismissGoalConflict },
          ]
        : [
            // 条件つきの指定は残したままスケジュールを止める＝目標を戻せば復元できる
            { label: t('settings.goalScheduleDisable'), onPress: () => void applyGoalConflict((s) => toggleScheduleEnabled(db, s.id, false)) },
            // 条件そのものを外して**普通のスケジュールに変える**（実行時に隠れた挙動をさせない）
            { label: t('settings.goalSchedulePlain'), onPress: () => void applyGoalConflict((s) => updateSchedule(db, { ...s, onlyIfGoalUnmet: false })) },
          ]}
      onClose={dismissGoalConflict}
    />
  );

  // 1日の目標枚数（046）。タイマー＝時間で区切る／こちら＝量で区切る、という対の関係。
  // **1日単位**なので、複数セッションに分けても今日の累計で判定する。
  // **無料機能**なので Pro ロック時の画面にも出す＝JSX を変数に切り出して両方の分岐から描画する
  // （FSRS・学習タイマーは Pro のまま）。
  const goalCard = (
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Pressable
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          onPress={() => toggleInfo('goal')}
          hitSlop={6}
        >
          <Text
            style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
          >
            {t('settings.studyGoal')}
          </Text>
          {infoIcon('goal')}
        </Pressable>
        {infoBox('goal', 'settings.studyGoalInfo')}
        <View style={styles.notificationRow}>
          <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('settings.studyGoalEnable')}
          </Text>
          <Switch
            value={studyGoalEnabled}
            onValueChange={handleGoalEnabledChange}
            trackColor={{ true: theme.colors.primary }}
          />
        </View>

        {studyGoalEnabled && (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('settings.studyGoalCount')}
              </Text>
              <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.lg, fontWeight: '700' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {t('settings.studyGoalCountValue', { n: studyGoalCount })}
              </Text>
            </View>
            {/* スライダーは実用域（1〜100枚）だけを覆う。100 超は上限 999 まで設定値としては
                保持できるが、スライダーでは 100 で頭打ちになる（それ以上は刻みが粗くなり
                かえって合わせにくいため）。 */}
            <Slider
              minimumValue={STUDY_GOAL_COUNT_MIN}
              maximumValue={STUDY_GOAL_SLIDER_MAX}
              step={1}
              value={Math.min(studyGoalCount, STUDY_GOAL_SLIDER_MAX)}
              onValueChange={handleGoalCountChange}
              minimumTrackTintColor={theme.colors.primary}
              maximumTrackTintColor={theme.colors.iconSubtle}
              thumbTintColor={theme.colors.primary}
            />
          </View>
        )}
      </View>
  );

  // 読み上げ（049/050）。**無料機能**なので Pro ロック時の画面にも出す（目標枚数と同じ扱い）。
  // 言語は**文字体系ごと**に決まる。行を出すのは複数の言語が同じ文字を使う `CONFIGURABLE_SCRIPTS`
  // だけで、ハングル・タイ文字などは1対1なので出さない（選ばせる意味が無い）。詳細は docs/050。

  /** その文字体系の行を出すか。**端末が持っている選択肢が2つ未満なら出さない**
   *  （多くの端末でアラビア文字・デーヴァナーガリーは音声が1つ＝選ばせる意味が無い）。
   *  ⚠️ 未取得のあいだは出す側に倒す（行が消えて見えるちらつきを避ける）。
   *  ⚠️ **判定材料は端末の音声一覧だけにする**。「上書きが保存されていれば出す」という条件を
   *  足すと、選択肢が1つしかない行をタップしただけで上書きが保存されて行が居座り、しかも
   *  ピッカーには「既定に戻す」が無いので**解除できなくなる**（実際にそうなった）。
   *  隠れている行に上書きが残っていても、選べる音声が1つなら結果は同じなので害はない。 */
  const isScriptSelectable = (script: SpeechScript) =>
    scriptOptions === null || (scriptOptions[script]?.length ?? 0) >= 2;

  /** 「その他の文字体系」に実際に出す文字体系（選べないものは畳んだ中にも出さない）。 */
  const visibleOtherScripts = OTHER_SPEECH_SCRIPTS.filter(isScriptSelectable);

  /** その文字体系がいま読む言語（上書きが無ければ既定）。 */
  const langOf = (script: SpeechScript) => speechScriptLangs[script] ?? SCRIPT_DEFAULT_LANGS[script];

  // 表示中の言語について声の一覧を読む（言語を変えたら読み直す）。
  // ⚠️ **声が1つしか無い言語では「声」の行を出さない**（言語の行と同じ規則）。
  const shownLangs = [langOf('latin'), langOf('han'), ...visibleOtherScripts.map(langOf)];
  const shownLangsKey = shownLangs.join(',');
  useEffect(() => {
    let alive = true;
    Promise.all(shownLangsKey.split(',').map(async (lang) => [lang, await getVoicesForLanguage(lang)] as const))
      .then((pairs) => { if (alive) setVoicesByLang(Object.fromEntries(pairs)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [shownLangsKey]);

  /** 文字体系1つぶんの設定＝**見出し（文字体系の名前）＋インデントした行**（言語・声ほか）。
   *  言語の値は「上書きが無ければ既定」を出す（＝実際に読まれる言語）。
   *  ⚠️ **説明の ⓘ は置かない**＝タップして開くピッカーの上部に同じ文言が出るため
   *  （行に置くと二重になり、行の中に入れ子の Pressable ができて誤タップの余地も増える）。 */
  const speechScriptRow = (script: SpeechScript) => (
    <View key={script} style={{ gap: 2 }}>
      {/* ⚠️ **文字体系の名前と言語名を同じ行に置かない**＝「デーヴァナーガリー文字」と
          「スウェーデン語（スウェーデン）」が1行に収まらず、`dataRowText` が `flex:1`
          （＝残り幅にだけ収まる）なので見出しが折り返し、値ははみ出して切れる。
          文字サイズを大きくすると必ず起きるので、見出しを独立した行にして幅の取り合いを無くす。 */}
      <Text
        style={[styles.dataRowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
        maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
      >
        {t(SPEECH_SCRIPT_LABEL_KEYS[script] ?? 'settings.speechScriptLatin')}
      </Text>
      {/* 子の行はインデントして「声」と同じ形（ラベル左・値右）に揃える。
          ⚠️ ラベルは**専用キー**（英語は `Lang`＝隣の `Voice`/`Speed` と長さを揃える）。
          表示設定のアプリ言語（`settings.language`＝「表示言語」/`Display Language`）とは別物。 */}
      <Pressable style={[styles.dataRow, { paddingLeft: 16 }]} onPress={() => setSpeechLangModal(script)}>
        <View style={styles.dataRowText}>
          <Text style={[styles.dataRowTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('settings.speechLanguage')}
          </Text>
        </View>
        <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.sm, fontWeight: '700' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
          {/* 地域は同じ言語が2つ以上並ぶときだけ出す（ピッカーの一覧と同じ判定にする）。
              ⚠️ **一覧の取得前は `[]`（＝地域なし）で描く**＝取得を待つあいだだけ地域つきにすると、
              解決後に縮んでちらつくうえ、その一瞬だけ行が溢れる。単独の言語が大多数なので
              `[]` の方が最終結果と一致しやすく、外れても短い側なので幅を壊さない。 */}
          {speechLanguageLabel(langOf(script), t, scriptOptions?.[script] ?? [])}
        </Text>
        <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
      </Pressable>
      {/* 「声を分けない」はラテン文字にしか意味が無いので latin の行にだけ出す。
          ⚠️ 英語だけのカードには効かない（`resolveSpeechSegments` が混在文だけに適用する）ので、
          ⓘ の説明で**効かない場面まで書く**＝書かないと「オンにしたのに効かない＝壊れている」に見える。 */}
      {script === 'latin' && (
        <>
          <View style={[styles.notificationRow, { paddingLeft: 16 }]}>
            {/* ⚠️ ⓘ の Pressable は**ラベルまで**に留める（スイッチに重ねるとトグルの誤操作になる）。 */}
            <Pressable
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}
              onPress={() => toggleInfo('speechNoMixed')}
              hitSlop={6}
            >
              <Text
                style={[styles.dataRowTitle, { flexShrink: 1, color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {t('settings.speechNoMixedSwitch')}
              </Text>
              {infoIcon('speechNoMixed')}
            </Pressable>
            <Switch
              value={speechNoMixedSwitch}
              onValueChange={setSpeechNoMixedSwitch}
              trackColor={{ true: theme.colors.primary }}
            />
          </View>
          {/* 説明は子の行に合わせてインデントする。⚠️ 閉じているときに空の View を残さない
              （親が `gap` を持つので、中身が無くても隙間だけ空いてしまう）。 */}
          {openInfo === 'speechNoMixed' && (
            <View style={{ paddingLeft: 16 }}>
              {infoBox('speechNoMixed', 'settings.speechNoMixedSwitchHint')}
            </View>
          )}
        </>
      )}
      {speechVoiceRow(langOf(script), script)}
    </View>
  );

  /** その言語を読む声の行。**声が2つ以上あるときだけ**出す（1つなら選ぶ意味が無い）。
   *  言語行と同じく ⓘ は置かない（声ピッカーの上部に同じ文言が出る）。 */
  const speechVoiceRow = (language: string, script: SpeechScript) => {
    const list = voicesByLang[language];
    if (!list || list.length < 2) return null;
    const selected = list.find((v) => v.identifier === speechVoices[language]);
    return (
      <Pressable style={[styles.dataRow, { paddingLeft: 16 }]} onPress={() => setSpeechVoiceModal({ language, script })}>
        <View style={styles.dataRowText}>
          <Text style={[styles.dataRowTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('settings.speechVoice')}
          </Text>
        </View>
        <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.sm, fontWeight: '700' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
          {selected ? selected.name : t('settings.speechVoiceAuto')}
        </Text>
        <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
      </Pressable>
    );
  };

  const speechCard = (
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        {/* 説明は ⓘ に畳む（目標・タイマーの各カードと同じ形）。常時表示だとここだけ浮く。 */}
        <Pressable
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          onPress={() => toggleInfo('speech')}
          hitSlop={6}
        >
          <Text
            style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
          >
            {t('settings.speech')}
          </Text>
          {infoIcon('speech')}
        </Pressable>
        {infoBox('speech', 'settings.speechHint')}
        <View style={styles.notificationRow}>
          <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('settings.speechEnable')}
          </Text>
          <Switch
            value={speechEnabled}
            onValueChange={setSpeechEnabled}
            trackColor={{ true: theme.colors.primary }}
          />
        </View>

        {speechEnabled && (
          <>
            <View style={{ gap: 6 }}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('settings.speechRate')}
              </Text>
              <View style={[styles.segmented, { backgroundColor: theme.colors.background }]}>
                {SPEECH_RATES.map((r) => (
                  <Pressable
                    key={r}
                    style={[styles.segment, r === speechRate && { backgroundColor: theme.colors.surface }]}
                    onPress={() => setSpeechRate(r)}
                  >
                    <Text
                      style={[
                        r === speechRate ? styles.segmentTextActive : styles.segmentText,
                        { color: r === speechRate ? theme.colors.primary : theme.colors.textSecondary, fontSize: theme.fontSize.sm },
                      ]}
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                    >
                      {r.toFixed(2)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* 050：文字体系ごとに言語を決める。ハングル・タイ文字などは1対1で決まるので
                行を出さない（選ばせる意味が無く設定画面が無駄に伸びる）。
                複数の言語が同じ文字を使うものだけ＝`CONFIGURABLE_SCRIPTS` を出す。 */}
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('settings.speechScriptSection')}
            </Text>
            {speechScriptRow('latin')}
            {speechScriptRow('han')}

            {/* 端末に選択肢が2つ以上ある文字体系が1つも無ければ、この行ごと出さない */}
            {visibleOtherScripts.length > 0 && (
              <>
                <Pressable style={styles.dataRow} onPress={() => setSpeechOtherScriptsOpen((v) => !v)}>
                  <View style={[styles.dataRowText, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                    <Text style={[styles.dataRowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                      {t('settings.speechScriptOthers')}
                    </Text>
                    <Pressable onPress={() => toggleInfo('speechScriptOthers')} hitSlop={8}>
                      {infoIcon('speechScriptOthers')}
                    </Pressable>
                  </View>
                  <Ionicons
                    name={speechOtherScriptsOpen ? 'chevron-down' : 'chevron-forward'}
                    size={theme.fontSize.lg}
                    color={theme.colors.iconSubtle}
                  />
                </Pressable>
                {infoBox('speechScriptOthers', 'settings.speechScriptOthersHint')}
                {speechOtherScriptsOpen && visibleOtherScripts.map((s) => speechScriptRow(s))}
              </>
            )}
          </>
        )}
      </View>
  );

  const speechVoiceModalEl = (
    <SpeechVoiceModal
      visible={speechVoiceModal !== null}
      language={speechVoiceModal?.language ?? 'en-US'}
      peers={speechVoiceModal ? scriptOptions?.[speechVoiceModal.script] ?? [] : undefined}
      value={speechVoiceModal ? speechVoices[speechVoiceModal.language] ?? null : null}
      onSelect={(id) => { if (speechVoiceModal) setSpeechVoice(speechVoiceModal.language, id); }}
      onClose={() => setSpeechVoiceModal(null)}
    />
  );

  const speechLangModalScript = speechLangModal ?? 'latin';
  const speechLangModalEl = (
    <SpeechLanguageModal
      visible={speechLangModal !== null}
      script={speechLangModalScript}
      value={speechScriptLangs[speechLangModalScript] ?? SCRIPT_DEFAULT_LANGS[speechLangModalScript]}
      onSelect={(code) => setSpeechScriptLang(speechLangModalScript, code)}
      onClose={() => setSpeechLangModal(null)}
    />
  );

  // 非 Pro でも直接到達しうるので、ロック状態はここでも提示する（ペイウォールへ誘導）。
  if (!isPro) {
    return (
      <SettingsDetail
        title={t('settings.studySettings')}
        // 非 Pro でも目標枚数・読み上げ（ともに無料）の i アイコンが開けるので、
        // Pro 側と同じく「開いている説明があれば先に閉じる」を渡す
        onBack={(direct) => {
          // 確認ダイアログ → 説明の順に閉じる（階層ディスマス）
          if (!direct && goalConflict) { dismissGoalConflict(); return; }
          if (!direct && openInfo) { setOpenInfo(null); return; }
          router.back();
        }}
      >
        <Pressable
          style={[styles.card, { backgroundColor: theme.colors.surface }]}
          onPress={() => router.push('/paywall')}
        >
          <View style={styles.proRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={styles.proTitleRow}>
                {/* 046: 画面タイトルと同じ「学習設定」だと、同じ画面に無料の目標枚数が並ぶため
                    何がロックされているのか伝わらない。ロック対象を具体名で示す。 */}
                <Text style={[styles.proTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('settings.studyProLockTitle')}
                </Text>
                <Ionicons name="lock-closed" size={theme.fontSize.sm} color={theme.colors.primary} />
              </View>
              <Text style={[styles.proSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('settings.fsrsLockedSubtitle')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
          </View>
        </Pressable>
        {goalCard}
        {speechCard}
        {goalConflictModal}
        {speechLangModalEl}
        {speechVoiceModalEl}
      </SettingsDetail>
    );
  }

  return (
    <SettingsDetail
      title={t('settings.studySettings')}
      onBack={(direct) => {
        if (!direct && goalConflict) { dismissGoalConflict(); return; }
        if (!direct && (showRetentionInfo || openInfo)) { setShowRetentionInfo(false); setOpenInfo(null); return; }
        router.back();
      }}
    >
      {/* FSRSカスタマイズ */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Text
          style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
        >
          {t('settings.fsrs')}
        </Text>
        {/* プリセット */}
        <View style={[styles.segmented, { backgroundColor: theme.colors.background }]}>
          {(['longTerm', 'standard', 'exam'] as FsrsPreset[]).map((preset) => {
            const active = FSRS_PRESET_RETENTION[preset] === fsrsDesiredRetention;
            const labelKey = ({
              exam: 'settings.fsrsPresetFocus',
              standard: 'settings.fsrsPresetStandard',
              longTerm: 'settings.fsrsPresetLongTerm',
            } as const)[preset];
            return (
              <Pressable
                key={preset}
                style={[styles.segment, active && { backgroundColor: theme.colors.surface }]}
                onPress={() => handleFsrsPresetSelect(preset)}
              >
                <Text style={[
                  styles.segmentText,
                  { color: active ? theme.colors.primary : theme.colors.textSecondary, fontSize: theme.fontSize.sm },
                  active && styles.segmentTextActive,
                ]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t(labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* 目標保持率 */}
        <View style={{ gap: 6 }}>
          <View style={styles.fsrsRetentionHeader}>
            <Pressable
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              onPress={() => setShowRetentionInfo((v) => !v)}
              hitSlop={6}
            >
              <Text style={[styles.fsrsSubLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('settings.fsrsRetention')}
              </Text>
              <Ionicons
                name={showRetentionInfo ? 'information-circle' : 'information-circle-outline'}
                size={Math.max(theme.fontSize.lg, 20)}
                color={theme.colors.textTertiary}
              />
            </Pressable>
            <Text style={[styles.fsrsRetentionValue, { color: theme.colors.primary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {Math.round(fsrsDesiredRetention * 100)}%
            </Text>
          </View>
          <Slider
            minimumValue={FSRS_RETENTION_MIN}
            maximumValue={FSRS_RETENTION_MAX}
            step={0.01}
            value={fsrsDesiredRetention}
            onValueChange={handleFsrsRetentionChange}
            minimumTrackTintColor={theme.colors.primary}
            maximumTrackTintColor={theme.colors.iconSubtle}
            thumbTintColor={theme.colors.primary}
          />
          <View style={styles.fsrsRetentionScale}>
            <Text style={[styles.fsrsScaleText, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
              {Math.round(FSRS_RETENTION_MIN * 100)}%
            </Text>
            <Text style={[styles.fsrsScaleText, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
              {Math.round(FSRS_RETENTION_MAX * 100)}%
            </Text>
          </View>
          {showRetentionInfo && (
            <View style={[styles.syncInfoBox, { backgroundColor: theme.colors.background }]}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: 20 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('settings.fsrsRetentionInfo')}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* 学習タイマー（036・Pro）。説明は常時表示せず、i アイコンのタップで展開（目標保持率と同じ流儀） */}
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Pressable
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          onPress={() => toggleInfo('general')}
          hitSlop={6}
        >
          <Text
            style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
          >
            {t('settings.studyTimer')}
          </Text>
          {infoIcon('general')}
        </Pressable>
        {infoBox('general', 'settings.studyTimerInfo')}
        <View style={styles.notificationRow}>
          <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('settings.studyTimerEnable')}
          </Text>
          <Switch
            value={studyTimerEnabled}
            onValueChange={setStudyTimerEnabled}
            trackColor={{ true: theme.colors.primary }}
          />
        </View>

        {studyTimerEnabled && (
          <>
            {/* 時間（1〜60分） */}
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('settings.studyTimerMinutes')}
                </Text>
                <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.lg, fontWeight: '700' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {t('settings.studyTimerMinutesValue', { n: studyTimerMinutes })}
                </Text>
              </View>
              <Slider
                minimumValue={STUDY_TIMER_MINUTES_MIN}
                maximumValue={STUDY_TIMER_MINUTES_MAX}
                step={1}
                value={studyTimerMinutes}
                onValueChange={setStudyTimerMinutes}
                minimumTrackTintColor={theme.colors.primary}
                maximumTrackTintColor={theme.colors.iconSubtle}
                thumbTintColor={theme.colors.primary}
              />
            </View>

            {/* 繰り返し回数（039 ポモドーロ・1〜12回。1回＝従来の単発タイマー） */}
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={() => toggleInfo('cycles')} hitSlop={6}>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                    {t('settings.studyTimerCycles')}
                  </Text>
                  {infoIcon('cycles')}
                </Pressable>
                <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.lg, fontWeight: '700' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {t('settings.studyTimerCyclesValue', { n: studyTimerCycles })}
                </Text>
              </View>
              <Slider
                minimumValue={STUDY_TIMER_CYCLES_MIN}
                maximumValue={STUDY_TIMER_CYCLES_MAX}
                step={1}
                value={studyTimerCycles}
                onValueChange={handleCyclesChange}
                minimumTrackTintColor={theme.colors.primary}
                maximumTrackTintColor={theme.colors.iconSubtle}
                thumbTintColor={theme.colors.primary}
              />
              {infoBox('cycles', 'settings.studyTimerCyclesInfo')}
            </View>

            {/* 休憩時間（1〜30分）＋通知注記。繰り返し2回以上のときだけ意味を持つ */}
            {studyTimerCycles >= 2 && (
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={() => toggleInfo('break')} hitSlop={6}>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                      {t('settings.studyTimerBreakMinutes')}
                    </Text>
                    {infoIcon('break')}
                  </Pressable>
                  <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.lg, fontWeight: '700' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                    {studyTimerBreakMinutes === 0
                      ? t('settings.studyTimerBreakNone')
                      : t('settings.studyTimerMinutesValue', { n: studyTimerBreakMinutes })}
                  </Text>
                </View>
                <Slider
                  minimumValue={STUDY_TIMER_BREAK_MINUTES_MIN}
                  maximumValue={STUDY_TIMER_BREAK_MINUTES_MAX}
                  step={1}
                  value={studyTimerBreakMinutes}
                  onValueChange={setStudyTimerBreakMinutes}
                  minimumTrackTintColor={theme.colors.primary}
                  maximumTrackTintColor={theme.colors.iconSubtle}
                  thumbTintColor={theme.colors.primary}
                />
                {infoBox('break', 'settings.studyTimerBreakNotice')}
              </View>
            )}

            {/* 円の表示（常に / 開始時 / オフ） */}
            <View style={{ gap: 6 }}>
              <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={() => toggleInfo('ring')} hitSlop={6}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('settings.studyTimerRingVisible')}
                </Text>
                {infoIcon('ring')}
              </Pressable>
              <View style={[styles.segmented, { backgroundColor: theme.colors.background }]}>
                {STUDY_TIMER_ELEMENT_MODES.map((mode) => {
                  const active = mode === studyTimerRing;
                  return (
                    <Pressable
                      key={mode}
                      style={[styles.segment, active && { backgroundColor: theme.colors.surface }]}
                      onPress={() => setStudyTimerRing(mode)}
                    >
                      <Text style={[
                        styles.segmentText,
                        { color: active ? theme.colors.primary : theme.colors.textSecondary, fontSize: theme.fontSize.sm },
                        active && styles.segmentTextActive,
                      ]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                        {modeLabel(mode)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {infoBox('ring', 'settings.studyTimerRingInfo')}
            </View>

            {/* 残り時間の表示（常に / 開始時 / オフ） */}
            <View style={{ gap: 6 }}>
              <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={() => toggleInfo('time')} hitSlop={6}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('settings.studyTimerShowTime')}
                </Text>
                {infoIcon('time')}
              </Pressable>
              <View style={[styles.segmented, { backgroundColor: theme.colors.background }]}>
                {STUDY_TIMER_ELEMENT_MODES.map((mode) => {
                  const active = mode === studyTimerTime;
                  return (
                    <Pressable
                      key={mode}
                      style={[styles.segment, active && { backgroundColor: theme.colors.surface }]}
                      onPress={() => setStudyTimerTime(mode)}
                    >
                      <Text style={[
                        styles.segmentText,
                        { color: active ? theme.colors.primary : theme.colors.textSecondary, fontSize: theme.fontSize.sm },
                        active && styles.segmentTextActive,
                      ]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                        {modeLabel(mode)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {infoBox('time', 'settings.studyTimerTimeInfo')}
            </View>

            {/* 終了時の動作 */}
            <View style={{ gap: 6 }}>
              <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={() => toggleInfo('end')} hitSlop={6}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('settings.studyTimerEndBehavior')}
                </Text>
                {infoIcon('end')}
              </Pressable>
              <View style={[styles.segmented, { backgroundColor: theme.colors.background }]}>
                {(['alert', 'blink'] as StudyTimerEndBehavior[]).map((behavior) => {
                  const active = behavior === studyTimerEndBehavior;
                  return (
                    <Pressable
                      key={behavior}
                      style={[styles.segment, active && { backgroundColor: theme.colors.surface }]}
                      onPress={() => setStudyTimerEndBehavior(behavior)}
                    >
                      <Text style={[
                        styles.segmentText,
                        { color: active ? theme.colors.primary : theme.colors.textSecondary, fontSize: theme.fontSize.sm },
                        active && styles.segmentTextActive,
                      ]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                        {t(behavior === 'alert' ? 'settings.studyTimerEndAlert' : 'settings.studyTimerEndBlink')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {infoBox('end', 'settings.studyTimerEndInfo')}
            </View>
          </>
        )}
      </View>

      {goalCard}
      {speechCard}
      {goalConflictModal}
      {speechLangModalEl}
      {speechVoiceModalEl}
    </SettingsDetail>
  );
}
