/**
 * 言語別のサンドボックス HTML を構築する。
 *
 * @param code      実行するコード（トランスパイル済み）
 * @param language  言語名
 * @param sqlInits  SQL 実行時にクエリ本体の前に流す初期化SQL（デッキ共通 → ブロック固有の順）。空要素は呼び出し側で除外済みを想定
 * @param htmlInits Web 系（html / js・ts の土台）で body 先頭に加算する HTML/CSS 土台（デッキ共通 → ブロック固有の順）
 */
export function buildSandboxHtml(code: string, language?: string, sqlInits?: string[], htmlInits?: string[]): string {
  if (language === 'python') return buildPythonSandboxHtml(code);
  if (language === 'sql') return buildSqlSandboxHtml(code, sqlInits);
  if (language === 'html') return buildWebSandboxHtml('html', code, htmlInits);
  // css は土台が無くても常に web 実行（装飾対象が無ければ空白が出るだけ＝html と同じ扱い）。
  // js/ts と違い「コンソール実行」という落とし先が無いため、土台の有無で分岐しない。
  if (language === 'css') return buildWebSandboxHtml('css', code, htmlInits);
  // js/ts は HTML/CSS 土台がある時だけ Web プレビュー実行（土台なしは従来どおりコンソール実行）
  const hasStage = (htmlInits ?? []).some((s) => s && s.trim() !== '');
  if (hasStage && (language === 'javascript' || language === 'typescript')) {
    return buildWebSandboxHtml('js', code, htmlInits);
  }
  return buildJsSandboxHtml(code);
}

/**
 * インラインプレビューの高さ自動調整：中身の実高さを親（`ExecutionOutput`）へ通知する。
 *
 * インラインの可視 WebView は `pointerEvents="none"` の表示専用（タッチを取ると学習カードの
 * ScrollView/FlipCard・編集の NestableDraggableFlatList とジェスチャーが競合する＝041 を
 * 全画面モーダルにした理由）。**内側でスクロールできないまま「全部見える」を成立させる唯一の手段**が
 * 箱の高さを中身に合わせることなので、ここで高さだけを送る。
 *
 * - 連続追従（ResizeObserver）はしない：編集画面のドラッグリストで高さが動き続けると
 *   下のブロックの `onLayout` がずれる（CLAUDE.md の BlockEditor 注意点）。
 * - 送るのは DOMContentLoaded / load / load+300ms の3回だけ。
 * - **この断片は harness より先に置く**。`buildWebSandboxHtml` の harness は `window.setTimeout` を
 *   ラップして「保留タイマー」として数えるため、後に置くと 300ms の追い撃ちが完了判定を遅らせる。
 *   先に置いて生の `setTimeout` を捕まえておけば、完了判定にも 5 秒上限にも影響しない。
 */
const HEIGHT_REPORT_SCRIPT = `
(function() {
  var _rawSetTimeout = window.setTimeout.bind(window);
  function reportHeight() {
    try {
      var d = document;
      var h = Math.max(
        d.body ? d.body.scrollHeight : 0,
        d.documentElement ? d.documentElement.scrollHeight : 0
      );
      if (h > 0) window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'previewHeight', height: h }));
    } catch (e) {}
  }
  document.addEventListener('DOMContentLoaded', reportHeight);
  window.addEventListener('load', function() { reportHeight(); _rawSetTimeout(reportHeight, 300); });
})();
`;

/** 実行中に逐次送信するログの上限件数（超えた分は終了時の1通にまとめて届く）。 */
const LOG_STREAM_MAX = 200;
/** 逐次送信をまとめる間隔。1件ずつ送るとログの多いコードでブリッジが詰まる。 */
const LOG_STREAM_FLUSH_MS = 100;

/**
 * 実行中のログを逐次 RN 側へ送る共通スクリプト（`buildJsSandboxHtml` / `buildWebSandboxHtml` に注入）。
 *
 * 本来ログは終了時（finish）に1通でまとめて送るが、それだと `setInterval(fn, 1000)` のような
 * 「時間をかけて出力するコード」の途中経過が一切見えない（締切に達してから一気に5件出る）。
 * ここでは `console.*` のたびに **溜まっていなければ即送信し、連続するぶんだけ 100ms でまとめる**
 * （リーディングエッジ＋トレーリングのスロットリング）。
 *
 * 先頭を即送りするのは、**JS スレッドが止まる状況でも「止まる前に出したログ」を届けるため**。
 * `setTimeout(() => alert('x'), 0); console.log('a');` は console.log が先に走るのに、
 * トレーリングだけだと 100ms の送信予約が走る前に `alert` がスレッドを止めてしまい、
 * OK を押すまで何も出ない（＝同期実行に見える）。同期無限ループの直前のログも同じ理由で出ない。
 *
 * - **送信は `_origSetTimeout`（ラップ前）で予約する**。ラップ後だと保留タイマーに数えられ、
 *   完了判定が遅れるうえ締切まで延ばしてしまう
 * - 逐次送信は `LOG_STREAM_MAX` 件まで。暴走コードで実行中パネルが膨れ上がるのを防ぐだけで、
 *   **全量は従来どおり終了時の1通に入る**ので最終的な表示内容は変わらない
 * - 終了後（`_done`）は送らない（最終結果で置き換わるため）
 *
 * 前提: 呼び出し側に `_logs` / `_done` / `_origSetTimeout` があること。
 */
