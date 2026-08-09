import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useSafeScrollsToTop } from '@/lib/useSafeScrollsToTop';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { constants as KeyCommand } from 'react-native-key-command';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { SwipeToDeleteRow } from '@/components/SwipeToDeleteRow';
import { EmptyState } from '@/components/EmptyState';
import { InfoModal } from '@/components/InfoModal';
import { InfoContent } from '@/components/InfoContent';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { DRAG_LOCK_ACTIVATION_DISTANCE } from '@/lib/dragLock';
import { deleteKeySpecs, useKeyCommands } from '@/lib/useKeyCommands';
import { useLockedHeaderHeights } from '@/lib/useLockedTopInset';
import { useRestoreStatusBar } from '@/lib/useRestoreStatusBar';
import { useListNavigation } from '@/hooks/useListNavigation';
import { useTheme, MAX_FONT_MULTIPLIER, SHADOW, fontSizeForDigits, themedFrameBorder, TAG_PRESET_COLORS as PRESET_COLORS } from '@/lib/theme';
import { resolveTagColor } from '@/lib/tagColors';
import { deleteTag, deleteTagsBulk, getAllTags, updateTagSortOrders, updateTagsColor } from '@/lib/database/tags';
import { useSettingsStore, type DeckSortOrder } from '@/store/settings';
import { usePendingFocusStore } from '@/store/pendingFocus';
import { useTagStore } from '@/store/tags';
import type { TagWithCount } from '@/store/tags';

const TAG_SHORTCUT_SECTIONS = [
  { titleKey: 'shortcut.catDisplay', items: [
    { key: 'M / ⇧M', descKey: 'shortcut.cycleSort' },
    { key: '⌘L', descKey: 'shortcut.toggleSortLock' },
    { key: 'S',      descKey: 'shortcut.toggleSelect' },
  ] },
  { titleKey: 'shortcut.catFocus', items: [
    { key: 'J / K',  descKey: 'shortcut.focusNextPrev' },
    { key: 'U / D',  descKey: 'shortcut.reorderUpDown' },
    { key: 'Return', descKey: 'shortcut.openFocused' },
    { key: 'P',      descKey: 'shortcut.editFocused' },
    { key: 'Delete', descKey: 'shortcut.deleteFocused' },
  ] },
  { titleKey: 'shortcut.catNavigate', items: [
    { key: 'N',      descKey: 'shortcut.new' },
    { key: 'B',      descKey: 'shortcut.back' },
  ] },
  { titleKey: 'shortcut.catOther', items: [
    { key: 'ESC',    descKey: 'shortcut.esc' },
    { key: '?',      descKey: 'shortcut.showShortcuts' },
  ] },
];

const TAG_SELECTION_SHORTCUT_SECTIONS = [
  { titleKey: 'shortcut.catDisplay', items: [
    { key: 'S',     descKey: 'shortcut.exitSelect' },
  ] },
  { titleKey: 'shortcut.catFocus', items: [
    { key: 'J / K', descKey: 'shortcut.focusNextPrev' },
    { key: 'Space', descKey: 'shortcut.toggleCheck' },
    { key: 'A',     descKey: 'shortcut.selectAll' },
    { key: 'U / D', descKey: 'shortcut.reorderSelectedTagsUpDown' },
    { key: 'C',     descKey: 'shortcut.changeColorSelected' },
    { key: 'Delete', descKey: 'shortcut.deleteSelectedTags' },
  ] },
  { titleKey: 'shortcut.catOther', items: [
    { key: 'ESC',   descKey: 'shortcut.esc' },
    { key: '?',     descKey: 'shortcut.showShortcuts' },
  ] },
];

