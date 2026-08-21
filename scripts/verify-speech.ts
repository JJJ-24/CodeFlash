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

interface SpokenUtterance { text: string; language: string; voice?: string }
const spoken: SpokenUtterance[] = [];

const stubs: Record<string, unknown> = {
  'expo-speech': {
    speak: (text: string, opts: { language: string; voice?: string }) => {
      spoken.push({ text, language: opts.language, voice: opts.voice });
    },
    stop: () => {},
    getAvailableVoicesAsync: async () => [],
  },
  // 漢字の既定言語を端末言語から作るのに使う（本物はネイティブなので Node では解決できない）。
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
const speech = require('@/lib/speech');
const { splitByScript, resolveSpeechSegments, speakText } = speech;
const { scriptForLanguage, hanLangForLocale, SCRIPT_DEFAULT_LANGS, speechLanguageLabel } = speech;
const { filterKnownVoices, voiceSampleText, isNoveltyVoice } = speech;
const { mergeScriptLangs, parseScriptLangs, scriptLangsEqual } = speech;
const { splitSentencesForPause } = speech;
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

/** 分割結果を `文字体系:テキスト` の配列にして比べる（中立は `neutral:`）。 */
const shape = (text: string) =>
  splitByScript(text).map((s: { script: string | null; text: string }) => `${s.script ?? 'neutral'}:${s.text}`);

/** **実際に読まれる形**（解決＋畳み込み後）を `言語:テキスト` の配列にして比べる。 */
const voices = (text: string, langs: Record<string, string> = {}) =>
  resolveSpeechSegments(text, langs).map((s: { language: string; text: string }) => `${s.language}:${s.text}`);

// ---- splitByScript（文字体系で細かく割る） -----------------------------------

// ⚠️ この段階では**言語に解決しない**。日本語は漢字とかなで別区間になる（あとで畳む）。
eq(shape('非同期処理はあとで終わります。'),
  ['han:非同期処理', 'kana:はあとで', 'han:終', 'kana:わります。'],
  '日本語は漢字とかなで別区間になる（句点は中立でかな側に吸われる）');

eq(shape('Asynchronous code finishes later.'), ['latin:Asynchronous code finishes later.'],
  '純英語は1区間');

eq(shape('React の useEffect は副作用を扱う'),
  ['latin:React ', 'kana:の ', 'latin:useEffect ', 'kana:は', 'han:副作用', 'kana:を', 'han:扱', 'kana:う'],
  '混在は文字体系ごとに細かく割れる');

// ⚠️ **先頭の中立文字は次の区間へ吸わせる**。かつては「先頭の中立は非ラテン区間として始める」
// だったため、`1. GET` が「非ラテン文字を含む」と誤判定され GET が「ゲット」と読まれていた。
eq(shape('1. GET'), ['latin:1. GET'], '先頭の数字は次の区間（ラテン）へ吸われる');
eq(shape('123'), ['neutral:123'], '中立しか無いテキストは1区間（script なし）');
eq(shape('React18 の新機能'), ['latin:React18 ', 'kana:の', 'han:新機能'], '途中の数字は直前の区間に吸われる');

// 文字体系の判定（1対1のものは設定なしでこの区間になる）。
eq(shape('hello 안녕'), ['latin:hello ', 'hangul:안녕'], 'ハングルは後ろに来てもラテン区間に吸われない');
eq(shape('Привет мир'), ['cyrillic:Привет мир'], 'キリル文字');
eq(shape('สวัสดี'), ['thai:สวัสดี'], 'タイ文字');
eq(shape('Γεια σου'), ['greek:Γεια σου'], 'ギリシャ文字');
eq(shape('שלום'), ['hebrew:שלום'], 'ヘブライ文字');
eq(shape('नमस्ते'), ['devanagari:नमस्ते'], 'デーヴァナーガリー');
eq(shape('你好，世界'), ['han:你好，世界'], '中国語は漢字1区間（読点は中立）');
// ⚠️ 全角の約物・全角英数は**中立**にしてある（`，` を kana に入れると中国語の文が
// 「かなを含む」と誤判定され日本語の声で読まれた）。半角カナは kana。
eq(shape('ＡＰＩ と ｶﾀｶﾅ'), ['kana:ＡＰＩ と ｶﾀｶﾅ'], '全角英数は中立で隣のかなに吸われる');
eq(shape('你好，世界です'), ['han:你好，世界', 'kana:です'], '全角読点は中立＝中国語の漢字区間を割らない');

// ラテン文字の範囲（ベトナム語・ルーマニア語・拼音）。⚠️ 他の文字体系の範囲と交わらせない。
eq(shape('Ứng dụng học tiếng Việt'), ['latin:Ứng dụng học tiếng Việt'],
  'ベトナム語だけのカードは1区間（声調つきの文字も落ちない）');
eq(shape('Și țara aceasta'), ['latin:Și țara aceasta'], 'ルーマニア語のコンマ下（拡張B）もラテン側');
eq(shape('nǐ hǎo'), ['latin:nǐ hǎo'], '拼音の声調記号（拡張B）もラテン側');

// ---- resolveSpeechSegments（実際に読まれる形＝解決して畳む） -----------------

// ⚠️ 畳むのは**解決後の言語**が同じ区間。文字体系で畳むと日本語が細切れのままになる。
eq(voices('非同期処理はあとで終わります。'), ['ja-JP:非同期処理はあとで終わります。'],
  '漢字＋かなは同じ言語なので1発話に畳まれる');
eq(voices('React の useEffect は副作用を扱う'),
  ['en-US:React', 'ja-JP:の', 'en-US:useEffect', 'ja-JP:は副作用を扱う'],
  '日英混在は声が切り替わり、日本語側は畳まれる');

// 短ラテン寄せ（2文字以下）。⚠️ 倒すのは**隣が日本語のときだけ**（閾値は日本語音声の実測値）。
// ⚠️ 3 にすると `CSS` が日本語・`HTML` が英語となり**同じ文で読み分けが起きる**（実機で指摘）。
eq(voices('OK です'), ['ja-JP:OK です'], '2文字の OK は日本語側へ倒れる');
eq(voices('ID を入力'), ['ja-JP:ID を入力'], '2文字の ID も日本語側');
eq(voices('API を叩く'), ['en-US:API', 'ja-JP:を叩く'], '3文字の略語は英語側に残る（声が綴り読みする）');
eq(voices('CSS と HTML'), ['en-US:CSS', 'ja-JP:と', 'en-US:HTML'], 'CSS と HTML が同じ扱いになる');
eq(voices('HTML を書く'), ['en-US:HTML', 'ja-JP:を書く'], '4文字の HTML は英語側に残る');
eq(voices('ES2015 の仕様'), ['ja-JP:ES2015 の仕様'], '英字が短ければ数字付きでも日本語側へ倒れる');
eq(voices('GET'), ['en-US:GET'], '隣に非ラテンが無ければ倒さない（単語カードが日本語読みにならない）');
eq(voices('1. GET'), ['en-US:1. GET'], '先頭の数字があっても倒さない');
eq(voices('학습 API 사용'), ['ko-KR:학습', 'en-US:API', 'ko-KR:사용'],
  '隣が日本語でなければ短い略語を倒さず英語の声に残す');

// **1対1の文字体系は設定なしで読み分く**（050 の主目的）。
eq(voices('안녕하세요'), ['ko-KR:안녕하세요'], '韓国語は設定なしで韓国語の声');
eq(voices('Привет мир'), ['ru-RU:Привет мир'], 'ロシア語は設定なしでロシア語の声');
eq(voices('สวัสดี'), ['th-TH:สวัสดี'], 'タイ語は設定なしでタイ語の声');
eq(voices('안녕 と こんにちは'), ['ko-KR:안녕', 'ja-JP:と こんにちは'],
  '日韓混在カードが自動で読み分かる（これが 050 の目的）');

// 上書き（設定）。
eq(voices('Hola amigo', { latin: 'es-ES' }), ['es-ES:Hola amigo'], 'ラテン文字の言語は設定で差し替わる');
eq(voices('Ứng dụng', { latin: 'vi-VN' }), ['vi-VN:Ứng dụng'], 'ベトナム語もラテン文字の設定で読める');
eq(voices('Привет', { cyrillic: 'uk-UA' }), ['uk-UA:Привет'], 'キリル文字の言語も設定できる');

// 「日本語と混ざるときは同じ声で読む」（`noMixedSwitch`）。
// ⚠️ `HTML` が英語・`CSS` が日本語と**同じ文で読み分かれる**のが分かりにくい、という声への対処。
const mixed = (text: string, langs: Record<string, string> = {}) =>
  resolveSpeechSegments(text, langs, { noMixedSwitch: true })
    .map((s: { language: string; text: string }) => `${s.language}:${s.text}`);

eq(mixed('React の useEffect は副作用を扱う'), ['ja-JP:React の useEffect は副作用を扱う'],
  '混在文では声が切り替わらず1発話に畳まれる');
eq(mixed('HTML と CSS'), ['ja-JP:HTML と CSS'],
  '同じ文の HTML と CSS が同じ声になる（読み分けの不一致が消える）');
// ⚠️ **英語だけのカードには効かせない**＝常に倒すと「英語の技術用語の発音を聞く」という
// 本命の使い道が失われる（旧「なし」方式はここで英語まで日本語の声にしてしまっていた）。
eq(mixed('idempotent'), ['en-US:idempotent'], '英語だけのカードは英語のまま（混在ではないため）');
eq(mixed('GET'), ['en-US:GET'], '英語だけの単語カードも英語のまま');
// ⚠️ 倒す先は漢字側の解決＝かなの推定も効くので、漢字を中国語にしていても周りと同じ声になる。
eq(mixed('React の話', { han: 'zh-CN' }), ['ja-JP:React の話'],
  'かながあれば日本語の声（漢字＝中国語の設定でも）');
eq(mixed('CSS 你好', { han: 'zh-CN' }), ['zh-CN:CSS 你好'],
  'かなが無ければ漢字の設定に従う（中国語の声で読む）');
// ⚠️ 倒す先は**最初の非ラテン区間の言語**。`han` に固定すると、ハングルやキリル文字と
// 混ざる文でラテン文字だけ日本語の声になる（実際にそうなっていた）。
eq(mixed('Привет CSS'), ['ru-RU:Привет CSS'], 'ロシア語と混ざる文はロシア語の声で揃う');
eq(mixed('안녕 CSS'), ['ko-KR:안녕 CSS'], '韓国語と混ざる文は韓国語の声で揃う');
eq(mixed('CSS สวัสดี'), ['th-TH:CSS สวัสดี'], 'ラテン文字が先頭でも後ろの言語に揃う');

// 漢字の日中判別。
eq(voices('你好，世界'), ['ja-JP:你好，世界'], '漢字だけの文は既定（端末言語）で読む');
eq(voices('你好，世界', { han: 'zh-CN' }), ['zh-CN:你好，世界'], '漢字の言語を中国語にすれば中国語の声');
eq(voices('非同期処理', { han: 'zh-CN' }), ['zh-CN:非同期処理'],
  '⚠️ 純漢字の日本語は中国語で読まれる（推定の限界。デッキ単位の上書き＝Phase 2 が本来の解）');
eq(voices('こんにちは、と言います', { han: 'zh-CN' }), ['ja-JP:こんにちは、と言います'],
  'かながあれば漢字は日本語（表=中国語/裏=日本語のカードが読み分かる）');
eq(voices('한자 漢字'), ['ko-KR:한자 漢字'], 'ハングルがあれば漢字は韓国語');
eq(voices('123'), ['ja-JP:123'], '中立しか無いテキストは漢字の言語で読む');

// ---- 区間の前後の空白（読みが文中の位置で変わらないようにする） -----------------

// ⚠️ iOS の音声は**末尾の空白の有無で綴り読み/単語読みの判断を反転させる**（実機で確認）：
//   "API" → エーピーアイ ／ "API " → アピ ／ "GUI" → グイ ／ "GUI " → ジーユーアイ
// 中立文字は直前の区間へ吸わせるので、**後ろに日本語が続くときだけ**末尾に空白が付いていた
// ＝同じ語がカードの位置によって違う読みになっていた。畳んだ後に trim して揃える。
eq(voices('これは API です'), ['ja-JP:これは', 'en-US:API', 'ja-JP:です'],
  'ラテン区間の末尾に空白を残さない（文中でも単体と同じ読みになる）');
// ⚠️ trim は**畳んだ後**に行う。畳む前だと、同じ言語の区間を連結するときに語間の空白まで消える。
eq(voices('New York を訪ねる'), ['en-US:New York', 'ja-JP:を訪ねる'],
  '区間の内部の空白は残る（New York が繋がらない）');
eq(voices('これは これも 日本語'), ['ja-JP:これは これも 日本語'],
  '同じ言語で畳んだ区間の語間の空白も残る');

// ---- speakText（キューへの積み方） -------------------------------------------

spoken.length = 0;
speakText('React の話', { rate: 1.0 });
eq(spoken, [
  { text: 'React', language: 'en-US' },
  { text: 'の話', language: 'ja-JP' },
], '区間ごとに言語を変えて順にキューへ積む');

spoken.length = 0;
speakText('안녕 hello', { rate: 1.0, scriptLangs: { latin: 'en-GB' } });
eq(spoken, [
  { text: '안녕', language: 'ko-KR' },
  { text: 'hello', language: 'en-GB' },
], '設定は scriptLangs で渡す');

spoken.length = 0;
speakText('   ', { rate: 1.0 });
eq(spoken, [], '空白だけなら1件も積まない');

// ---- 文末の間（ピリオドの後が小文字のとき） ---------------------------------

// iOS の音声エンジンは「ピリオド＋空白＋**大文字**」だけを文末と見なす（実機と iOS 純正の
// 読み上げの両方で確認済み）。**エンジンが間を入れない位置だけ**をアプリが別発話に分ける。
eq(splitSentencesForPause('This is a pen. That is a book.'), ['This is a pen. That is a book.'],
  '大文字が続く位置では切らない（エンジンが既に間を入れている）');
eq(splitSentencesForPause('this is a pen. that is a book.'), ['this is a pen.', 'that is a book.'],
  '小文字が続く位置で切る');
eq(splitSentencesForPause('useEffect は副作用を扱う. props は読み取り専用です.'),
  ['useEffect は副作用を扱う.', 'props は読み取り専用です.'],
  '識別子から始まる文（大文字にできない）で切る＝この機能の主目的');
eq(splitSentencesForPause('go. went. gone.'), ['go.', 'went.', 'gone.'], '短い列挙も1つずつ');
eq(splitSentencesForPause('line one.\nline two.'), ['line one.', 'line two.'], '改行も空白として扱う');

// 切ってはいけないもの
eq(splitSentencesForPause('e.g. this is an example. it works.'),
  ['e.g. this is an example.', 'it works.'], '略語（e.g.）では切らない');
eq(splitSentencesForPause('The meeting is at 9 a.m. and ends at 5 p.m. bring your laptop.'),
  ['The meeting is at 9 a.m. and ends at 5 p.m. bring your laptop.'], '略語（a.m./p.m.）では切らない');
eq(splitSentencesForPause('Mr. smith is here.'), ['Mr. smith is here.'], '敬称でも切らない');
eq(splitSentencesForPause('J. r. r. tolkien'), ['J. r. r. tolkien'], '1文字のイニシャルでも切らない');
eq(splitSentencesForPause('Version 1.5 is out.'), ['Version 1.5 is out.'], '小数点は空白が無いので対象外');
// ⚠️ 実機で見つけた理由がある：`API. Next word`（文中）は「エーピーアイ」と綴り読みするのに、
// 文を切って `API.` が**発話の末尾**に来ると「アピ」と単語のように読まれる。間より読みを優先する。
eq(splitSentencesForPause('See the API. it works.'), ['See the API. it works.'],
  '全大文字の略語では切らない（発話の末尾に来ると綴り読みでなくなる）');
eq(splitSentencesForPause('Upload to S3. then check it.'), ['Upload to S3. then check it.'],
  '数字を含む全大文字の略語も同じ');
eq(splitSentencesForPause('I met John. he said hi.'), ['I met John.', 'he said hi.'],
  '先頭だけ大文字の普通の語では切る（略語ではない）');
eq(splitSentencesForPause('It is an api. next word'), ['It is an api.', 'next word'],
  '小文字の語は略語扱いしない');
eq(splitSentencesForPause('array.map().filter() は連鎖する.'), ['array.map().filter() は連鎖する.'],
  'メソッドチェーンも対象外');
eq(splitSentencesForPause('hello.world'), ['hello.world'], '空白の無いピリオドは切らない');
eq(splitSentencesForPause('これはテストです。次の文です。'), ['これはテストです。次の文です。'],
  '日本語の句点は対象外（エンジンが間を入れる）');
eq(splitSentencesForPause('Really? yes! ok.'), ['Really? yes! ok.'], '`!` `?` は対象外（二重の間を作らない）');
eq(splitSentencesForPause('   '), [], '空白だけなら1件も返さない');

// キューへの積まれ方（区間 → 文の順で割る）
spoken.length = 0;
speakText('this is a pen. that is a book.', { rate: 1.0 });
eq(spoken, [
  { text: 'this is a pen.', language: 'en-US' },
  { text: 'that is a book.', language: 'en-US' },
], '同じ言語でも文ごとに別の発話として積む（発話の切れ目が「間」になる）');

// ---- デッキ単位の上書き（050 Phase 2） ---------------------------------------

// **設定した文字体系だけ**重ねる（丸ごと置き換えない）＝中国語デッキでラテン文字を巻き込まない。
eq(mergeScriptLangs({ latin: 'en-GB', han: 'ja-JP' }, { han: 'zh-CN' }), { latin: 'en-GB', han: 'zh-CN' },
  'デッキの上書きは設定した文字体系だけ重なる');
eq(mergeScriptLangs({ latin: 'en-GB' }, { han: '' }), { latin: 'en-GB' }, '空文字は未設定として無視する');
const appOnly = { latin: 'en-GB' };
eq(mergeScriptLangs(appOnly, {}) === appOnly, true, '上書きが無ければアプリ設定の参照をそのまま返す');
eq(mergeScriptLangs(appOnly, undefined) === appOnly, true, 'undefined でも同じ参照');

eq(parseScriptLangs('{"han":"zh-CN","zzz":"xx","latin":""}'), { han: 'zh-CN' }, '知らないキーと空の値を捨てる');
eq(parseScriptLangs('{壊れた'), {}, '壊れた JSON は未設定');
eq(parseScriptLangs(null), {}, 'NULL は未設定');

eq(scriptLangsEqual({ latin: 'en-US', han: 'ja-JP' }, { han: 'ja-JP', latin: 'en-US' }), true,
  'キーの並び順が違っても同じ扱い（編集画面の「変更あり」判定）');
eq(scriptLangsEqual({ han: 'ja-JP' }, { han: 'zh-CN' }), false, '値が違えば別物');
eq(scriptLangsEqual({ han: 'ja-JP' }, {}), false, '件数が違えば別物');

// 上書きを重ねた結果で実際に読み分かれる（漢字だけ中国語・ラテンは巻き込まれない）。
spoken.length = 0;
speakText('漢字 React', { rate: 1.0, scriptLangs: mergeScriptLangs({}, { han: 'zh-CN' }) });
eq(spoken, [
  { text: '漢字', language: 'zh-CN' },
  { text: 'React', language: 'en-US' },
], 'デッキで漢字を中国語にしてもラテン文字は英語のまま');

// ⚠️ **かなが混ざる文はデッキ設定より「かな＝日本語」が勝つ**（漢字の推定は設定より前に決まる）。
// 中国語デッキに日本語の説明文が混ざったカードが中国語で読まれるのを防ぐための順序で、
// デッキ設定が効くのは**かな・ハングルを含まない漢字の文**（＝判別できない場合）だけ。
spoken.length = 0;
speakText('漢字と React', { rate: 1.0, scriptLangs: mergeScriptLangs({}, { han: 'zh-CN' }) });
eq(spoken, [
  { text: '漢字と', language: 'ja-JP' },
  { text: 'React', language: 'en-US' },
], 'かなを含む文はデッキ設定より「かな＝日本語」が優先される');

// ---- 声の選択（050 Phase 3） -------------------------------------------------

// ⚠️ 声は**言語ごと**に持つ（文字体系ごとではない）＝区間が言語で畳まれるため。
spoken.length = 0;
speakText('React の話', { rate: 1.0, voices: { 'en-US': 'voice.en.Alex', 'ja-JP': 'voice.ja.Kyoko' } });
eq(spoken, [
  { text: 'React', language: 'en-US', voice: 'voice.en.Alex' },
  { text: 'の話', language: 'ja-JP', voice: 'voice.ja.Kyoko' },
], '区間の言語に対応する声を渡す');

spoken.length = 0;
speakText('React の話', { rate: 1.0, voices: { 'en-US': 'voice.en.Alex' } });
eq(spoken, [
  { text: 'React', language: 'en-US', voice: 'voice.en.Alex' },
  { text: 'の話', language: 'ja-JP', voice: undefined },
], '選んでいない言語は声を渡さない（端末の既定に任せる）');

// ⚠️ identifier は端末固有。実在しないものを渡すと expo-speech が例外を投げるので、
// 呼び出し側（useSpeech）が `filterKnownVoices` で落としてから渡す。
eq(filterKnownVoices({ 'en-US': 'a', 'ja-JP': 'b' }, new Set(['a'])), { 'en-US': 'a' },
  '端末に無い identifier は落とす');
eq(filterKnownVoices({ 'en-US': 'a' }, new Set()), {},
  '一覧が取れていないときは何も渡さない（言語だけで読む安全側）');

// 試聴のサンプル文。⚠️ 表に無い言語は**声の名前**を読む（誤った文を各国語で持たない）。
eq(voiceSampleText('en-AU', 'Karen'), 'The quick brown fox jumps over the lazy dog.',
  '地域が違ってもラテン言語の接頭辞で引く');
eq(voiceSampleText('ja-JP', 'Kyoko'), 'こんにちは。今日はいい天気ですね。', '日本語のサンプル文');
eq(voiceSampleText('bo-CN', 'Tenzin'), 'Tenzin', '表に無い言語は声の名前を読む');

// 奇抜な声（Bad News・Zarvox 等）はピッカーから外す。⚠️ **identifier のトークンで判定**する
// （表示名は端末の言語で訳されることがある）。⚠️ 同じ接頭辞の `Alex` を巻き込まないこと。
eq(isNoveltyVoice('com.apple.speech.synthesis.voice.BadNews'), true, '奇抜な声は外す');
eq(isNoveltyVoice('com.apple.speech.synthesis.voice.Zarvox'), true, '大小文字を問わず判定する');
eq(isNoveltyVoice('com.apple.speech.synthesis.voice.Alex'), false,
  '同じ接頭辞でも Alex はまともな声なので残す（接頭辞ごと弾かない根拠）');
eq(isNoveltyVoice('com.apple.voice.compact.en-AU.Karen'), false, '通常の声は残す');

// ---- 旧設定（049）からの移行 -------------------------------------------------

eq(scriptForLanguage('ja-JP'), 'han', '日本語は漢字の設定へ寄せる');
eq(scriptForLanguage('zh-CN'), 'han', '中国語も漢字の設定へ');
eq(scriptForLanguage('ko-KR'), 'han', '韓国語も漢字の設定へ（ハングルは既定で韓国語のため）');
eq(scriptForLanguage('ru-RU'), 'cyrillic', 'ロシア語はキリル文字の設定へ');
eq(scriptForLanguage('th-TH'), 'thai', 'タイ語はタイ文字の設定へ（既定と同値だが害はない）');
eq(scriptForLanguage('en-US'), undefined, 'ラテン文字の言語は非ラテンの移行先を持たない');

// ---- 漢字の既定言語（端末言語から決める） -------------------------------------

// ⚠️ 対応表は持たず languageCode＋regionCode を繋ぐだけ（iOS の音声もこの形）。
eq(hanLangForLocale({ languageCode: 'zh', regionCode: 'TW' }), 'zh-TW', '台湾の端末は zh-TW（簡体に丸めない）');
eq(hanLangForLocale({ languageCode: 'zh', regionCode: 'cn' }), 'zh-CN', '地域コードは大文字へ正規化する');
eq(hanLangForLocale({ languageCode: 'ko', regionCode: 'KR' }), 'ko-KR', '韓国語端末は ko-KR');
eq(hanLangForLocale({ languageCode: 'zh' }), 'zh', '地域が取れなければ言語コードだけ（iOS が近い声へ倒す）');
// 漢字を使わない言語の端末は ja-JP＝**049 の固定値と同じ**なので既存利用者の挙動が変わらない
// （その端末の文字体系〈キリル等〉は別の既定で読まれるので、漢字の既定は影響しない）。
eq(hanLangForLocale({ languageCode: 'en', regionCode: 'US' }), 'ja-JP', '英語端末は従来どおり ja-JP');
eq(hanLangForLocale({ languageCode: 'ru', regionCode: 'RU' }), 'ja-JP', 'ロシア語端末も漢字の既定は ja-JP');
eq(hanLangForLocale(undefined), 'ja-JP', '端末情報が取れなくても ja-JP へ倒す');
eq(SCRIPT_DEFAULT_LANGS.han, 'ja-JP', '既定表の漢字は端末言語（このハーネスでは ja-JP）から作られる');
eq(SCRIPT_DEFAULT_LANGS.hangul, 'ko-KR', '1対1の文字体系はその言語で確定（設定を出さない根拠）');

// ---- 言語コードの表示名（locales の表を引く） ---------------------------------

// ⚠️ `Intl.DisplayNames` は iOS の Hermes に無いので表示名はアプリ側に持つ。
// ここでは i18next の代わりに locales の JSON を直接引く簡易 `t` で検証する。
const jaLocale = require('@/locales/ja.json');
const enLocale = require('@/locales/en.json');
const makeT = (dict: Record<string, unknown>) => (key: string, opts?: Record<string, unknown>) => {
  const val = key.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), dict);
  if (typeof val !== 'string') return (opts?.defaultValue as string) ?? key;
  return val.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(opts?.[k] ?? ''));
};
const tJa = makeT(jaLocale);
const tEn = makeT(enLocale);

