/**
 * 059：Python の `requests` の代役。`requests.get(URL)` に**デッキの HTML/CSS 土台**で答える。
 *
 * Pyodide にはソケットが無く本物の requests は通信できない。`pyodide.http.pyfetch` は CORS を許可した
 * サイトしか読めない。そこで「名前が URL の土台＝架空のサイトのページ」として、実際の通信をせずに返す
 * （オフラインでも動き、相手のサイトにも迷惑が掛からない）。詳細は docs/059。
 *
 * ⚠️ **本物と違う動きをする**ので、使ったときは結果パネルに注記を出す（`_cf_on_use` → `ExecResult.pagesUsed`）。
 * ⚠️ ソースは**素の Python**（Pyodide 固有のものを使わない）＝`scripts/verify-pyrequests.ts` がローカルの
 *    python3 でそのまま動かして確かめる。ホスト側から渡すのは `_cf_setup(設定 JSON)` と `_cf_on_use` だけ。
 */

/** 実行に渡すページ。`url` は土台の名前（`http(s)://` で始まるもの）・`content` は土台の中身 */
export type PyPage = { url: string; content: string };

/** 利用者に見せる文言（i18n 済みの文字列をホストが渡す。`{url}`・`{pages}` を差し込む） */
export type PyRequestsMessages = {
  /** 登録されていないホストへの要求（ConnectionError） */
  connection: string;
};

export type PyRequestsConfig = { pages: PyPage[]; messages: PyRequestsMessages };