const LOG_STREAM_SCRIPT = `
  var _streamed = 0;
  var _streamQueue = [];
  var _streamTimer = null;
  var _lastFlushAt = 0;
  function flushLogs() {
    _streamTimer = null;
    if (_done || _streamQueue.length === 0) return;
    _lastFlushAt = Date.now();
    var batch = _streamQueue;
    _streamQueue = [];
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'logs', entries: batch })); } catch (e) {}
  }
  function streamLog(entry) {
    if (_done || _streamed >= ${LOG_STREAM_MAX}) return;
    _streamed++;
    _streamQueue.push(entry);
    if (_streamTimer !== null) return;           // 送信予約済み（次のフラッシュに載る）
    var since = Date.now() - _lastFlushAt;
    if (since >= ${LOG_STREAM_FLUSH_MS}) { flushLogs(); return; }  // 先頭は即送る
    _streamTimer = _origSetTimeout(flushLogs, ${LOG_STREAM_FLUSH_MS} - since);
  }
  function pushLog(type, args) {
    var entry = { type: type, text: fmt(args) };
    _logs.push(entry);
    streamLog(entry);
  }
`;

/** 実行の既定の締切（何も予約しないコードは実質これで判定される）。 */
const EXEC_TIMEOUT_BASE_MS = 5000;
/** 実行開始からの絶対上限。setTimeout をいくら重ねてもここで打ち切る（Python・C++ と同じ 30 秒）。 */
export const EXEC_TIMEOUT_MAX_MS = 30000;
/** タイマー発火後の後始末（コールバック内のログ・マイクロタスク）ぶんの余白。 */
const EXEC_TIMEOUT_MARGIN_MS = 300;

/**
 * 実行の締切を管理する共通スクリプト（`buildJsSandboxHtml` / `buildWebSandboxHtml` に注入）。
 *
 * 既定は 5 秒だが、ユーザーコードが `setTimeout(fn, 8000)` のように先の発火を予約したら、
 * その発火予定＋余白まで締切を押し出す（実行開始から 30 秒が絶対上限）。固定 5 秒だと
 * `setTimeout` の学習カードが必ず「タイムアウト」になってしまうため。
 *
 * - `setInterval` では延長しない（終わりが無いので、clear しなければ上限で打ち切りのまま）
 * - 再帰的な `setTimeout` で無限に延びないよう、上限は**実行開始時刻**を基準にする
 * - 何も予約しないコードの体感は不変（5 秒のまま）
 * - `finish` に `_limitMs`（実際に適用した上限）を持たせ、UI が「N秒を超えたため中断」と出せるようにする
 * - `skipDeadline(ms)` は「コードの実行ではない待ち時間」を締切から差し引く（`DIALOG_SCRIPT` 用）
 *
 * 前提: 呼び出し側に `_origSetTimeout` / `_origClearTimeout` と関数宣言の `finish` があること。
 */
const DEADLINE_SCRIPT = `
  var _startedAt = Date.now();
  var _limitMs = ${EXEC_TIMEOUT_BASE_MS};
  var _timer = _origSetTimeout(function() { finish('timeout'); }, _limitMs);
  function armDeadline() {
    _origClearTimeout(_timer);
    var remain = _startedAt + _limitMs - Date.now();
    _timer = _origSetTimeout(function() { finish('timeout'); }, remain > 0 ? remain : 0);
  }
  function extendDeadline(delay) {
    if (_done) return;
    var d = Number(delay);
    if (!isFinite(d) || d < 0) d = 0;
    var want = (Date.now() - _startedAt) + d + ${EXEC_TIMEOUT_MARGIN_MS};
    if (want > ${EXEC_TIMEOUT_MAX_MS}) want = ${EXEC_TIMEOUT_MAX_MS};
    if (want <= _limitMs) return;
    _limitMs = want;
    armDeadline();
  }
  // 実行ではない待ち時間（ダイアログの操作待ち）を締切から差し引く。開始時刻ごと後ろへずらすので
  // 30秒の絶対上限も同じだけ後ろへ動く＝「アラートを閉じるのが遅いとタイムアウト」を防ぐ。
  function skipDeadline(blockedMs) {
    if (_done || !(blockedMs > 0)) return;
    _startedAt += blockedMs;
    armDeadline();
  }
`;

/**
 * `alert` / `confirm` / `prompt` をラップする共通スクリプト（`buildJsSandboxHtml` / `buildWebSandboxHtml`）。
 *
 * これらはネイティブのダイアログとして動作し、**閉じるまで WebView の JS スレッドを止める**。
 * そのため素のままだと2つの問題が出る：
 * 1. 直前の `console.log` が送信されないまま止まる → OK を押すまで何も出ず、同期実行に見える
 * 2. 操作待ちの時間が実行時間として締切に算入される → 悩んでいるだけでタイムアウトになる
 *
 * 表示直前に溜まったログを吐き出し、閉じた後に止まっていた時間を締切から差し引くことで両方を防ぐ。
 * 戻り値（`confirm`/`prompt`）はそのまま返す。
 *
 * 前提: 呼び出し側に `flushLogs`（LOG_STREAM_SCRIPT）と `skipDeadline`（DEADLINE_SCRIPT）があること。
 */
const DIALOG_SCRIPT = `
  ['alert', 'confirm', 'prompt'].forEach(function(name) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function() {
      flushLogs();
      var t0 = Date.now();
      try {
        return orig.apply(window, arguments);
      } finally {
        skipDeadline(Date.now() - t0);
      }
    };
  });
`;

