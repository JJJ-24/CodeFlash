import { useTranslation } from 'react-i18next';

import { ConfirmModal } from '@/components/ConfirmModal';

interface Props {
  visible: boolean;
  /** true なら「保存」アクションも出す（名前が空などで保存不可のときは「破棄」のみ）。 */
  canSave: boolean;
  /** 「保存」選択時。モーダルを閉じる処理（setVisible(false) 等）も含めた閉包を渡す。 */
  onSave: () => void;
  /** 「破棄」選択時。モーダルを閉じて画面を離れる処理も含めた閉包を渡す。 */
  onDiscard: () => void;
  onClose: () => void;
}

/**
 * 入力系モーダル（デッキ/タグ/カードの新規・編集）共通の「変更を破棄しますか？」確認。
 * 破棄は確定操作のため Return は割り当てない（タップ/Esc のみ＝CLAUDE.md の方針）。
 */
export function DiscardConfirmModal({ visible, canSave, onSave, onDiscard, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <ConfirmModal
      visible={visible}
      message={t('common.discardChanges')}
      actions={canSave
        ? [
            { label: t('common.save'), onPress: onSave },
            { label: t('common.discard'), destructive: true, onPress: onDiscard },
          ]
        : [
            { label: t('common.discard'), destructive: true, onPress: onDiscard },
          ]
      }
      onClose={onClose}
    />
  );
}
