/**
 * 049：読み上げのテキスト処理（分割・Markdown 除去）を Node 上で検証する。
 *
 * RN コンポーネントは描画できないが、`lib/speech.ts` と `lib/blocksToSpeech.ts` は
 * **実際に動くロジックがテキスト変換だけ**なので、`expo-speech` をスタブすれば本物のまま呼べる。
 * 実行: `npm run verify:speech`
 *
 * ⚠️ アプリのモジュールは `import` ではなく `require()` で読む（`import` は巻き上げられ、
 * スタブを入れる前に expo-speech が解決されて落ちる）。db-harness と同じ流儀。
 */
import nodePath from 'node:path';
import Module from 'node:module';

const root = nodePath.join(__dirname, '..');

// ---- expo-speech のスタブ（speak/stop を記録するだけ） -----------------------

interface SpokenUtterance { text: string; language: string }
const spoken: SpokenUtterance[] = [];

const stubs: Record<string, unknown> = {
  'expo-speech': {
    speak: (text: string, opts: { language: string }) => { spoken.push({ text, language: opts.language }); },
    stop: () => {},
    getAvailableVoicesAsync: async () => [],
  },
  // 非ラテン言語の既定値を端末言語から作るのに使う（本物はネイティブなので Node では解決できない）。
  'expo-localization': { getLocales: () => [{ languageCode: 'ja', regionCode: 'JP' }] },
};

const M = Module as unknown as {
  _resolveFilename: (request: string, ...rest: unknown[]) => string;
  _cache: Record<string, unknown>;
};
const origResolve = M._resolveFilename;
M._resolveFilename = function (request: string, ...rest: unknown[]) {
  const resolved = request.startsWith('@/') ? nodePath.join(root, request.slice(2)) : request;
  if (resolved in stubs) {
    if (!M._cache[resolved]) {
      M._cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: stubs[resolved] };
    }
    return resolved;
  }
  return origResolve.call(this, resolved, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { splitByScript, speakText, nonLatinLangForLocale, SPEECH_NON_LATIN_LANG_DEFAULT } = require('@/lib/speech');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { blocksToSpeech, stripMarkdown } = require('@/lib/blocksToSpeech');

// ---- 検証ハーネス ------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failures.push(`${label}\n    期待: ${e}\n    実際: ${a}`);
}

/** 分割結果を `nonLatin:テキスト` の配列に畳んで比べる。 */
const shape = (text: string) =>
  splitByScript(text).map((s: { script: string; text: string }) => `${s.script}:${s.text}`);

// ---- splitByScript -----------------------------------------------------------

eq(shape('非同期処理はあとで終わります。'), ['nonLatin:非同期処理はあとで終わります。'],
  '純日本語は1区間（nonLatin）');

eq(shape('Asynchronous code finishes later.'), ['latin:Asynchronous code finishes later.'],
  '純英語は1区間（latin）');

eq(shape('React の useEffect は副作用を扱う'),
  ['latin:React ', 'nonLatin:の ', 'latin:useEffect ', 'nonLatin:は副作用を扱う'],
  '混在は文字体系ごとに割れる');

// 実測で決めた閾値（3文字以下は日本語側）。API が英語の声に残ると「アピ」と読まれる。
eq(shape('API を叩く'), ['nonLatin:API を叩く'], '3文字の略語 API は日本語側へ倒れる');
eq(shape('OK です'), ['nonLatin:OK です'], '2文字の OK も日本語側');
eq(shape('HTML を書く'), ['latin:HTML ', 'nonLatin:を書く'], '4文字の HTML は英語側に残る');