/** インライン要素を1行に畳むときの上限。これを超えたら普通に改行して積む。 */
const HTML_FORMAT_INLINE_MAX = 200;

/**
 * 040 の「ソース」タブ用に、実行後の body を**整形して**文字列化する（`buildWebSandboxHtml` に注入）。
 *
 * `document.body.outerHTML` は「書いたときの改行をそのまま返す」だけで自分では整形しないため、
 * ①`<script>` の中身が開始タグと同じ行から始まって閉じタグまで詰まる ②`appendChild` で JS が
 * 作った要素は改行を含むテキストノードが存在せず全部1行に連なる、という読みにくさが出る。
 * ここでは DOM を歩いてインデント付きで組み立て直す。**表示専用**（再実行しない）なので、
 * 整形で空白の扱いが変わっても実行結果には影響しない。
 *
 * ルール:
 * - 空白だけのテキストノードは捨てる（元 HTML のインデント由来の空白が二重に増えるのを防ぐ）
 * - 子がすべてインライン要素/テキストなら**1行に畳む**（`<p>foo <b>bar</b></p>`）。
 *   ただし長くなりすぎる場合（`HTML_FORMAT_INLINE_MAX`）は畳まない
 * - `<script>` / `<style>` は開始タグ・中身・終了タグを別行にし、**中身は原文のまま**
 *   （インデントを足すとテンプレートリテラルの中身が変わって見えるため）
 * - `<pre>` / `<textarea>` と `white-space: pre*` の要素は中身に一切触らない（空白が意味を持つ）
 * - 空要素（`<br>` `<img>` など）は1行、属性は `node.attributes` から組み直してエスケープ
 */
const HTML_FORMAT_SCRIPT = `
  var _VOID_TAGS = { area:1, base:1, br:1, col:1, embed:1, hr:1, img:1, input:1, link:1, meta:1, param:1, source:1, track:1, wbr:1 };
  var _RAW_TAGS  = { script:1, style:1 };
  var _PRE_TAGS  = { pre:1, textarea:1 };
  var _INLINE_TAGS = {
    a:1, abbr:1, b:1, bdi:1, bdo:1, br:1, button:1, cite:1, code:1, data:1, dfn:1, em:1, i:1,
    img:1, input:1, kbd:1, label:1, mark:1, q:1, s:1, samp:1, select:1, small:1, span:1,
    strong:1, sub:1, sup:1, time:1, u:1, 'var':1, wbr:1
  };
  function _esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  // 属性値の < > は HTML 的には生でも valid だが、ソースタブのハイライトがタグ開始と誤認するので escape する
  function _escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function _tagOf(el) { return el.tagName ? el.tagName.toLowerCase() : ''; }
  function _openTag(el) {
    var s = '<' + _tagOf(el);
    var attrs = el.attributes;
    for (var i = 0; i < (attrs ? attrs.length : 0); i++) {
      s += ' ' + attrs[i].name + '="' + _escAttr(attrs[i].value) + '"';
    }
    return s + '>';
  }
  function _isPreLike(el) {
    if (_PRE_TAGS[_tagOf(el)]) return true;
    try {
      var ws = window.getComputedStyle(el).whiteSpace || '';
      return ws.indexOf('pre') === 0 || ws === 'break-spaces';
    } catch (e) { return false; }
  }
  // 1行に畳めるか（子がテキストとインライン要素だけ。コメント・raw・pre は畳まない）
  function _allInline(el) {
    var cs = el.childNodes;
    for (var i = 0; i < cs.length; i++) {
      var n = cs[i];
      if (n.nodeType === 3) continue;
      if (n.nodeType !== 1) return false;
      var t = _tagOf(n);
      if (!_INLINE_TAGS[t] || _RAW_TAGS[t] || _PRE_TAGS[t]) return false;
      if (!_allInline(n)) return false;
    }
    return true;
  }
  // 畳んだ1行を作る。テキストの連続空白は1個に潰す（属性値には触れない）
  function _inlineStr(node) {
    if (node.nodeType === 3) return _esc(String(node.nodeValue).replace(/\\s+/g, ' '));
    if (node.nodeType === 8) return '<!--' + String(node.nodeValue) + '-->';
    if (node.nodeType !== 1) return '';
    var t = _tagOf(node);
    if (_VOID_TAGS[t]) return _openTag(node);
    var s = _openTag(node);
    var cs = node.childNodes;
    for (var i = 0; i < cs.length; i++) s += _inlineStr(cs[i]);
    return s + '</' + t + '>';
  }
  // script/style の中身を「最小共通インデントを外してから pad の位置へ揃え直す」。
  // 相対的な段差は保たれるので、土台にどう字下げして書いてあってもタグの1段下に収まる。
  function _reindent(raw, pad) {
    var lines = raw.split('\\n');
    var min = Infinity;
    for (var i = 0; i < lines.length; i++) {
      if (!/\\S/.test(lines[i])) continue;               // 空行は基準に含めない
      var m = lines[i].match(/^[ \\t]*/)[0].length;
      if (m < min) min = m;
    }
    if (min === Infinity) min = 0;
    for (var j = 0; j < lines.length; j++) {
      lines[j] = /\\S/.test(lines[j]) ? pad + lines[j].slice(min) : '';
    }
    return lines.join('\\n');
  }
  function _walkHtml(node, depth, out) {
    var pad = new Array(depth + 1).join('  ');
    if (node.nodeType === 3) {
      var text = String(node.nodeValue);
      if (!/\\S/.test(text)) return;                      // 空白だけの行は捨てる
      out.push(pad + _esc(text.replace(/\\s+/g, ' ').replace(/^ | $/g, '')));
      return;
    }
    if (node.nodeType === 8) { out.push(pad + '<!--' + String(node.nodeValue) + '-->'); return; }
    if (node.nodeType !== 1) return;
    var tag = _tagOf(node);
    if (_VOID_TAGS[tag]) { out.push(pad + _openTag(node)); return; }
    if (_RAW_TAGS[tag]) {
      var raw = String(node.textContent == null ? '' : node.textContent).replace(/^\\s*\\n/, '').replace(/\\s+$/, '');
      out.push(pad + _openTag(node));
      if (raw !== '') out.push(_reindent(raw, pad + '  '));
      out.push(pad + '</' + tag + '>');
      return;
    }
    if (_isPreLike(node)) {
      out.push(pad + _openTag(node) + (node.innerHTML == null ? '' : node.innerHTML) + '</' + tag + '>');
      return;
    }
    var cs = node.childNodes;
    if (cs.length === 0) { out.push(pad + _openTag(node) + '</' + tag + '>'); return; }
    if (_allInline(node)) {
      var one = '';
      for (var i = 0; i < cs.length; i++) one += _inlineStr(cs[i]);
      one = one.replace(/^ +| +$/g, '');
      var line = pad + _openTag(node) + one + '</' + tag + '>';
      if (line.length <= ${HTML_FORMAT_INLINE_MAX}) { out.push(line); return; }
    }
    out.push(pad + _openTag(node));
    for (var j = 0; j < cs.length; j++) _walkHtml(cs[j], depth + 1, out);
    out.push(pad + '</' + tag + '>');
  }
  function formatBodyHtml() {
    var out = [];
    _walkHtml(document.body, 0, out);
    return out.join('\\n');
  }
`;

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/';

