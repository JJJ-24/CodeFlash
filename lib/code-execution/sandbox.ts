/**
 * 言語別のサンドボックス HTML を構築する。
 *
 * @param code     実行するコード（トランスパイル済み）
 * @param language 言語名
 * @param sqlInits SQL 実行時にクエリ本体の前に流す初期化SQL（デッキ共通 → ブロック固有の順）。空要素は呼び出し側で除外済みを想定
 */
export function buildSandboxHtml(code: string, language?: string, sqlInits?: string[]): string {
  if (language === 'python') return buildPythonSandboxHtml(code);
  if (language === 'sql') return buildSqlSandboxHtml(code, sqlInits);
  return buildJsSandboxHtml(code);
}

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
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'timeout', logs: _logs }));
  }, 30000);

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
  console.log   = function() { _logs.push({ type: 'log',   text: fmt(arguments) }); };
  console.error = function() { _logs.push({ type: 'error', text: fmt(arguments) }); };
  console.warn  = function() { _logs.push({ type: 'warn',  text: fmt(arguments) }); };

  var _done = false;
  var _settled = false;   // 同期＋Promise（await・マイクロタスク）部分が完了したか
  var _pending = 0;       // 追跡中タイマーのうち保留中の数
  var _live = {};         // 追跡中タイマー id -> true

  // ラップ前のオリジナルを退避（内部の待機・破棄用。これらは追跡しない）
  var _origSetTimeout    = window.setTimeout.bind(window);
  var _origClearTimeout  = window.clearTimeout.bind(window);
  var _origSetInterval   = window.setInterval.bind(window);
  var _origClearInterval = window.clearInterval.bind(window);

  // 全体 5 秒の上限
  var _timer = _origSetTimeout(function() { finish('timeout'); }, 5000);

  function finish(type, msg) {
    if (_done) return;
    _done = true;
    _origClearTimeout(_timer);
    var payload = { type: type, logs: _logs };
    if (msg) payload.message = msg;
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

  // setTimeout: 1 回発火したら完了（保留から外す）
  window.setTimeout = function(fn, delay) {
    if (typeof fn !== 'function') return _origSetTimeout(fn, delay);
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
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'timeout', logs: _logs, tables: _tables }));
  }, 30000);

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
