---
name: NestableDraggableFlatList 内での位置計測
description: NestableDraggableFlatList の renderItem 内で onLayout を使っても正確な Y 座標が取れない理由と対処法
type: feedback
---

`NestableDraggableFlatList` の `renderItem` 内で `onLayout` を使っても、取得できる `y` はセル内相対座標（ほぼ 0）であり、スクロールコンテナ基準の正確な座標にならない。

**Why:** FlatList 系コンポーネントはアイテムを独立したセルとして描画するため、`onLayout` の座標はセル内ローカルになる。

**How to apply:** スクロールコンテナ基準の正確な Y 座標が必要な場合は `onLayout` の代わりに `measureLayout(scrollRef.current, callback)` を使う。`measureLayout` が失敗する場合のフォールバックとして `scrollToEnd` を用意しておく。

```ts
blockView.measureLayout(
  scrollRef.current,
  (_x, y, _w, h) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, y + h - 300), animated: true });
  },
  () => { scrollRef.current?.scrollToEnd({ animated: true }); }
);
```