/**
 * Pyodide (Python in WASM) を CDN から動的ロードして Python コードを実行する。
 * - sys.stdout / sys.stderr を StringIO でキャプチャして logs に変換
 * - Pyodide ロード待機を含む 30 秒のトータルタイムアウト
 * - ユーザーコード実行には別途 5 秒タイムアウトを設定
 */
function buildPythonSandboxHtml(code: string): string {
  const escaped = JSON.stringify(code);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="${PYODIDE_CDN}pyodide.js"><\/script>
</head>
<body><script>
(async function() {
  var _logs = [];
  var _done = false;

  // Pyodide ロード込みの全体タイムアウト（30秒）
  var _totalTimer = setTimeout(function() {
    if (_done) return;
    _done = true;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'timeout', logs: _logs, limitMs: ${EXEC_TIMEOUT_MAX_MS} }));
  }, ${EXEC_TIMEOUT_MAX_MS});

  function finish(type, msg) {
    if (_done) return;
    _done = true;
    clearTimeout(_totalTimer);
    var payload = { type: type, logs: _logs };
    if (msg) payload.message = msg;
    window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }

  try {
    if (typeof loadPyodide === 'undefined') {
      throw new Error('Pyodide の読み込みに失敗しました（インターネット接続を確認してください）');
    }

    var pyodide = await loadPyodide({ indexURL: '${PYODIDE_CDN}' });

    // stdout / stderr を StringIO でキャプチャ
    pyodide.runPython(
      'import sys, io as _io\\n' +
      '_out = _io.StringIO()\\n' +
      '_err = _io.StringIO()\\n' +
      'sys.stdout = _out\\n' +
      'sys.stderr = _err'
    );

    var _userCode = ${escaped};

    // # pip: package1 package2 コメントからインストール対象を抽出
    var _pipPackages = [];
    _userCode.split('\\n').forEach(function(line) {
      var m = line.match(/^#\\s*pip:\\s*(.+)/);
      if (m) m[1].trim().split(/\\s+/).forEach(function(p) { if (p) _pipPackages.push(p); });
    });
    if (_pipPackages.length > 0) {
      await pyodide.loadPackage('micropip');
      await pyodide.runPythonAsync(
        'import micropip\\n' +
        'await micropip.install(' + JSON.stringify(_pipPackages) + ')'
      );
    }

    // ユーザーコード実行タイムアウト（5秒）
    var _execDone = false;
    var _execTimer = setTimeout(function() {
      if (_done || _execDone) return;
      finish('timeout');
    }, 5000);

    await pyodide.runPythonAsync(_userCode);
    _execDone = true;
    clearTimeout(_execTimer);

    // 出力取得・ログ変換
    var stdout = pyodide.runPython('_out.getvalue()');
    var stderr = pyodide.runPython('_err.getvalue()');
    if (stdout) {
      stdout.split('\\n').forEach(function(line) {
        if (line !== '') _logs.push({ type: 'log', text: line });
      });
    }
    if (stderr) {
      stderr.split('\\n').forEach(function(line) {
        if (line !== '') _logs.push({ type: 'error', text: line });
      });
    }

    finish('success');
  } catch(e) {
    finish('error', (e && e.message) ? e.message : String(e));
  }
})();
<\/script></body></html>`;
}

/**
 * JavaScript（TypeScript はトランスパイル済み）を WebView 内で実行する。
 * - console.log/error/warn を _logs にキャプチャして結果パネルへ渡す
 * - 完了通知は「同期部分」だけでなく非同期の後始末（await / Promise チェーン /
 *   setTimeout・setInterval）が片付くまで遅らせる。これにより
 *   `setTimeout(() => console.log(...), 500)` のような後出しログも拾える。
 * - すべて全体 5 秒の上限内。setInterval を clear せず回し続けると上限で timeout になる。
 */
function buildJsSandboxHtml(code: string): string {
  const escaped = JSON.stringify(code);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body><script>
(function() {
  window.fetch = undefined;
  window.XMLHttpRequest = undefined;
  window.WebSocket = undefined;
  window.open = undefined;

  var _logs = [];
  function fmt(args) {
    return Array.prototype.map.call(args, function(v) {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      if (typeof v === 'object') { try { return JSON.stringify(v); } catch(e) { return String(v); } }
      return String(v);
    }).join(' ');
  }
  // 本体は pushLog（LOG_STREAM_SCRIPT）。_logs へ積むのと同時に実行中の逐次送信も行う。
  console.log   = function() { pushLog('log',   arguments); };
  console.error = function() { pushLog('error', arguments); };
  console.warn  = function() { pushLog('warn',  arguments); };

  var _done = false;
  var _settled = false;   // 同期＋Promise（await・マイクロタスク）部分が完了したか
  var _pending = 0;       // 追跡中タイマーのうち保留中の数
  var _live = {};         // 追跡中タイマー id -> true

  // ラップ前のオリジナルを退避（内部の待機・破棄用。これらは追跡しない）
  var _origSetTimeout    = window.setTimeout.bind(window);
  var _origClearTimeout  = window.clearTimeout.bind(window);
  var _origSetInterval   = window.setInterval.bind(window);
  var _origClearInterval = window.clearInterval.bind(window);

  // 実行中のログ逐次送信（100ms ごとにまとめて送る）
${LOG_STREAM_SCRIPT}
  // 全体の締切（既定5秒・setTimeout の予約に応じて最大30秒まで延長）
${DEADLINE_SCRIPT}
  // alert/confirm/prompt はスレッドを止めるので、直前のログを吐き出し操作待ちを締切から除く
${DIALOG_SCRIPT}
  function finish(type, msg) {
    if (_done) return;
    _done = true;
    _origClearTimeout(_timer);
    var payload = { type: type, logs: _logs };
    if (msg) payload.message = msg;
    if (type === 'timeout') payload.limitMs = _limitMs;
    window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }

  // 完了判定はマクロタスク境界まで遅らせる。タイマーのコールバックが Promise を
  // resolve すると、その await 継続は「マイクロタスク」として後から走る（console.log は
  // まだ出ていない）。ここで即 finish すると出力を取りこぼすため、setTimeout(0) を1回
  // 挟んで全マイクロタスクを流し切ってから _pending を再確認する。
  var _finishScheduled = false;
  function scheduleFinishCheck() {
    if (_done || _finishScheduled) return;
    _finishScheduled = true;
    _origSetTimeout(function() {
      _finishScheduled = false;
      if (_settled && _pending === 0) finish('success');
    }, 0);
  }

  function untrack(id) {
    if (_live[id]) { delete _live[id]; _pending--; scheduleFinishCheck(); }
  }

  // setTimeout: 1 回発火したら完了（保留から外す）。発火予定に合わせて締切も延ばす。
  window.setTimeout = function(fn, delay) {
    if (typeof fn !== 'function') return _origSetTimeout(fn, delay);
    extendDeadline(delay);
    var extra = Array.prototype.slice.call(arguments, 2);
    var id = _origSetTimeout(function() {
      try { fn.apply(null, extra); }
      catch (e) { finish('error', (e && e.message) ? e.message : String(e)); return; }
      untrack(id);
    }, delay);
    _pending++; _live[id] = true;
    return id;
  };

  // setInterval: 繰り返すので発火では外さない（clear されるか 5 秒上限まで保留のまま）
  window.setInterval = function(fn, delay) {
    if (typeof fn !== 'function') return _origSetInterval(fn, delay);
    var extra = Array.prototype.slice.call(arguments, 2);
    var id = _origSetInterval(function() {
      try { fn.apply(null, extra); }
      catch (e) { finish('error', (e && e.message) ? e.message : String(e)); }
    }, delay);
    _pending++; _live[id] = true;
    return id;
  };

  window.clearTimeout  = function(id) { untrack(id); return _origClearTimeout(id); };
  window.clearInterval = function(id) { untrack(id); return _origClearInterval(id); };

  (async function() {
    try {
      // new Function 相当の安全なコード注入。AsyncFunction にすることで、
      // 戻り値の Promise やトップレベル await も待てる。
      var _AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      await (new _AsyncFunction(${escaped}))();
    } catch (e) {
      finish('error', (e && e.message) ? e.message : String(e));
      return;
    }
    _settled = true;
    scheduleFinishCheck();
  })();
})();
<\/script></body></html>`;
}

