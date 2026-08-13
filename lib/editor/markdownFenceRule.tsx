import { ScrollView, StyleSheet, View } from 'react-native';

import { SyntaxHighlightedCode } from '@/components/study/SyntaxHighlightedCode';
import { normalizeLanguage } from '@/lib/code-execution/constants';

/** 横スクロールに使う ScrollView（呼び出し側の事情で RN 標準／RNGH 版を使い分ける）。 */
type HorizontalScrollView = React.ComponentType<{
  horizontal?: boolean | null;
  showsHorizontalScrollIndicator?: boolean;
  alwaysBounceHorizontal?: boolean;
  children?: React.ReactNode;
}>;

/**
 * テキストブロック内マークダウンのコードフェンス（```js …）をシンタックスハイライトして描画する
 * `rules` 断片（学習画面 `BlocksView` と編集プレビュー `TextBlockItem` で共用）。
 *
 * ライブラリ既定の `fence` ルールは中身を等幅テキストで出すだけで、言語名（`node.sourceInfo`）を
 * 見ていない＝``` ```js ``` と ``` ``` ``` の見た目が同じだった。ここで言語を
 * `normalizeLanguage()`（TSV インポートと同じ規則。`js`→`javascript`、`c++`→`cpp` 等）で
 * 正規化し、学習画面のコードブロックと同じ `SyntaxHighlightedCode` に渡す。
 *
 * **折り返さず横スクロール**（コードブロックと同じ見せ方）。かつては折り返しにしていたが、
 * インデントが崩れて読みにくいうえコードブロックと不揃いだったため 2026-08-13 に揃えた。
 *
 * ⚠️ **`alwaysBounceHorizontal={false}` は必須**：学習セッションはカード送りに横 Pan
 * （`useSwipeGesture` の `activeOffsetX`）を使っており、横スクロール領域はそれより先にドラッグを取る。
 * 既定（true）のままだと**コードが幅に収まっていてもスクロールビューがドラッグを掴む**ので、
 * フェンスの上が「横スワイプでカードを送れない死角」になる。false なら収まっているときは
 * ドラッグを開始せず親のスワイプが通り、はみ出しているときだけ横スクロールする。
 *
 * ⚠️ **`ScrollComponent` は呼び出し側が渡す**：編集プレビュー（`TextBlockItem`）は
 * `NestableDraggableFlatList` の中にあるため **RNGH の ScrollView** でないと横スクロールが
 * ドラッグに奪われる（`CodeBlockItem` の `GHScrollView` と同じ事情）。学習画面（`BlocksView`）は
 * RN 標準でよい。
 *
 * @param background コード箱の背景色（学習画面はカードテーマの codeBackground）
 * @param fontSize   コードの文字サイズ（既存の fence スタイルと揃える）
 * @param ScrollComponent 横スクロールに使う ScrollView（既定は RN 標準）
 */
export function markdownFenceRule({
  background,
  fontSize,
  ScrollComponent = ScrollView,
}: {
  background: string;
  fontSize: number;
  ScrollComponent?: HorizontalScrollView;
}) {
  return {
    fence: (node: any) => {
      const language = normalizeLanguage(String(node.sourceInfo ?? ''));
      // パーサーが末尾に余分な改行を付けるので落とす（ライブラリ既定の fence ルールと同じ）
      const raw = typeof node.content === 'string' ? node.content : String(node.content ?? '');
      const content = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
      return (
        <View key={node.key} style={[styles.box, { backgroundColor: background }]}>
          <ScrollComponent horizontal showsHorizontalScrollIndicator={false} alwaysBounceHorizontal={false}>
            {/* 余白は外側の箱で持つので、ハイライター側の既定余白は 0 に戻す
                （padding: 0 では paddingHorizontal/paddingBottom を打ち消せないため個別に指定） */}
            <SyntaxHighlightedCode
              code={content}
              language={language}
              wrap={false}
              style={{ fontSize, lineHeight: Math.round(fontSize * 1.5), paddingHorizontal: 0, paddingBottom: 0 }}
            />
          </ScrollComponent>
        </View>
      );
    },
  };
}

const styles = StyleSheet.create({
  box: { borderRadius: 6, padding: 12, marginVertical: 4 },
});