eq(speechLanguageLabel('en-AU', tJa), '英語（オーストラリア）', '地域つきは「言語（地域）」で出す');
eq(speechLanguageLabel('en-AU', tEn), 'English (Australia)', '英語 UI では半角括弧');
eq(speechLanguageLabel('ja-JP', tJa), '日本語（日本）', '日本語も同じ形');
eq(speechLanguageLabel('th', tJa), 'タイ語', '地域が無ければ言語名だけ');
eq(speechLanguageLabel('ar-001', tJa), 'アラビア語（世界）', 'UN M49 の 001 は「世界」');
eq(speechLanguageLabel('zh-Hans-CN', tJa), '中国語（中国）', '文字体系サブタグを挟んでも地域を拾う');
// ⚠️ 表に無いコードは**コードのまま**返す＝端末が新しい言語の音声を持っていても一覧は壊れない。
eq(speechLanguageLabel('xx-YY', tJa), 'xx-YY', '未知の言語はコードのまま');
eq(speechLanguageLabel('en-XX', tJa), '英語', '未知の地域は言語名だけにする');

// 第3引数（同じ一覧に並ぶコード）を渡すと、**区別が要るときだけ**地域を出す。
const latinPeers = ['en-US', 'en-GB', 'en-AU', 'cs-CZ', 'sv-SE'];
eq(speechLanguageLabel('en-AU', tJa, latinPeers), '英語（オーストラリア）', '同じ言語が並ぶときは地域を出す');
eq(speechLanguageLabel('en-US', tEn, latinPeers), 'English (US)', '英語 UI の地域名は短縮形');
eq(speechLanguageLabel('en-GB', tEn, latinPeers), 'English (UK)', 'イギリスも短縮形');
eq(speechLanguageLabel('cs-CZ', tJa, latinPeers), 'チェコ語', '1つしか無い言語は地域を出さない');
eq(speechLanguageLabel('sv-SE', tEn, latinPeers), 'Swedish', '英語 UI でも同じ規則');
eq(speechLanguageLabel('ar-001', tJa, ['ar-001']), 'アラビア語', '「世界」も相手がいなければ出さない');
eq(speechLanguageLabel('zh-Hans-CN', tJa, ['zh-Hans-CN', 'zh-Hant-TW', 'ja-JP']), '中国語（中国）',
  '文字体系サブタグを挟んでも同じ言語として数える');
eq(speechLanguageLabel('ja-JP', tJa, ['zh-Hans-CN', 'zh-Hant-TW', 'ja-JP']), '日本語', '漢字の一覧でも1つなら地域なし');
// ⚠️ **自分自身を数に入れる**＝端末から消えた音声を設定が指していても、並びに同じ言語があれば地域を出す。
eq(speechLanguageLabel('en-IE', tJa, ['en-US', 'en-GB']), '英語（アイルランド）', '一覧に無い現在値も同じ言語として数える');
eq(speechLanguageLabel('fr-FR', tJa, []), 'フランス語', '一覧が空なら区別する相手がいない');
eq(speechLanguageLabel('fr-FR', tJa), 'フランス語（フランス）', '一覧を渡さない呼び出しは従来どおり地域つき');

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
