/**
 * 言語別のサンドボックス HTML を構築する。
 *
 * @param code     実行するコード（トランスパイル済み）
 * @param language 言語名
 */
export function buildSandboxHtml(code: string, language?: string): string {
  if (language === 'python') return buildPythonSandboxHtml(code);
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
  window.alert = undefined;

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
  var _timer = setTimeout(function() {
    if (_done) return;
    _done = true;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'timeout', logs: _logs }));
  }, 5000);

  try {
    (new Function(${escaped}))();
    if (!_done) {
      _done = true;
      clearTimeout(_timer);
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'success', logs: _logs }));
    }
  } catch(e) {
    if (!_done) {
      _done = true;
      clearTimeout(_timer);
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: e.message, logs: _logs }));
    }
  }
})();
<\/script></body></html>`;
}