// ⚠️ ここが `hasNonLatin` ガードの肝。非ラテン文字が1文字も無いなら短くても倒さない。
eq(shape('GET'), ['latin:GET'], '純ラテンの短い語は英語のまま（単語カードが日本語読みにならない）');
eq(shape('OK'), ['latin:OK'], '2文字でも非ラテン文字が無ければ英語のまま');
// ⚠️ ガードは**区間ではなく元テキストの文字**で判定する。先頭の数字・記号は中立のまま
// 非ラテン区間を作るので、区間で数えると英語カードなのにガードが素通りしていた（修正済み）。
eq(shape('1. GET'), ['nonLatin:1. ', 'latin:GET'],
  '先頭の数字だけで非ラテン扱いにならない（英語カードの GET が「ゲット」にならない）');

// 中立文字（数字・記号・空白）は直前の区間へ吸わせる＝単独で声を切り替えない。
eq(shape('React18 の新機能'), ['latin:React18 ', 'nonLatin:の新機能'], '数字は直前のラテン区間に吸われる');
eq(shape('123'), ['nonLatin:123'], '数字だけなら日本語で読む');
// ⚠️ **閾値は「文字数」であって「区間の長さ」ではない**。`ES2015` は英字が2文字なので
// 日本語側へ倒れる（＝日本語の声が「イーエス2015」と読む）。日本語文中の略語は数字が
// 付いていても日本語読みが自然なので、この挙動を正とする。
eq(shape('ES2015 の仕様'), ['nonLatin:ES2015 の仕様'], '英字が短ければ数字付きでも日本語側へ倒れる');

// スペイン語（ラテン拡張）も同じ切り方で割れる＝多言語は言語コードの差し替えだけ。
eq(shape('スペイン語で ありがとう は gracias'),
  ['nonLatin:スペイン語で ありがとう は ', 'latin:gracias'],
  '日西混在も同じ規則で割れる');
eq(shape('café と言います'), ['latin:café ', 'nonLatin:と言います'], 'アクセント付きラテン文字もラテン側');

// ⚠️ ベトナム語は声調つきの文字が拡張B（ơ ư）と拡張追加（ạ ế ộ ứ）に散っている。
// これらを LATIN_CHARS から外すと「中立」に落ち、**文頭に来ただけで ja 区間が生まれて**
// 日本語の声で読まれる（かつ hasJa が立って短い語が丸ごと日本語側へ倒れる）。
eq(shape('Ứng dụng học tiếng Việt'), ['latin:Ứng dụng học tiếng Việt'],
  'ベトナム語だけのカードは1区間（latin）＝声調つきの文字も落ちない');
eq(shape('ứng'), ['latin:ứng'], '短いベトナム語の単語カードも日本語側へ倒れない');
eq(shape('ベトナム語で ありがとう は cảm ơn'),
  ['nonLatin:ベトナム語で ありがとう は ', 'latin:cảm ơn'],
  '日越混在も文字体系で割れる');
eq(shape('Și țara aceasta'), ['latin:Și țara aceasta'],
  'ルーマニア語のコンマ下（ș ț・拡張B）もラテン側');
eq(shape('nǐ hǎo'), ['latin:nǐ hǎo'], '拼音の声調記号（拡張B）もラテン側');

// ⚠️ かな漢字**以外**の文字体系も能動的に判定する。かつては中立扱いだったため、
// ラテン文字の**後ろ**に来たハングルやキリル文字が直前のラテン区間に吸われ、
// 英語の声で読まれていた（文頭に来たときだけ非ラテン扱いになる位置依存の挙動）。
eq(shape('hello 안녕'), ['latin:hello ', 'nonLatin:안녕'], 'ハングルは後ろに来てもラテン区間に吸われない');
eq(shape('안녕하세요'), ['nonLatin:안녕하세요'], '韓国語だけのカードは1区間（nonLatin）');
eq(shape('Привет мир'), ['nonLatin:Привет мир'], 'キリル文字も非ラテン側');
eq(shape('สวัสดี'), ['nonLatin:สวัสดี'], 'タイ文字も非ラテン側');
eq(shape('你好，世界'), ['nonLatin:你好，世界'], '中国語（漢字）も非ラテン側');
eq(shape('Γεια σου'), ['nonLatin:Γεια σου'], 'ギリシャ文字も非ラテン側');
// `splitByScript` は文字体系しか見ない＝短ラテン寄せは非ラテン文字があれば言語に関係なく効く。
// 「日本語のときだけ倒す」判断は `speakText` の役目（下の speakText 節で検証する）。
eq(shape('학습 API 사용'), ['nonLatin:학습 API 사용'],
  '短ラテン寄せは文字体系だけで決まる（言語による出し分けは speakText の役目）');