/**
 * Web 系（html ブロック本文 / js・ts ＋ HTML/CSS 土台）を可視 WebView で描画・実行する。
 * - `mode='html'`：本文をそのまま body に描画（本文内の <script> はパース時に実行）
 * - `mode='js'`：本文（JS）を <script> に入れ、土台の DOM を操作させる
 * - `mode='css'`：本文（CSS）を <style> に入れ、土台の DOM を装飾させる
 * - `htmlInits`（デッキ土台 → ブロック土台）を body の先頭に加算合成する
 *
 * ネットワーク遮断・console キャプチャ・後出しログ対応（保留タイマー追跡＋マクロタスク境界での
 * 完了判定）は console 版 buildJsSandboxHtml と同じ設計。ただしユーザーの <script> はインライン
 * 実行のため try/catch で包めず、未捕捉例外は window.onerror で拾い、完了判定は DOMContentLoaded
 * 後に開始する。全体 5 秒上限。
 */
function buildWebSandboxHtml(mode: 'html' | 'js' | 'css', body: string, htmlInits?: string[]): string {
  const stages = (htmlInits ?? []).filter((s) => s && s.trim() !== '').join('\n');
  const markup = mode === 'html' ? body : '';
  // js モードの本文は <script> に入れる。本文中の </script> のみ無害化（文字列内の \/ は / と等価）。
  const script = mode === 'js' ? '<script>' + body.replace(/<\/script/gi, '<\\/script') + '</script>' : '';
  // css モードの本文は <style> に入れる（同様に </style> のみ無害化）。
  const style = mode === 'css' ? '<style>' + body.replace(/<\/style/gi, '<\\/style') + '</style>' : '';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>${HEIGHT_REPORT_SCRIPT}<\/script>
<script>
(function() {
  window.fetch = undefined;
  window.XMLHttpRequest = undefined;
  window.WebSocket = undefined;
  window.open = undefined;

  var _logs = [];
  function fmt(args) {
    return Array.prototype.map.call(args, function(v) {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      if (typeof v === 'object') { try { return JSON.stringify(v); } catch(e) { return String(v); } }
      return String(v);
    }).join(' ');
  }
  // 本体は pushLog（LOG_STREAM_SCRIPT）。_logs へ積むのと同時に実行中の逐次送信も行う。
  console.log   = function() { pushLog('log',   arguments); };
  console.error = function() { pushLog('error', arguments); };
  console.warn  = function() { pushLog('warn',  arguments); };

  var _done = false;
  var _settled = false;       // DOMContentLoaded 済み（同期スクリプト完了）か
  var _pending = 0;           // 追跡中タイマーのうち保留中の数
  var _live = {};             // 追跡中タイマー id -> true
  var _finishScheduled = false;

  var _origSetTimeout    = window.setTimeout.bind(window);
  var _origClearTimeout  = window.clearTimeout.bind(window);
  var _origSetInterval   = window.setInterval.bind(window);
  var _origClearInterval = window.clearInterval.bind(window);

  // 実行中のログ逐次送信（100ms ごとにまとめて送る）
${LOG_STREAM_SCRIPT}
  // 全体の締切（既定5秒・setTimeout の予約に応じて最大30秒まで延長）
${DEADLINE_SCRIPT}
  // alert/confirm/prompt はスレッドを止めるので、直前のログを吐き出し操作待ちを締切から除く
${DIALOG_SCRIPT}
  // 「ソース」タブ用の整形シリアライザ（formatBodyHtml）
${HTML_FORMAT_SCRIPT}
  function finish(type, msg) {
    if (_done) return;
    _done = true;
    _origClearTimeout(_timer);
    // 「ソース」タブ用に実行後の DOM を送る（＝プレビューと同じ瞬間の姿）。
    // - body 以下だけを formatBodyHtml() で整形して出す：head のサンドボックス harness は見せず、
    //   かつ document.body.style.background = ... のような body 属性への変更も拾える。
    //   outerHTML をそのまま使うと、<script> の中身がタグと同じ行に詰まり、JS が appendChild で
    //   作った要素は全部1行に連なる（改行を含むテキストノードが無いため）＝読めないので整形する。
    // - 043 の画像は data URI に置換済みで base64 が巨大なので中身を省略する（読む対象でもない）。
    // - **1行が極端に長い場合も省略する**：JS が生成した長文テキスト（textContent への追記ループ等）は
    //   改行を含まない数千文字の1行になりうる。ソースタブは折り返さない（wrap={false}）ので、
    //   そのまま渡すと iOS のテキストレイアウトが破綻して**領域が真っ白になる**。
    // - 全体長にも上限を設ける（ブリッジ転送とハイライト描画のコスト対策）。
    try {
      var _src = formatBodyHtml().replace(/(data:[^;"']*;base64,)[A-Za-z0-9+/=]+/g, '$1…');
      _src = _src.split('\\n').map(function(_line) {
        return _line.length > 500 ? _line.slice(0, 500) + '… (+' + (_line.length - 500) + ' chars)' : _line;
      }).join('\\n');
      if (_src.length > 100000) _src = _src.slice(0, 100000) + '\\n… (truncated)';
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'resultSource', html: _src }));
    } catch (e) {}
    var payload = { type: type, logs: _logs };
    if (msg) payload.message = msg;
    if (type === 'timeout') payload.limitMs = _limitMs;
    window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }
  // 完了判定はマクロタスク境界まで遅らせ、後出しログ（Promise/タイマー）を取りこぼさない。
  function scheduleFinishCheck() {
    if (_done || _finishScheduled) return;
    _finishScheduled = true;
    _origSetTimeout(function() {
      _finishScheduled = false;
      if (_settled && _pending === 0) finish('success');
    }, 0);
  }
  function untrack(id) {
    if (_live[id]) { delete _live[id]; _pending--; scheduleFinishCheck(); }
  }
  window.setTimeout = function(fn, delay) {
    if (typeof fn !== 'function') return _origSetTimeout(fn, delay);
    extendDeadline(delay);
    var extra = Array.prototype.slice.call(arguments, 2);
    var id = _origSetTimeout(function() {
      try { fn.apply(null, extra); }
      catch (e) { finish('error', (e && e.message) ? e.message : String(e)); return; }
      untrack(id);
    }, delay);
    _pending++; _live[id] = true;
    return id;
  };
  window.setInterval = function(fn, delay) {
    if (typeof fn !== 'function') return _origSetInterval(fn, delay);
    var extra = Array.prototype.slice.call(arguments, 2);
    var id = _origSetInterval(function() {
      try { fn.apply(null, extra); }
      catch (e) { finish('error', (e && e.message) ? e.message : String(e)); }
    }, delay);
    _pending++; _live[id] = true;
    return id;
  };
  window.clearTimeout  = function(id) { untrack(id); return _origClearTimeout(id); };
  window.clearInterval = function(id) { untrack(id); return _origClearInterval(id); };

  // ユーザーの <script> はインライン実行のため try/catch で包めない。未捕捉例外は onerror で拾う。
  window.onerror = function(message) { finish('error', message ? String(message) : 'Error'); return true; };

  // 同期スクリプトが走り終える DOMContentLoaded で完了判定を開始する。
  document.addEventListener('DOMContentLoaded', function() {
    _settled = true;
    scheduleFinishCheck();
  });
})();
<\/script>
</head>
<body>
${stages}
${markup}
${script}
${style}
</body>
</html>`;
}

/**
 * 全画面インタラクティブプレビュー用（041）：Web 系（html / js・ts＋土台）を
 * 「生きたまま」実行する。040 の `buildWebSandboxHtml`（一発完了＋5秒タイムアウト＋
 * 保留タイマー追跡）とは harness が異なる別物で、こちらは：
 * - 完了判定・タイムアウトを持たない（ユーザーが閉じるまで動き続ける＝onclick/scroll/input 等を体験できる）
 * - console.log/warn/error を **1 行ごとに逐次 postMessage** する（イベントで出たログをライブ表示するため）
 * - 未捕捉例外（window.onerror）・未処理 rejection も逐次 error として送る
 * - ネットワーク遮断は 040 と同じ
 *
 * 合成（土台＋本文/script）は `buildWebSandboxHtml` と同一。
 *   - `mode='html'`：本文をそのまま body に描画（本文内の <script> はパース時に実行）
 *   - `mode='js'`：本文（JS）を <script> に入れ、土台の DOM を操作させる
 */
export function buildInteractiveWebSandboxHtml(mode: 'html' | 'js' | 'css', body: string, htmlInits?: string[]): string {
  const stages = (htmlInits ?? []).filter((s) => s && s.trim() !== '').join('\n');
  const markup = mode === 'html' ? body : '';
  // js モードの本文は <script> に入れる。本文中の </script> のみ無害化（文字列内の \/ は / と等価）。
  const script = mode === 'js' ? '<script>' + body.replace(/<\/script/gi, '<\\/script') + '</script>' : '';
  // css モードの本文は <style> に入れる（同様に </style> のみ無害化）。
  const style = mode === 'css' ? '<style>' + body.replace(/<\/style/gi, '<\\/style') + '</style>' : '';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>
(function() {
  window.fetch = undefined;
  window.XMLHttpRequest = undefined;
  window.WebSocket = undefined;
  window.open = undefined;

  // console は 1 行ごとに逐次ポストする（貯めない）。イベントで出た後出しログをライブ表示するため。
  function post(entryType, args) {
    var text = Array.prototype.map.call(args, function(v) {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      if (typeof v === 'object') { try { return JSON.stringify(v); } catch(e) { return String(v); } }
      return String(v);
    }).join(' ');
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'log', entry: { type: entryType, text: text } })); } catch(e) {}
  }
  console.log   = function() { post('log',   arguments); };
  console.info  = function() { post('log',   arguments); };
  console.error = function() { post('error', arguments); };
  console.warn  = function() { post('warn',  arguments); };

  // ユーザーの <script> はインライン実行のため try/catch で包めない。未捕捉例外・未処理 rejection は
  // 逐次 error として送る（finish して打ち切らない＝生きたまま操作を続けられる）。
  window.onerror = function(message) { post('error', [message ? String(message) : 'Error']); return true; };
  window.addEventListener('unhandledrejection', function(e) {
    var r = e && e.reason;
    post('error', [r && r.message ? String(r.message) : String(r)]);
  });

  // 全画面モーダルのヘッダーに出す <title>（ブラウザがタブ名を出す位置＝比喩として正確な置き場所）。
  // ユーザーの <title> は body に落ちるが、document.title は「文書内で最初の title 要素」を指す仕様なので拾える。
  // load 時にも送るので、js/ts が document.title = ... で書き換えた結果も反映される。
  function postTitle() {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'title', title: document.title || '' }));
    } catch (e) {}
  }
  document.addEventListener('DOMContentLoaded', postTitle);
  window.addEventListener('load', postTitle);

  // 全画面プレビューで、要素をタップ後に Space（や矢印/PageUp 等）を押すとページの既定スクロールが
  // 走り、短い土台では画面が上下に揺れる。これらスクロール系キーの「既定動作だけ」を止める。
  // preventDefault は既定スクロールを消すだけでユーザーの addEventListener は普通に発火する。
  // 除外はテキスト入力・contenteditable のみ（Space/矢印が文字入力・カーソル移動に必要なため）。
  // チェックボックス/ボタン等にフォーカスがあっても Space のスクロールを確実に止める（キーボードでの
  // トグル/クリックは効かなくなるがタップで代替でき、「動かない」を優先）。
  var SCROLL_KEYS = { ' ': 1, 'Spacebar': 1, 'PageUp': 1, 'PageDown': 1, 'Home': 1, 'End': 1, 'ArrowUp': 1, 'ArrowDown': 1, 'ArrowLeft': 1, 'ArrowRight': 1 };
  var TEXT_INPUT_TYPES = { text: 1, search: 1, url: 1, tel: 1, password: 1, email: 1, number: 1, '': 1 };
  window.addEventListener('keydown', function(e) {
    var t = e.target || document.activeElement;
    var tag = (t && t.tagName) ? String(t.tagName).toUpperCase() : '';
    var type = (t && t.type) ? String(t.type).toLowerCase() : '';
    var isTextField = tag === 'TEXTAREA' || (tag === 'INPUT' && TEXT_INPUT_TYPES[type]) || (t && t.isContentEditable);
    var key = e.key;
    if ((key === undefined || key === null) && e.keyCode === 32) key = ' ';
    if (!isTextField && SCROLL_KEYS[key]) { e.preventDefault(); }
  }, false);
})();
<\/script>
</head>
<body>
${stages}
${markup}
${script}
${style}
</body>
</html>`;
}

