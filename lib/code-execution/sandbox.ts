/**
 * 言語別のサンドボックス HTML を構築する。
 * 将来的に Python (Pyodide) や SQL (sql.js) を追加する際は
 * このファイルに言語別ビルダーを追加して buildSandboxHtml でディスパッチする。
 *
 * @param code     実行するコード（トランスパイル済み）
 * @param _language 言語名（将来の拡張用、現在は未使用）
 */
export function buildSandboxHtml(code: string, _language?: string): string {
  return buildJsSandboxHtml(code);
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