// ---- speakText（キューへの積み方） -------------------------------------------

spoken.length = 0;
speakText('React の話', { latinLang: 'en-US', nonLatinLang: 'ja-JP', rate: 1.0 });
eq(spoken, [
  { text: 'React ', language: 'en-US' },
  { text: 'の話', language: 'ja-JP' },
], '区間ごとに言語を変えて順にキューへ積む');

spoken.length = 0;
speakText('スペイン語で gracias', { latinLang: 'es-ES', nonLatinLang: 'ja-JP', rate: 1.0 });
eq(spoken, [
  { text: 'スペイン語で ', language: 'ja-JP' },
  { text: 'gracias', language: 'es-ES' },
], 'ラテン側の言語は設定で差し替わる（分割コードは不変）');

// 非ラテン側も設定で差し替わる＝中国語・韓国語・ロシア語のカードが読めるようになった。
spoken.length = 0;
speakText('你好，世界', { latinLang: 'en-US', nonLatinLang: 'zh-CN', rate: 1.0 });
eq(spoken, [{ text: '你好，世界', language: 'zh-CN' }], '中国語のカードは中国語の声で読む');

spoken.length = 0;
speakText('안녕 hello', { latinLang: 'en-US', nonLatinLang: 'ko-KR', rate: 1.0 });
eq(spoken, [
  { text: '안녕 ', language: 'ko-KR' },
  { text: 'hello', language: 'en-US' },
], '韓国語＋英語も文字体系で割れて別々の声になる');

// ⚠️ 短ラテン寄せは**非ラテン側が日本語のときだけ**。閾値3は日本語音声の実測値なので、
// 他言語の声がラテン片を同じように読める保証がない＝ラテン側（既定は英語）に残す。
spoken.length = 0;
speakText('API を叩く', { latinLang: 'en-US', nonLatinLang: 'ja-JP', rate: 1.0 });
eq(spoken, [{ text: 'API を叩く', language: 'ja-JP' }], '日本語なら API は日本語側へ倒す（従来どおり）');

spoken.length = 0;
speakText('API 사용법', { latinLang: 'en-US', nonLatinLang: 'ko-KR', rate: 1.0 });
eq(spoken, [
  { text: 'API ', language: 'en-US' },
  { text: '사용법', language: 'ko-KR' },
], '日本語以外なら短い略語を倒さず英語の声に残す');

spoken.length = 0;
speakText('   ', { latinLang: 'en-US', nonLatinLang: 'ja-JP', rate: 1.0 });
eq(spoken, [], '空白だけなら1件も積まない');

// ---- 非ラテン言語の既定値（端末言語から決める） -------------------------------

// ⚠️ 対応表は持たず languageCode＋regionCode を繋ぐだけ（iOS の音声もこの形）。
eq(nonLatinLangForLocale({ languageCode: 'ko', regionCode: 'KR' }), 'ko-KR', '韓国語端末は ko-KR');
eq(nonLatinLangForLocale({ languageCode: 'zh', regionCode: 'TW' }), 'zh-TW', '台湾の端末は zh-TW（簡体に丸めない）');
eq(nonLatinLangForLocale({ languageCode: 'ru', regionCode: 'ru' }), 'ru-RU', '地域コードは大文字へ正規化する');
eq(nonLatinLangForLocale({ languageCode: 'th' }), 'th', '地域が取れなければ言語コードだけ（iOS が近い声へ倒す）');
// ラテン文字の言語の端末は ja-JP ＝**従来の固定値と同じ**なので既存利用者の挙動が変わらない。
eq(nonLatinLangForLocale({ languageCode: 'en', regionCode: 'US' }), 'ja-JP', '英語端末は従来どおり ja-JP');
eq(nonLatinLangForLocale(undefined), 'ja-JP', '端末情報が取れなくても ja-JP へ倒す');
eq(SPEECH_NON_LATIN_LANG_DEFAULT, 'ja-JP', '既定値は端末言語（このハーネスでは ja-JP）から作られる');