/**
 * 実行前プレビュー用：HTML/CSS 土台だけを描画する表示専用ドキュメント（本文 JS は含めない）。
 * console キャプチャや完了メッセージは持たない。安全のためネットワークのみ遮断する。
 * 土台に含まれる `<script>`（ステージ初期化）はそのまま実行される。
 * **postMessage の唯一の例外が高さ通知**（`HEIGHT_REPORT_SCRIPT`）＝実行前プレビューも
 * 中身の高さに合わせるために必要。ログや実行結果は依然として一切送らない。
 */
export function buildStaticPreviewHtml(htmlInits?: string[]): string {
  const stages = (htmlInits ?? []).filter((s) => s && s.trim() !== '').join('\n');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>${HEIGHT_REPORT_SCRIPT}<\/script>
<script>
  window.fetch = undefined;
  window.XMLHttpRequest = undefined;
  window.WebSocket = undefined;
  window.open = undefined;
<\/script>
</head>
<body>
${stages}
</body>
</html>`;
}

const SQL_JS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0/';

/**
 * sql.js (SQLite WASM) を CDN から動的ロードして SQL を実行する。
 * - SELECT 結果はテーブルデータ（tables）として返す
 * - INSERT/UPDATE/DELETE は変更行数をログに出力
 * - 30 秒タイムアウト
 * - sqlInits（デッキ共通 → ブロック固有）をクエリ本体の前に黙って実行する（加算型）。
 *   初期化SQLでの例外は「初期化SQLでエラー:」接頭辞付きで返す。
 */
function buildSqlSandboxHtml(code: string, sqlInits?: string[]): string {
  const escaped = JSON.stringify(code);
  const escapedInits = JSON.stringify((sqlInits ?? []).filter((s) => s && s.trim() !== ''));
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="${SQL_JS_CDN}sql-wasm.js"><\/script>
</head>
<body><script>
(async function() {
  var _logs = [];
  var _tables = [];
  var _done = false;

  var _timer = setTimeout(function() {
    if (_done) return;
    _done = true;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'timeout', logs: _logs, tables: _tables, limitMs: ${EXEC_TIMEOUT_MAX_MS} }));
  }, ${EXEC_TIMEOUT_MAX_MS});

  function finish(type, msg) {
    if (_done) return;
    _done = true;
    clearTimeout(_timer);
    var payload = { type: type, logs: _logs, tables: _tables };
    if (msg) payload.message = msg;
    window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }

  try {
    if (typeof initSqlJs === 'undefined') {
      throw new Error('sql.js の読み込みに失敗しました（インターネット接続を確認してください）');
    }

    var SQL = await initSqlJs({
      locateFile: function(filename) { return '${SQL_JS_CDN}' + filename; }
    });

    var db = new SQL.Database();
    var userCode = ${escaped};
    var initSqls = ${escapedInits};

    // 初期化SQL（デッキ共通 → ブロック固有）を本体の前に黙って実行する（加算型）。
    // 結果は表示せず、例外時のみ区別できるよう接頭辞を付けて投げ直す。
    try {
      for (var n = 0; n < initSqls.length; n++) {
        db.run(initSqls[n]);
      }
    } catch (initErr) {
      throw new Error('初期化SQLでエラー: ' + ((initErr && initErr.message) ? initErr.message : String(initErr)));
    }

    if (userCode.trim() !== '') {
      var results = db.exec(userCode);

      if (results.length > 0) {
        for (var i = 0; i < results.length; i++) {
          _tables.push({ columns: results[i].columns, rows: results[i].values });
        }
      } else {
        var changes = db.getRowsModified();
        _logs.push({ type: 'log', text: changes > 0 ? changes + ' row(s) affected' : 'OK' });
      }
    }

    db.close();
    finish('success');
  } catch(e) {
    finish('error', (e && e.message) ? e.message : String(e));
  }
})();
<\/script></body></html>`;
}
