import { StyleSheet, View } from 'react-native';

import { SyntaxHighlightedCode } from '@/components/study/SyntaxHighlightedCode';
import { normalizeLanguage } from '@/lib/code-execution/constants';

/**
 * テキストブロック内マークダウンのコードフェンス（```js …）をシンタックスハイライトして描画する
 * `rules` 断片（学習画面 `BlocksView` と編集プレビュー `TextBlockItem` で共用）。
 *
 * ライブラリ既定の `fence` ルールは中身を等幅テキストで出すだけで、言語名（`node.sourceInfo`）を
 * 見ていない＝``` ```js ``` と ``` ``` ``` の見た目が同じだった。ここで言語を
 * `normalizeLanguage()`（TSV インポートと同じ規則。`js`→`javascript`、`c++`→`cpp` 等）で
 * 正規化し、学習画面のコードブロックと同じ `SyntaxHighlightedCode` に渡す。
 *
 * **折り返し表示**（`wrap` 既定）にしている。横スクロールにすると、テキストブロックの中に
 * 横方向のスクロール領域ができてカードの縦スクロール／フリップと競合しうるため。
 * マークダウン内のコードは短い例示が主用途なので折り返しで足りる。
 *
 * @param background コード箱の背景色（学習画面はカードテーマの codeBackground）
 * @param fontSize   コードの文字サイズ（既存の fence スタイルと揃える）
 */
export function markdownFenceRule({ background, fontSize }: { background: string; fontSize: number }) {
  return {
    fence: (node: any) => {
      const language = normalizeLanguage(String(node.sourceInfo ?? ''));
      // パーサーが末尾に余分な改行を付けるので落とす（ライブラリ既定の fence ルールと同じ）
      const raw = typeof node.content === 'string' ? node.content : String(node.content ?? '');
      const content = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
      return (
        <View key={node.key} style={[styles.box, { backgroundColor: background }]}>
          {/* 余白は外側の箱で持つので、ハイライター側の既定余白は 0 に戻す
              （padding: 0 では paddingHorizontal/paddingBottom を打ち消せないため個別に指定） */}
          <SyntaxHighlightedCode
            code={content}
            language={language}
            style={{ fontSize, lineHeight: Math.round(fontSize * 1.5), paddingHorizontal: 0, paddingBottom: 0 }}
          />
        </View>
      );
    },
  };
}

const styles = StyleSheet.create({
  box: { borderRadius: 6, padding: 12, marginVertical: 4 },
});