/** `exec(compile(SRC, '<requests>', 'exec'), module.__dict__)` で `requests` モジュールの中身になる */
export const PY_REQUESTS_SHIM_SOURCE = String.raw`
import json as _json
import types as _types
from urllib.parse import urlsplit as _urlsplit, urlunsplit as _urlunsplit, urlencode as _urlencode

__version__ = "2.32.3"

# ---- 例外（本物の requests と同じ名前・同じ継承） ------------------------------------
class RequestException(IOError):
    def __init__(self, *args, response=None, request=None):
        super().__init__(*args)
        self.response = response
        self.request = request

class ConnectionError(RequestException): pass
class HTTPError(RequestException): pass
class Timeout(RequestException): pass
class ConnectTimeout(ConnectionError, Timeout): pass
class ReadTimeout(Timeout): pass
class TooManyRedirects(RequestException): pass
class InvalidURL(RequestException, ValueError): pass
class MissingSchema(RequestException, ValueError): pass
class InvalidSchema(RequestException, ValueError): pass
class JSONDecodeError(RequestException, ValueError): pass

exceptions = _types.ModuleType("requests.exceptions")
for _name in ("RequestException", "ConnectionError", "HTTPError", "Timeout", "ConnectTimeout",
              "ReadTimeout", "TooManyRedirects", "InvalidURL", "MissingSchema", "InvalidSchema",
              "JSONDecodeError"):
    setattr(exceptions, _name, globals()[_name])

class _Codes:
    ok = 200
    not_found = 404
    method_not_allowed = 405

codes = _Codes()

# ---- ヘッダー（キーの大文字小文字を区別しない） -----------------------------------
class CaseInsensitiveDict(dict):
    def _key(self, key):
        for k in dict.keys(self):
            if k.lower() == str(key).lower():
                return k
        return key
    def __getitem__(self, key):
        return dict.__getitem__(self, self._key(key))
    def __contains__(self, key):
        return any(k.lower() == str(key).lower() for k in dict.keys(self))
    def get(self, key, default=None):
        return self[key] if key in self else default

# ---- Response -----------------------------------------------------------------
_REASONS = {200: "OK", 404: "Not Found", 405: "Method Not Allowed"}

class Response:
    def __init__(self, url, status_code, text, content_type, extra_headers=None):
        self.url = url
        self.status_code = status_code
        self.reason = _REASONS.get(status_code, "")
        self.text = text
        self.content = text.encode("utf-8")
        self.encoding = "utf-8"
        self.apparent_encoding = "utf-8"
        headers = {"Content-Type": content_type, "Content-Length": str(len(self.content))}
        headers.update(extra_headers or {})
        self.headers = CaseInsensitiveDict(headers)
        self.history = []
        self.cookies = {}

    @property
    def ok(self):
        return self.status_code < 400

    def __bool__(self):
        return self.ok

    def __repr__(self):
        return "<Response [%d]>" % self.status_code

    def json(self, **kwargs):
        try:
            return _json.loads(self.text, **kwargs)
        except ValueError as e:
            raise JSONDecodeError(str(e), response=self)

    def raise_for_status(self):
        if 400 <= self.status_code < 500:
            kind = "Client Error"
        elif 500 <= self.status_code < 600:
            kind = "Server Error"
        else:
            return
        raise HTTPError("%d %s: %s for url: %s" % (self.status_code, kind, self.reason, self.url), response=self)

    def iter_lines(self, chunk_size=512, decode_unicode=False, delimiter=None):
        for line in self.text.splitlines():
            yield line if decode_unicode else line.encode("utf-8")

    def iter_content(self, chunk_size=1, decode_unicode=False):
        data = self.text if decode_unicode else self.content
        size = chunk_size or len(data) or 1
        for i in range(0, len(data), size):
            yield data[i:i + size]

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

# ---- ページの照合 ---------------------------------------------------------------
_pages = {}       # 正規化した URL → 中身
_page_urls = []   # 登録順の URL（エラーメッセージ用・土台の名前のまま）
_hosts = set()    # (scheme, netloc)
_messages = {"connection": "Cannot connect to {url}. Available pages: {pages}"}
_cf_on_use = None  # ホストが差し込む「requests を使った」通知

def _normalize(url):
    """# 以降を捨て・スキームとホストを小文字に・末尾の / の有無を同一視（ルート以外）。クエリは完全一致"""
    parts = _urlsplit(url.strip())
    path = parts.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/") or "/"
    return _urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, parts.query, ""))

def _cf_setup(config_json):
    config = _json.loads(config_json)
    for page in config.get("pages", []):
        key = _normalize(page["url"])
        if key in _pages:
            continue  # 同じ URL が2つあれば先の土台（一覧の上）が勝つ
        _pages[key] = page["content"]
        _page_urls.append(page["url"].strip())
        parts = _urlsplit(key)
        _hosts.add((parts.scheme, parts.netloc))
    _messages.update(config.get("messages", {}))

def _content_type(text):
    stripped = text.strip()
    if stripped[:1] in ("{", "["):
        try:
            _json.loads(stripped)
            return "application/json"
        except ValueError:
            pass
    return "text/html; charset=utf-8"

def _with_params(url, params):
    if not params:
        return url
    if isinstance(params, (str, bytes)):
        query = params.decode() if isinstance(params, bytes) else params
    else:
        items = params.items() if isinstance(params, dict) else params
        pairs = []
        for k, v in items:
            if v is None:
                continue
            for one in (v if isinstance(v, (list, tuple)) else [v]):
                pairs.append((k, one))
        query = _urlencode(pairs)
    if not query:
        return url
    base, _, fragment = url.partition("#")
    joined = base + ("&" if "?" in base else "?") + query
    return joined + ("#" + fragment if fragment else "")

def request(method, url, params=None, **kwargs):
    if _cf_on_use is not None:
        _cf_on_use()
    url = _with_params(str(url).strip(), params)
    parts = _urlsplit(url)
    if not parts.scheme:
        raise MissingSchema("Invalid URL %r: No scheme supplied. Perhaps you meant https://%s?" % (url, url))
    if parts.scheme.lower() not in ("http", "https"):
        raise InvalidSchema("No connection adapters were found for %r" % url)
    if not parts.netloc:
        raise InvalidURL("Invalid URL %r: No host supplied" % url)
    shown = url.partition("#")[0]
    key = _normalize(url)
    key_parts = _urlsplit(key)
    if (key_parts.scheme, key_parts.netloc) not in _hosts:
        listing = ", ".join(_page_urls)
        raise ConnectionError(_messages["connection"].replace("{url}", shown).replace("{pages}", listing))
    method = str(method).upper()
    if method not in ("GET", "HEAD"):
        return Response(shown, 405, "", "text/plain; charset=utf-8", {"Allow": "GET, HEAD"})
    if key not in _pages:
        return Response(shown, 404, "" if method == "HEAD" else "Not Found", "text/plain; charset=utf-8")
    content = _pages[key]
    return Response(shown, 200, "" if method == "HEAD" else content, _content_type(content))

def get(url, params=None, **kwargs):
    return request("GET", url, params=params, **kwargs)

def head(url, **kwargs):
    return request("HEAD", url, **kwargs)

def post(url, data=None, json=None, **kwargs):
    return request("POST", url, **kwargs)

def put(url, data=None, **kwargs):
    return request("PUT", url, **kwargs)

def patch(url, data=None, **kwargs):
    return request("PATCH", url, **kwargs)

def delete(url, **kwargs):
    return request("DELETE", url, **kwargs)

class Session:
    def __init__(self):
        self.headers = CaseInsensitiveDict({"User-Agent": "python-requests/" + __version__})
        self.cookies = {}
        self.params = {}
    def request(self, method, url, **kwargs):
        return request(method, url, **kwargs)
    def get(self, url, **kwargs):
        return request("GET", url, **kwargs)
    def head(self, url, **kwargs):
        return request("HEAD", url, **kwargs)
    def post(self, url, data=None, json=None, **kwargs):
        return request("POST", url, **kwargs)
    def put(self, url, data=None, **kwargs):
        return request("PUT", url, **kwargs)
    def patch(self, url, data=None, **kwargs):
        return request("PATCH", url, **kwargs)
    def delete(self, url, **kwargs):
        return request("DELETE", url, **kwargs)
    def close(self):
        pass
    def __enter__(self):
        return self
    def __exit__(self, *args):
        self.close()

def session():
    return Session()
`;

/** 本文が `requests` を使っていそうか（非 Pro でページを渡さなかったときの注記を、使うカードにだけ出すため）。
 *  判定を外しても注記が出る/出ないだけ＝実行には影響しないので、単語の出現で十分。 */
export function mentionsRequests(code: string): boolean {
  return /\brequests\b/.test(code);
}
