/**
 * 手動並べ替えロック中に DraggableFlatList のコンテナ Pan を「成立しない」状態にするための
 * 活性化距離（px）。
 *
 * ライブラリは `activationDistance` を `panGesture.activeOffsetY([-d, d])` に流すだけで
 * （react-native-draggable-flatlist/src/components/DraggableFlatList.tsx）、既定値は 0＝
 * 活性化条件なし＝指が少しでも動けば即活性化する。これがロック機能が必要だった理由＝
 * 行の横スワイプ（アーカイブ/削除）やタップをコンテナの Pan が奪う正体。
 *
 * RNGH は activeOffset を1つでも設定すると「その条件を満たしたときだけ活性化」に変わるため、
 * 指が到達し得ない距離を渡すと縦にも横にも活性化できなくなる（Swipeable が activeOffsetX だけ
 * 設定して縦スクロールを邪魔しないのと同じ仕組み）。これでリストを素の FlatList に差し替えなくても
 * 「ドラッグしないリスト」を作れるので、ロック切替でリストが再マウントされずスクロール位置が保たれる
 * （差し替え方式だと再マウント＝先頭に戻り、位置を復元しようとするとセル未描画のぶんパラパラ動く）。
 */
export const DRAG_LOCK_ACTIVATION_DISTANCE = 100000;