// ---- stripMarkdown -----------------------------------------------------------

eq(stripMarkdown('**強調**と*斜体*と~~打ち消し~~'), '強調と斜体と打ち消し', '強調記法を落とす');
eq(stripMarkdown('==重要==と==g|緑の強調=='), '重要と緑の強調', 'ハイライト（色プレフィックス付き）を落とす');
eq(stripMarkdown('++下線++'), '下線', '下線記法を落とす');
eq(stripMarkdown('`useEffect` を使う'), 'useEffect を使う', 'インラインコードは中身を残す');
eq(stripMarkdown('# 見出し\n## 小見出し'), '見出し\n小見出し', '見出しの # を落とす');
eq(stripMarkdown('- 項目1\n- 項目2\n1. 番号'), '項目1\n項目2\n番号', 'リストの行頭記号を落とす');
eq(stripMarkdown('> 引用文'), '引用文', '引用の > を落とす');
eq(stripMarkdown('[公式ドキュメント](https://example.com)'), '公式ドキュメント', 'リンクは表示テキストだけ残す');
eq(stripMarkdown('詳細は https://example.com/a/b を見る'), '詳細は  を見る', '生 URL は読み上げない');
eq(stripMarkdown('---\n本文'), '本文', '水平線を落とす');
eq(stripMarkdown('| 列A | 列B |\n| --- | --- |\n| 値1 | 値2 |'), '列A、列B\n値1、値2', '表はセルを読点でつなぐ');

// フェンスの中はコード＝読み上げない。フェンス長が可変でも対応する。
eq(stripMarkdown('説明文\n```js\nconst a = 1;\n```\n続き'), '説明文\n続き', 'コードフェンスの中身を捨てる');
eq(stripMarkdown('````\n```\n````\n後'), '後', '長いフェンスの中の ``` を閉じと誤認しない');

// ⚠️ アンダースコアは識別子を壊すので触らない（意図的な非対応）。
eq(stripMarkdown('snake_case_name は識別子'), 'snake_case_name は識別子', 'アンダースコアは強調として剥がさない');
eq(stripMarkdown('3 * 4 は 12\nもう1行'), '3 * 4 は 12\nもう1行', '掛け算の * が次行を巻き込まない');

// ---- blocksToSpeech ----------------------------------------------------------

eq(blocksToSpeech([
  { type: 'text', content: '**質問**：これは何？' },
  { type: 'code', language: 'javascript', content: 'const a = 1;', executable: true },
  { type: 'text', content: '答えは `Array`' },
]), '質問：これは何？\n答えは Array', 'コードブロックは読まずテキストだけつなぐ');

eq(blocksToSpeech([
  { type: 'code', language: 'javascript', content: 'console.log(1);', executable: true },
]), '', 'コードだけのカードは空文字（＝ボタンを出さない判定に使う）');

eq(blocksToSpeech([
  { type: 'image', uri: 'local://images/a.png', alt: '構成図' },
]), '構成図', '画像は alt を読む');

eq(blocksToSpeech([
  { type: 'image', uri: 'local://images/a.png', alt: '' },
]), '', 'alt が無い画像は何も足さない');

// ---- 結果 --------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} 件失敗 / ${passed + failures.length} 件中\n`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`✓ 全 ${passed} アサーション成功`);