export default function TagsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  // 標準ヘッダーと同じ高さ算出（Dynamic Island 補正込み）。lib/useLockedTopInset.ts 参照。
  const headerHeights = useLockedHeaderHeights();
  useRestoreStatusBar();
  const { width: screenWidth } = useWindowDimensions();
  // ホーム/タグカード一覧のフィルターブロックと同じ寸法（4列レイアウトの1ブロック幅）
  const blockWidth = (screenWidth - 56) / 4;
  const filterBlockMinHeight = 32 + Math.ceil(fontSizeForDigits(theme, 1) * 1.35) + 2 + Math.ceil(theme.fontSize.xs * 1.35);
  const lastFocusTimeRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const savedScrollOffsetRef = useRef(0);
  const restorationEndTimeRef = useRef(0);
  const { tags, setTags, reorderTags, removeTag } = useTagStore();
  const { keyboardShortcutsEnabled, tagSortOrder, setTagSortOrder, tagSortLocked, setTagSortLocked } = useSettingsStore();

  const [selectionMode, setSelectionMode] = useState(false);
  // ステータスバータップで先頭へ（iOS標準 scrollsToTop）。フォーカス中の画面だけ有効にする
  // （有効候補が複数あると iOS が機能を無効化するため）。さらに iPadOS 26 は scrollsToTop を
  // タップ無しで誤発火させる（ポップ遷移で戻ると一瞬ちらつく／iPad で選択モードを切り替えると
  // 最下部から先頭へ飛ぶ）。selectionMode を渡して、選択モードを切り替えたらこの画面にいる
  // あいだは二度と武装しないようにする（詳細は lib/useSafeScrollsToTop.ts）。
  const scrollsToTopArmed = useSafeScrollsToTop(selectionMode);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [pickedColor, setPickedColor] = useState<string>(PRESET_COLORS[0]);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);

  const sortedTags = useMemo(() => {
    if (tagSortOrder === 'name') return [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    if (tagSortOrder === 'cardCount') return [...tags].sort((a, b) => b.cardCount - a.cardCount);
    return tags;
  }, [tags, tagSortOrder]);

  // 手動ソート かつ 未ロックのときだけドラッグ並べ替えが有効。ロック中はドラッグを止めてスワイプ可にする（ホームと同方式）。
  const tagDragActive = tagSortOrder === 'manual' && !tagSortLocked;
  // リストの種別はロックでは変えない（手動ソートなら常に DraggableFlatList）。
  // ロックで種別を切り替えると再マウントでスクロール位置が先頭に戻るため。ロック中の
  // 「ドラッグしないリスト」は activationDistance でコンテナ Pan を殺して作る（lib/dragLock.ts）。
  const tagListDraggable = tagSortOrder === 'manual';

  const { focusedIndex: focusedTagIndex, setFocusedIndex: setFocusedTagIndex, setFocusId, listRef, moveFocus } = useListNavigation(sortedTags, (tag) => tag.id);
  // 新規作成から戻った直後、その項目が一覧に現れたらフォーカス＋スクロールする用の保留 ID
  const pendingFocusTagIdRef = useRef<string | null>(null);
  const takePendingFocus = usePendingFocusStore((s) => s.takePendingFocus);

  // キーボードでの手動並べ替え（U=上へ / D=下へ）。手動ソート（未ロック）・非選択モード時のみ。
  // 並べ替え不可の状態ではカード一覧と同じ案内アラートを出す（無反応だと原因が分からないため。
  // 2026-07-18 に「静かに無効」から変更）。フォーカスは ID 追跡で自動追従。
  function moveTagOrder(dir: 'up' | 'down') {
    if (selectionMode) return; // 選択モードの U/D は moveSelectedTags が担当
    if (tagSortOrder !== 'manual') {
      setReorderInfo(<InfoContent text={t('card.reorderDisabledMessageSort')} />);
      return;
    }
    if (tagSortLocked) {
      setReorderInfo(<InfoContent text={t('card.reorderLockedMessage')} />);
      return;
    }
    if (focusedTagIndex === null) return;
    const to = dir === 'up' ? focusedTagIndex - 1 : focusedTagIndex + 1;
    if (to < 0 || to >= sortedTags.length) return;
    const newOrder = [...sortedTags];
    const [moved] = newOrder.splice(focusedTagIndex, 1);
    newOrder.splice(to, 0, moved);
    reorderTags(newOrder);
    updateTagSortOrders(db, newOrder.map((tg) => tg.id));
    setTimeout(() => (listRef.current as any)?.scrollToIndex({ index: to, viewPosition: 0.5, animated: true }), 50);
  }

  // 038 Phase2: 選択モードの U/D = 選択タグのまとめ並べ替え（カード一覧と同じ方向集約モデル）。
  // 選択タグ群（表示順のまま）を「U=選択中の最上部タグの1つ上 / D=最下部タグの1つ下」の位置へ
  // 集約配置する。端ではクランプ。選択順には依存しない。有効条件は単一並べ替えと同じ
  // 「手動ソート＋未ロック」で、無効時は moveTagOrder と同じ案内アラートを出す。
  function moveSelectedTags(dir: 'up' | 'down') {
    if (tagSortOrder !== 'manual') {
      setReorderInfo(<InfoContent text={t('card.reorderDisabledMessageSort')} />);
      return;
    }
    if (tagSortLocked) {
      setReorderInfo(<InfoContent text={t('card.reorderLockedMessage')} />);
      return;
    }
    const group = sortedTags.filter((tg) => selectedTagIds.has(tg.id));
    if (group.length === 0) return;
    const others = sortedTags.filter((tg) => !selectedTagIds.has(tg.id));
    const idxTop = sortedTags.findIndex((tg) => selectedTagIds.has(tg.id));
    let idxBottom = -1;
    for (let i = sortedTags.length - 1; i >= 0; i--) {
      if (selectedTagIds.has(sortedTags[i].id)) { idxBottom = i; break; }
    }
    // 挿入位置 p ＝ 最終配置でのブロック先頭位置（選択タグを除いた others への挿入位置と一致）
    const p = dir === 'up'
      ? Math.max(0, idxTop - 1)
      : Math.min(others.length, idxBottom + 2 - group.length);
    const newOrder = [...others.slice(0, p), ...group, ...others.slice(p)];
    if (newOrder.every((tg, i) => tg.id === sortedTags[i].id)) return; // 端クランプで無変化
    reorderTags(newOrder);
    updateTagSortOrders(db, newOrder.map((tg) => tg.id));
    // 移動方向の端（上=ブロック先頭 / 下=ブロック末尾）が見える位置へスクロール
    const scrollIdx = dir === 'up' ? p : Math.min(p + group.length - 1, newOrder.length - 1);
    setTimeout(() => (listRef.current as any)?.scrollToIndex({ index: scrollIdx, viewPosition: 0.5, animated: true }), 50);
  }

  const selectedCardsCount = useMemo(
    () => sortedTags.filter(t => selectedTagIds.has(t.id)).reduce((sum, t) => sum + t.cardCount, 0),
    [sortedTags, selectedTagIds]
  );

  const SORT_OPTIONS: { key: DeckSortOrder; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { key: 'manual',    icon: 'reorder-three-outline' },
    { key: 'name',      icon: 'text-outline' },
    { key: 'cardCount', icon: 'layers-outline' },
  ];
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showTagListInfo, setShowTagListInfo] = useState(false);
  // U/D 並べ替え不可時の案内（カード一覧と同方針・文言も card.* を流用）。タグには
  // フィルター条件が無いため sort/locked の2種のみ。閉じる瞬間にフェード中の中身が
  // 空にならないよう直前内容を ref で保持する（カード一覧 lastInfoModalRef と同パターン）。
  const [reorderInfo, setReorderInfo] = useState<React.ReactNode | null>(null);
  const lastReorderInfoRef = useRef<React.ReactNode | null>(null);
  if (reorderInfo) lastReorderInfoRef.current = reorderInfo;
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pendingDeleteTag, setPendingDeleteTag] = useState<TagWithCount | null>(null);

  function enterSelectionMode() {
    setSelectionMode(true);
    // フォーカス中の項目はカーソル（オレンジ枠）として残すが、初期選択はしない。
    // （フォーカス項目以外を選びたいケースが多く、自動チェックは誤選択を生むため）
    setSelectedTagIds(new Set());
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedTagIds(new Set());
    // カーソル（オレンジ枠）は通常モードのフォーカスへ引き継ぐ（消えた項目は ID 基準で自動的に null）
  }

  function toggleSelectTag(id: string) {
    setSelectedTagIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedTagIds.size === sortedTags.length) {
      setSelectedTagIds(new Set());
    } else {
      setSelectedTagIds(new Set(sortedTags.map(t => t.id)));
    }
  }

  function confirmDelete(tag: TagWithCount) {
    setPendingDeleteTag(tag);
    setShowDeleteModal(true);
  }

  async function handleDeleteConfirm() {
    if (!pendingDeleteTag) return;
    setShowDeleteModal(false);
    await deleteTag(db, pendingDeleteTag.id);
    removeTag(pendingDeleteTag.id);
    setPendingDeleteTag(null);
  }

  async function handleBulkDelete() {
    if (selectedTagIds.size === 0 || isProcessing) return;
    setIsProcessing(true);
    setShowBulkDeleteModal(false);
    const ids = Array.from(selectedTagIds);
    const idsSet = new Set(ids);
    await deleteTagsBulk(db, ids);
    setTags(tags.filter(t => !idsSet.has(t.id)));
    exitSelectionMode();
    setIsProcessing(false);
  }

  async function handleBulkColorChange() {
    if (selectedTagIds.size === 0 || isProcessing) return;
    setIsProcessing(true);
    setShowColorPicker(false);
    const ids = Array.from(selectedTagIds);
    const idsSet = new Set(ids);
    const color = pickedColor;
    await updateTagsColor(db, ids, color);
    setTags(tags.map(t => idsSet.has(t.id) ? { ...t, color } : t));
    exitSelectionMode();
    setIsProcessing(false);
  }

  // カラーピッカーの選択色を巡回（C=順送り / Shift+C=逆順）。タグ新規/編集と同じ操作感。
  function cycleColor(dir: number) {
    setPickedColor((cur) => {
      const list = PRESET_COLORS as readonly string[];
      const i = list.indexOf(cur);
      const n = list.length;
      return list[(i + dir + n) % n];
    });
  }

  useFocusEffect(
    useCallback(() => {
      lastFocusTimeRef.current = Date.now();
      // 新規作成から戻った場合の作成タグ ID を保留（一覧再読込後に下の effect がフォーカス＋スクロール）。
      // その場合はスクロール位置の復元をしない（作成タグへスクロールするため）。
      const pendingFocusTag = takePendingFocus('tag')?.id ?? null;
      pendingFocusTagIdRef.current = pendingFocusTag;
      const targetOffset = savedScrollOffsetRef.current;
      restorationEndTimeRef.current = pendingFocusTag ? 0 : Date.now() + 800;
      let cancelled = false;
      getAllTags(db).then((loadedTags) => {
        if (cancelled) return;
        setTags(loadedTags);
        if (pendingFocusTag) return;
        setTimeout(() => {
          if (!cancelled) (listRef.current as any)?.scrollToOffset({ offset: targetOffset, animated: false });
        }, 50);
      });
      return () => {
        cancelled = true;
        restorationEndTimeRef.current = 0;
        savedScrollOffsetRef.current = scrollOffsetRef.current;
      };
    }, [db])
  );

  // 保留 ID のタグが一覧に現れたらフォーカス（青枠）＋スクロールする。
  useEffect(() => {
    const id = pendingFocusTagIdRef.current;
    if (!id) return;
    const idx = sortedTags.findIndex((tg) => tg.id === id);
    if (idx === -1) return;
    pendingFocusTagIdRef.current = null;
    setFocusId(id);
    setTimeout(() => (listRef.current as any)?.scrollToIndex({ index: idx, viewPosition: 0.5, animated: true }), 60);
  }, [sortedTags, setFocusId, listRef]);

  // 034: 隠し TextInput を撤去しネイティブキーコマンドへ。J/K は両モード共通、その他は
  // 選択/通常モードで分岐（旧 onKeyPress/onSubmitEditing と同じ割り当て）。
  useKeyCommands([
    { input: 'j', handler: () => { if (showColorPicker) return; moveFocus('next'); } },
    { input: 'k', handler: () => { if (showColorPicker) return; moveFocus('prev'); } },
    // U/D: フォーカス中のタグを手動並べ替え（上へ/下へ）。手動ソート・非選択モード時のみ有効。
    // U/D: 通常モード＝フォーカスタグを手動並べ替え／選択モード＝選択タグをまとめ並べ替え（038）。
    { input: 'u', handler: () => { if (showColorPicker) return; if (selectionMode) moveSelectedTags('up'); else moveTagOrder('up'); } },
    { input: 'd', handler: () => { if (showColorPicker) return; if (selectionMode) moveSelectedTags('down'); else moveTagOrder('down'); } },
    {
      input: ' ',
      handler: () => {
        if (showColorPicker) return;
        if (selectionMode && focusedTagIndex !== null && sortedTags[focusedTagIndex]) {
          toggleSelectTag(sortedTags[focusedTagIndex].id);
        }
      },
    },
    { input: 'a', handler: () => { if (showColorPicker) return; if (selectionMode) toggleSelectAll(); } },
    // ⌘A = 全選択（選択モードのみ・OS 慣習のエイリアス）
    { input: 'a', modifierFlags: KeyCommand.keyModifierCommand, handler: () => { if (showColorPicker) return; if (selectionMode) toggleSelectAll(); } },
    {
      input: 'c',
      handler: () => {
        // カラーピッカー表示中は C=順送り。選択モードで未表示なら C で開く。
        if (showColorPicker) { cycleColor(1); return; }
        if (selectionMode && selectedTagIds.size > 0) { setPickedColor(PRESET_COLORS[0]); setShowColorPicker(true); }
      },
    },
    { input: 'c', modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (showColorPicker) cycleColor(-1); } },
    ...deleteKeySpecs(() => {
      if (showColorPicker) return;
      if (selectionMode) {
        if (selectedTagIds.size > 0) setShowBulkDeleteModal(true);
      } else if (focusedTagIndex !== null && sortedTags[focusedTagIndex]) {
        confirmDelete(sortedTags[focusedTagIndex]);
      }
    }),
    { input: 's', handler: () => { if (showColorPicker) return; if (selectionMode) exitSelectionMode(); else enterSelectionMode(); } },
    {
      input: 'p',
      handler: () => {
        if (showColorPicker) return;
        if (!selectionMode && focusedTagIndex !== null && sortedTags[focusedTagIndex]) {
          router.push(`/tags/${sortedTags[focusedTagIndex].id}/edit`);
        }
      },
    },
    { input: 'n', handler: () => { if (showColorPicker) return; if (!selectionMode) router.push('/tags/new'); } },
    {
      input: 'm',
      handler: () => {
        if (showColorPicker || selectionMode) return;
        const idx = SORT_OPTIONS.findIndex((o) => o.key === tagSortOrder);
        setTagSortOrder(SORT_OPTIONS[(idx + 1) % SORT_OPTIONS.length].key);
      },
    },
    {
      input: 'm',
      modifierFlags: KeyCommand.keyModifierShift,
      handler: () => {
        if (showColorPicker || selectionMode) return;
        const n = SORT_OPTIONS.length;
        const idx = SORT_OPTIONS.findIndex((o) => o.key === tagSortOrder);
        setTagSortOrder(SORT_OPTIONS[(idx - 1 + n) % n].key);
      },
    },
    // ⌘L = ドラッグ並べ替えロックの切替（手動ソート時のみ・ホーム/カード一覧と統一）。
    { input: 'l', modifierFlags: KeyCommand.keyModifierCommand, handler: () => { if (showColorPicker || selectionMode) return; if (tagSortOrder === 'manual') setTagSortLocked(!tagSortLocked); } },
    { input: 'b', handler: () => { if (showColorPicker) return; if (!selectionMode) router.back(); } },
    {
      input: KeyCommand.keyInputEnter,
      handler: () => {
        // カラーピッカー表示中は Return=適用。
        if (showColorPicker) { handleBulkColorChange(); return; }
        if (!selectionMode && focusedTagIndex !== null && sortedTags[focusedTagIndex]) {
          router.push({ pathname: '/tags/[tagId]/cards', params: { tagId: sortedTags[focusedTagIndex].id } });
        }
      },
    },
    // 矢印キー: 上下=K/J（push 画面なので左右=,/. は無し）
    { input: KeyCommand.keyInputUpArrow, handler: () => { if (showColorPicker) return; moveFocus('prev'); } },
    { input: KeyCommand.keyInputDownArrow, handler: () => { if (showColorPicker) return; moveFocus('next'); } },
    // ?（Shift+/）= ショートカット一覧を開く（閉じる/トグルは ShortcutsModal 側が担当）
    { input: '/', modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (showColorPicker) return; setShowShortcutsModal((v) => !v); } },
  // 削除確認/一括削除/情報/ショートカット一覧の表示中は背景ナビを解除（カラーピッカーは C/Shift+C/Return を
  // 使うので除外＝main 有効のまま。各ナビは showColorPicker を個別ガード済み）。
  ], !showDeleteModal && !showBulkDeleteModal && !showTagListInfo && !showShortcutsModal && !reorderInfo);

  // ESC は常時有効：オーバーレイ → 選択モード解除 → 戻る。削除系は Return 非割当（タップのみ）。
  useKeyCommands([
    {
      input: KeyCommand.keyInputEscape,
      handler: () => {
        if (showColorPicker) { setShowColorPicker(false); return; }
        if (showBulkDeleteModal) { setShowBulkDeleteModal(false); return; }
        if (showDeleteModal) { setShowDeleteModal(false); setPendingDeleteTag(null); return; }
        if (showTagListInfo) { setShowTagListInfo(false); return; }
        if (reorderInfo) { setReorderInfo(null); return; }
        if (showShortcutsModal) { setShowShortcutsModal(false); return; }
        if (selectionMode) { exitSelectionMode(); return; }
        router.back();
      },
    },
  ]);

  // 「OK のみ」アラート（情報/ショートカット一覧）は Return=OK（閉じる）。表示中のみ有効（main は解除済み）。
  useKeyCommands([
    {
      input: KeyCommand.keyInputEnter,
      handler: () => {
        if (showTagListInfo) { setShowTagListInfo(false); return; }
        if (reorderInfo) { setReorderInfo(null); return; }
        if (showShortcutsModal) { setShowShortcutsModal(false); return; }
      },
    },
  ], showTagListInfo || showShortcutsModal || Boolean(reorderInfo));

  // タグ行の共通レンダラー（DraggableFlatList / 素の FlatList 両分岐で共用）。
  // ScaleDecorator はドラッグ有効時のみ呼び出し側で被せる。
  const renderTagRow = (item: TagWithCount, index: number | undefined, drag: (() => void) | null, isActive = false) => {
    const isFocused = focusedTagIndex !== null && index === focusedTagIndex;
    const isSelected = selectedTagIds.has(item.id);
    // 038 Phase4: 選択モードのまとめ移動ドラッグ中は「×N」バッジを出す（2枚以上のとき）。
    const bulkDragCount = isActive && selectionMode && isSelected && selectedTagIds.size > 1 ? selectedTagIds.size : null;
    return (
      <SwipeToDeleteRow
                  enabled={!selectionMode && !tagDragActive}
                  onDelete={() => confirmDelete(item)}
                >
                  <Pressable
                    style={[
                      styles.tagItem,
                      { backgroundColor: theme.colors.surface },
                      isFocused && !selectionMode && { borderWidth: 2, borderColor: theme.colors.primary },
                      isSelected && { borderWidth: 2, borderColor: theme.colors.primary },
                      isFocused && selectionMode && { borderWidth: 2, borderColor: '#F57C00' },
                    ]}
                    onPress={() => {
                      const idx = index;
                      if (selectionMode) {
                        if (idx !== undefined) setFocusedTagIndex(idx);
                        toggleSelectTag(item.id);
                        return;
                      }
                      if (idx !== undefined) setFocusedTagIndex(idx);
                      router.push({ pathname: '/tags/[tagId]/cards', params: { tagId: item.id } });
                    }}
                    // 038 Phase4: 選択モードは「選択中タグの長押し」だけまとめ移動のドラッグを開始
                    //（ドロップ時展開方式。未選択タグの長押しは何もしない）。通常モードは従来どおり。
                    // 並べ替え不可の状態（手動ソート以外/ロック中）は U/D と同じ案内アラートを出す。
                    onLongPress={() => {
                      if (tagSortOrder !== 'manual') {
                        setReorderInfo(<InfoContent text={t('card.reorderDisabledMessageSort')} />);
                        return;
                      }
                      if (tagSortLocked) {
                        setReorderInfo(<InfoContent text={t('card.reorderLockedMessage')} />);
                        return;
                      }
                      if (selectionMode && !isSelected) return;
                      drag?.();
                    }}
                  >
                    {selectionMode && (
                      <Ionicons
                        name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                        size={24}
                        color={isSelected ? theme.colors.primary : theme.colors.textTertiary}
                      />
                    )}
                    <View style={[styles.colorDot, { backgroundColor: resolveTagColor(item.color, theme) }]} />
                    <Text numberOfLines={1} style={[styles.tagName, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{item.name}</Text>
                    {/* 038: まとめ移動ドラッグ中の「×N」バッジ（枚数バッジと同形状・primary 色） */}
                    {bulkDragCount != null && (
                      <View style={[styles.countBadge, { backgroundColor: theme.colors.primary }]}>
                        <Text allowFontScaling={false} style={[styles.countBadgeText, { fontSize: theme.fontSize.sm }]}>{`×${bulkDragCount}`}</Text>
                      </View>
                    )}
                    <View style={[styles.countBadge, { backgroundColor: theme.dark ? '#4B5563' : '#8B949E' }]}>
                      <Text style={[styles.countBadgeText, { fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{item.cardCount}</Text>
                    </View>
                    {!selectionMode && (
                      <>
                        <Pressable onPress={() => { const idx = index; if (idx !== undefined) setFocusedTagIndex(idx); router.push(`/tags/${item.id}/edit`); }} hitSlop={8} style={styles.editBtn}>
                          <Ionicons name="pencil-sharp" size={theme.fontSize.xxl} color={theme.colors.primary} />
                        </Pressable>
                        <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.textTertiary} />
                      </>
                    )}
                  </Pressable>
                </SwipeToDeleteRow>
    );
  };

  return (
    <GestureHandlerRootView style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* インラインカスタムヘッダー */}
      <View style={{ height: headerHeights.total, backgroundColor: theme.colors.surface }}>
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: headerHeights.content,
          flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8,
        }}>
          <Pressable
            onPress={keyboardShortcutsEnabled ? () => setShowShortcutsModal(true) : undefined}
            style={{
              position: 'absolute', left: 0, right: 0,
              alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
            }}
          >
            <Text style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {selectionMode ? t('shortcut.selectMode') : t('tag.title')}
            </Text>
            {keyboardShortcutsEnabled && (
              <MaterialIcons name="keyboard" size={22} color={theme.colors.primary} />
            )}
          </Pressable>
          <Pressable
            onPress={() => { if (Date.now() - lastFocusTimeRef.current >= 350) router.back(); }}
            style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
            hitSlop={4}
          >
            <Ionicons name="chevron-back" size={28} color={theme.colors.text} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={selectionMode ? exitSelectionMode : enterSelectionMode}
            disabled={!selectionMode && sortedTags.length === 0}
            style={[{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, !selectionMode && sortedTags.length === 0 && { opacity: 0.3 }]}
            hitSlop={4}
          >
            <Ionicons
              name={selectionMode ? 'close' : 'albums-outline'}
              size={26}
              color={theme.colors.primary}
            />
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1 }}>
      {/* 総数ブロック（他画面のフィルターブロックと統一）。タグにアーカイブ概念は
          無いため「すべて」のみの非操作の数値表示にする。
          余白タップでフォーカス解除は、リストの祖先 Pressable だと押せる要素のない場所からの
          ドラッグでスクロールが始まらない不具合があるため、固定部とリスト内フッターに分ける（統計参照）。 */}
      <Pressable style={styles.filterRow} onPress={() => setFocusedTagIndex(null)}>
        <View style={[styles.statItem, { backgroundColor: theme.colors.surface, width: blockWidth, minHeight: filterBlockMinHeight, margin: 0, borderWidth: 2, borderColor: theme.colors.primary }]}>
          <Text numberOfLines={1} allowFontScaling={false} style={[styles.statValue, { color: theme.colors.primary, fontSize: fontSizeForDigits(theme, (Platform as any).isPad ? 1 : String(tags.length).length) }]}>{tags.length}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('common.all')}</Text>
        </View>
      </Pressable>
      <View style={[styles.sectionRow, { paddingHorizontal: 16, paddingTop: 16, backgroundColor: theme.colors.background }]}>
        <View style={styles.sectionTitleCol}>
          {selectionMode ? (
            <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('tag.selectHint')}
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {t('tag.tagListTitle')}
              </Text>
              <Pressable onPress={() => setShowTagListInfo(true)} hitSlop={8} accessibilityLabel={t('tag.tagListInfoLabel')}>
                <Ionicons name="information-circle-outline" size={Math.max(theme.fontSize.lg, 20)} color={theme.colors.textTertiary} />
              </Pressable>
            </View>
          )}
          {!selectionMode && (
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {tagSortOrder === 'manual' && tagSortLocked
                ? t('home.sortDescManualLocked')
                : t(`home.sortDesc${tagSortOrder.charAt(0).toUpperCase()}${tagSortOrder.slice(1)}`)}
            </Text>
          )}
        </View>
        {!selectionMode && (
          <View style={styles.sortButtons}>
            {/* 手動ソート時のみ表示：ドラッグ並べ替えロック（ON=固定してスワイプ可）。左端・枠なしアイコンのみ（ホームと統一）。 */}
            {tagSortOrder === 'manual' && (
              <Pressable
                // paddingVertical はソートチップ（styles.sortBtn の 4）に合わせる。大きいと
                // ロックがチップより背高になり、手動切替時に行の高さが増えて他アイコンが下にずれる。
                style={{ justifyContent: 'center', alignItems: 'center', paddingVertical: 4, paddingHorizontal: (Platform as any).isPad ? 12 : 6 }}
                hitSlop={8}
                onPress={() => setTagSortLocked(!tagSortLocked)}
              >
                <Ionicons
                  name={tagSortLocked ? 'lock-closed' : 'lock-open-outline'}
                  size={(Platform as any).isPad ? Math.max(theme.fontSize.xl, 22) : Math.max(theme.fontSize.xl, 20)}
                  color={tagSortLocked ? theme.colors.primary : theme.colors.textSecondary}
                />
              </Pressable>
            )}
            {SORT_OPTIONS.map(({ key, icon }) => {
              const active = tagSortOrder === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setTagSortOrder(key)}
                  style={[
                    styles.sortBtn,
                    { borderColor: active ? theme.colors.primary : themedFrameBorder(theme), paddingHorizontal: (Platform as any).isPad ? 32 : 8 },
                    active && { backgroundColor: theme.colors.primary },
                  ]}
                >
                  <Ionicons name={icon} size={(Platform as any).isPad ? Math.max(theme.fontSize.xl, 22) : Math.max(theme.fontSize.xl, 20)} color={active ? theme.colors.primaryText : theme.colors.textSecondary} />
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {tags.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: theme.colors.background }]}>
          <EmptyState icon="pricetags-outline" title={t('tag.empty')} subtitle={t('tag.emptySub')} />
        </View>
      ) : tagListDraggable ? (
        // 手動ソートのときだけ DraggableFlatList を使う（ロックでは切り替えない＝再マウントさせない）。
        // それ以外は素の FlatList。DraggableFlatList はリスト全体を RNGH のパンで包むため、
        // 慣性スクロール整定直後のスワイプを取りこぼす（1〜2回空振り）ことがある（カード一覧と同じ対策）。
        <DraggableFlatList
          ref={listRef as any}
          // ロック中はコンテナ Pan を成立させない＝素の FlatList と同じ当たり方にする。
          activationDistance={tagDragActive ? undefined : DRAG_LOCK_ACTIVATION_DISTANCE}
          style={{ backgroundColor: theme.colors.background }}
          // 外側コンテナを flex:1 でビューポート高さに制約する。これが無いとコンテナが
          // コンテンツ高さになり、下方向ドラッグ時の autoscroll（containerSize 基準）が
          // 発火しない。※ style ではなく containerStyle に付けること（style は内側の
          // FlatList に渡り、高さ未定義の外側コンテナ内で flex:1 が 0 高さに潰れて
          // リストが描画されなくなる）。
          containerStyle={{ flex: 1 }}
          // autoscroll をゆっくりにして細かい位置調整を可能にする（パッチで animated:false
          // にしているため既定値だと一気にスクロールしてしまう）。要調整の数値。
          autoscrollSpeed={5}
          data={sortedTags}
          keyExtractor={(item) => item.id}
          onScrollToIndexFailed={(info) => {
            (listRef.current as any)?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(() => (listRef.current as any)?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: false }), 100);
          }}
          contentContainerStyle={[styles.list, selectionMode && { paddingBottom: 160 }]}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          automaticallyAdjustsScrollIndicatorInsets={false}
          scrollsToTop={scrollsToTopArmed}
          onScrollOffsetChange={(offset) => {
            scrollOffsetRef.current = offset;
            if (
              Date.now() < restorationEndTimeRef.current &&
              savedScrollOffsetRef.current > 50 &&
              offset < savedScrollOffsetRef.current - 30
            ) {
              (listRef.current as any)?.scrollToOffset({ offset: savedScrollOffsetRef.current, animated: false });
            }
          }}
          onScrollBeginDrag={() => { restorationEndTimeRef.current = 0; }}
          onDragEnd={({ data, from, to }) => {
            if (!tagDragActive) return;
            if (selectionMode) {
              // 038 Phase4: まとめ移動（ドロップ時展開方式・カード一覧と同ロジック）。
              // アンカー1枚だけ動いた data から「選択タグを抜き、アンカーの落ちた隙間に
              // 選択タグ群（ドラッグ前の表示順）を挿入」した最終並びを作る。
              // 動かさず元の位置に落とした場合はキャンセル（散在選択でも集約しない）。
              if (from === to) return;
              const sel = selectedTagIds;
              const dragged = data[to];
              if (!dragged || !sel.has(dragged.id)) return; // 保険（未選択行はドラッグ開始しない）
              let gap = 0;
              for (let i = 0; i < to; i++) if (!sel.has(data[i].id)) gap++;
              const others = data.filter((tg) => !sel.has(tg.id));
              const group = sortedTags.filter((tg) => sel.has(tg.id));
              const newOrder = [...others.slice(0, gap), ...group, ...others.slice(gap)];
              reorderTags(newOrder);
              updateTagSortOrders(db, newOrder.map((tg) => tg.id));
              return;
            }
            reorderTags(data);
            updateTagSortOrders(db, data.map((t) => t.id));
          }}
          ListFooterComponent={<Pressable style={{ height: 120 }} onPress={() => setFocusedTagIndex(null)} />}
          // ScaleDecorator はドラッグが実際に効くときだけ被せる（ロック中は素の行＝
          // カード一覧と同じ流儀。ロック中の行を今までと同じ構造に保つ）。
          renderItem={({ item, drag, getIndex, isActive }: RenderItemParams<TagWithCount>) =>
            tagDragActive ? (
              <ScaleDecorator>
                {renderTagRow(item, getIndex(), drag, isActive)}
              </ScaleDecorator>
            ) : (
              renderTagRow(item, getIndex(), drag, isActive)
            )
          }
        />
      ) : (
        <FlatList<TagWithCount>
          ref={listRef}
          style={{ flex: 1, backgroundColor: theme.colors.background }}
          data={sortedTags}
          keyExtractor={(item) => item.id}
          onScrollToIndexFailed={(info) => {
            (listRef.current as any)?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(() => (listRef.current as any)?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: false }), 100);
          }}
          contentContainerStyle={[styles.list, selectionMode && { paddingBottom: 160 }]}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          automaticallyAdjustsScrollIndicatorInsets={false}
          scrollsToTop={scrollsToTopArmed}
          scrollEventThrottle={16}
          onScroll={(e) => {
            const offset = e.nativeEvent.contentOffset.y;
            scrollOffsetRef.current = offset;
            if (
              Date.now() < restorationEndTimeRef.current &&
              savedScrollOffsetRef.current > 50 &&
              offset < savedScrollOffsetRef.current - 30
            ) {
              (listRef.current as any)?.scrollToOffset({ offset: savedScrollOffsetRef.current, animated: false });
            }
          }}
          onScrollBeginDrag={() => { restorationEndTimeRef.current = 0; }}
          ListFooterComponent={<Pressable style={{ height: 120 }} onPress={() => setFocusedTagIndex(null)} />}
          renderItem={({ item, index }) => renderTagRow(item, index, null)}
        />
      )}

      {/* FAB: 戻る */}
      {!selectionMode && (
        <Pressable
          style={[styles.fab, { left: 20, backgroundColor: theme.colors.primary }]}
          onPress={() => { if (Date.now() - lastFocusTimeRef.current >= 350) router.back(); }}
        >
          <Ionicons name="chevron-back" size={28} color="#FFF" />
        </Pressable>
      )}

      {/* FAB: 新規タグ作成 */}
      {!selectionMode && (
        <Pressable
          style={[styles.fab, { right: 20, backgroundColor: theme.colors.primary }]}
          onPress={() => router.push('/tags/new')}
        >
          <Ionicons name="add" size={28} color="#FFF" />
        </Pressable>
      )}
      </View>

      {/* 選択モードバー */}
      {selectionMode && (
        <View style={[styles.selectionBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }]}>
          <Pressable
            onPress={toggleSelectAll}
            style={[styles.iconBtn, { backgroundColor: theme.colors.primary }]}
          >
            <Ionicons
              name={selectedTagIds.size > 0 && selectedTagIds.size === sortedTags.length ? 'checkmark-circle' : 'checkmark-circle-outline'}
              size={22}
              color="#FFF"
            />
          </Pressable>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.md, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('tag.selectedCount', { count: selectedTagIds.size })}
          </Text>
          <View style={styles.selectionActions}>
            <Pressable
              style={[styles.iconBtn, { backgroundColor: theme.colors.primary }, (selectedTagIds.size === 0 || isProcessing) && { opacity: 0.4 }]}
              onPress={() => { if (selectedTagIds.size > 0 && !isProcessing) { setPickedColor(PRESET_COLORS[0]); setShowColorPicker(true); } }}
              disabled={selectedTagIds.size === 0 || isProcessing}
            >
              <Ionicons name="color-palette-outline" size={22} color="#FFF" />
            </Pressable>
            <Pressable
              style={[styles.iconBtn, { backgroundColor: '#C62828' }, (selectedTagIds.size === 0 || isProcessing) && { opacity: 0.4 }]}
              onPress={() => { if (selectedTagIds.size > 0 && !isProcessing) setShowBulkDeleteModal(true); }}
              disabled={selectedTagIds.size === 0 || isProcessing}
            >
              <Ionicons name="trash-outline" size={22} color="#FFF" />
            </Pressable>
          </View>
        </View>
      )}

      <InfoModal
        visible={showTagListInfo}
        title={t('tag.tagListTitle')}
        message={<InfoContent text={t('tag.tagListInfoMessage')} />}
        onClose={() => setShowTagListInfo(false)}
      />
      <InfoModal
        visible={reorderInfo !== null}
        title={t('card.reorderDisabledTitle')}
        message={reorderInfo ?? lastReorderInfoRef.current}
        onClose={() => setReorderInfo(null)}
      />
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        subtitle={selectionMode ? t('shortcut.selectMode') : t('shortcut.normalMode')}
        sections={(selectionMode ? TAG_SELECTION_SHORTCUT_SECTIONS : TAG_SHORTCUT_SECTIONS)
          .map((s) => ({ title: t(s.titleKey), items: s.items }))
        }
      />
      <ConfirmDeleteModal
        visible={showDeleteModal}
        message={t('tag.deleteConfirm', { name: pendingDeleteTag ? (pendingDeleteTag.name.length > 20 ? pendingDeleteTag.name.slice(0, 20) + '…' : pendingDeleteTag.name) : '' })}
        onConfirm={handleDeleteConfirm}
        onClose={() => { setShowDeleteModal(false); setPendingDeleteTag(null); }}
      />
      <ConfirmDeleteModal
        visible={showBulkDeleteModal}
        message={t('tag.deleteSelectedConfirm', { count: selectedTagIds.size, cardCount: selectedCardsCount })}
        onConfirm={handleBulkDelete}
        onClose={() => setShowBulkDeleteModal(false)}
      />

      {/* カラーピッカーモーダル */}
      <Modal
        visible={showColorPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowColorPicker(false)}
      >
        <Pressable style={styles.colorPickerOverlay} onPress={() => setShowColorPicker(false)}>
          <Pressable style={[styles.colorPickerSheet, { backgroundColor: theme.colors.surface }, (Platform as any).isPad && styles.colorPickerSheetPad]} onPress={() => {}}>
            <Text style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text, marginBottom: 16 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('tag.changeColor')}
            </Text>
            <View style={styles.colorGrid}>
              {PRESET_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.colorCell, { backgroundColor: c }, pickedColor === c && styles.colorCellSelected]}
                  onPress={() => setPickedColor(c)}
                >
                  {pickedColor === c && <Ionicons name="checkmark-sharp" size={18} color="#FFF" />}
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.colorPickerBtn, { backgroundColor: theme.colors.primary }]}
              onPress={handleBulkColorChange}
            >
              <Text style={{ color: '#FFF', fontWeight: '600', fontSize: theme.fontSize.md }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('common.apply')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 16, gap: 8, paddingBottom: 96 },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  filterRow: { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 16, paddingBottom: 4 },
  statItem: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 2,
    ...SHADOW.card,
  },
  statValue: { fontWeight: '700' },
  statLabel: { marginTop: 2, textAlign: 'center', fontWeight: '600' },
  sectionTitleCol: { flexDirection: 'column', gap: 2, flex: 1 },
  sectionTitle: { fontWeight: '700' },
  sortButtons: { flexDirection: 'row', gap: 6 },
  sortBtn: { borderRadius: 6, borderWidth: 1, paddingVertical: 4 },
  tagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderRadius: 12,
    ...SHADOW.subtle,
  },
  colorDot: { width: 16, height: 16, borderRadius: 8 },
  tagName: { flex: 1, fontWeight: '500' },
  countBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    minWidth: 28,
    alignItems: 'center',
  },
  countBadgeText: { fontWeight: '700', color: '#FFF' },
  editBtn: { padding: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  selectionActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  colorPickerSheet: {
    width: '100%',
    borderRadius: 16,
    padding: 24,
  },
  // iPad は12色が横一列に収まるちょうどの幅にする
  // （セル44×12 + ガタ10×11 + 余白24×2 = 686。狭いスプリットビューでは maxWidth で抑え、その時は折り返す）
  colorPickerSheetPad: {
    width: 686,
    maxWidth: '100%',
    alignSelf: 'center',
  },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  colorCell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorCellSelected: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  colorPickerBtn: {
    alignSelf: 'stretch',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
});
