/**
 * 059：Python の `requests` の代役（lib/code-execution/pyRequestsShim.ts）の検証。
 *
 * Pyodide は Node で動かせないので、代役のソースを**ローカルの python3 でそのまま**動かす
 * （ソースは素の Python で書いてあり、ホストから渡すのは `_cf_setup` と `_cf_on_use` だけ）。
 * あわせて、サンドボックスが生成する HTML の `<script>` が JS として壊れていないか（エスケープの事故）を確かめる。
 *
 *   npm run verify:pyrequests
 */
import { spawnSync } from 'node:child_process';

import { installModuleStubs } from './db-harness';

installModuleStubs(); // `@/` の解決（codeBlockStops が使う）

/* eslint-disable @typescript-eslint/no-require-imports */
const { codeBlockSubStops } = require('../lib/codeBlockStops');
const { PY_REQUESTS_SHIM_SOURCE, mentionsRequests, isJsonPage } = require('../lib/code-execution/pyRequestsShim');
const { pagesFromDeckStages } = require('../lib/deckStages');
const { buildSandboxHtml } = require('../lib/code-execution/sandbox');

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passes++;
  } else {
    failures++;
    console.log(`✗ ${name}`, detail ?? '');
  }
}

// ---- 1. TS 側：ページの抽出・本文の判定 ------------------------------------------
const stages = [
  { id: 'a', name: 'https://example.com/news', content: '<ul></ul>' },
  { id: 'b', name: '  http://example.com/a  ', content: '<h1>A</h1>' },
  { id: 'c', name: '一覧の土台', content: '<div></div>' },
  { id: 'd', name: 'example.com/x', content: '<p></p>' },
  { id: 'e', name: 'https://', content: '<p></p>' },
];
const pages = pagesFromDeckStages(stages);
check('T1 URL 名の土台だけがページになる', JSON.stringify(pages.map((p: { url: string }) => p.url)) === JSON.stringify(['https://example.com/news', 'http://example.com/a']), pages);
check('T1 土台が無ければ空', pagesFromDeckStages(undefined).length === 0);
check('T2 requests を使う本文', mentionsRequests('import requests\nrequests.get("x")'));
check('T2 requests を使わない本文', !mentionsRequests('from bs4 import BeautifulSoup'));
check('T2 単語の一部は数えない', !mentionsRequests('my_requests_count = 1'));

// 059 Phase 2：カード編集の J/K の止まり先（「デッキのページ」はページがあるときだけ・Pro だけ）
const pyBlock = { type: 'code', language: 'python', content: '', executable: true };
check('T2b ページありの Python は pyPages に止まる', JSON.stringify(codeBlockSubStops(pyBlock, { isPro: true, htmlStages: stages, sqlStages: [] })) === '["pyPages"]');
check('T2b ページなしの Python は止まらない', codeBlockSubStops(pyBlock, { isPro: true, htmlStages: [stages[2]], sqlStages: [] }).length === 0);
check('T2b 非 Pro は止まらない', codeBlockSubStops(pyBlock, { isPro: false, htmlStages: stages, sqlStages: [] }).length === 0);
check('T2b js には pyPages を足さない', !codeBlockSubStops({ ...pyBlock, language: 'javascript' }, { isPro: true, htmlStages: stages, sqlStages: [] }).includes('pyPages'));

// ---- 2. 生成 HTML の <script> が JS として読めるか ------------------------------
function scriptBodies(html: string): string[] {
  const out: string[] = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}
const nastyPages = [
  { url: 'https://example.com/', content: '<script>alert("x")</script><p>`${a}` \\ \'q\'</p>' },
  { url: 'https://example.com/data', content: '{"items": [1, 2]}' },
];
const htmlWith = buildSandboxHtml('print("</script>")', 'python', undefined, undefined, { pages: nastyPages, messages: { connection: 'x {url} {pages}' } });
const htmlWithout = buildSandboxHtml('print(1)', 'python');
for (const [label, html] of [['ページあり', htmlWith], ['ページなし', htmlWithout]] as const) {
  const bodies = scriptBodies(html);
  check(`T3 ${label}：<script> が1つ（途中で閉じていない）`, bodies.length === 1, bodies.length);
  try {
    // 実行はせず構文だけ確かめる
    new Function(bodies[0]);
    passes++;
  } catch (e) {
    failures++;
    console.log(`✗ T3 ${label}：構文エラー`, e);
  }
}
check('T3 ページなしでは代役を差し込まない', htmlWithout.includes('var _requestsConfig = null;'));
check('T3 ページありでは設定を埋め込む', htmlWith.includes('var _requestsConfig = {'));

// ---- 3. Python 側：python3 で代役を直接動かす -----------------------------------
const config = {
  pages: [
    { url: 'https://example.com/news', content: '<ul><li><a href="/a">A</a></li></ul>' },
    { url: 'https://example.com/a/', content: '<h1>記事A</h1>' },
    { url: 'https://example.com/search?q=py', content: '<p>py</p>' },
    { url: 'https://api.example.com/items', content: ' [{"id": 1}] ' },
    { url: 'https://example.com/broken', content: '{not json' },
    { url: 'https://EXAMPLE.com/news', content: 'duplicate' },
  ],
  messages: { connection: 'NO {url} | {pages}' },
};

// Phase 3：ページを見る画面の JSON 判定（TS の isJsonPage）が、代役の Content-Type（Python の _content_type）と一致するか
const jsonCases = ['[1, 2]', ' {"a": 1} ', '{not json', '<ul></ul>', '', '[', '"text"', '123', '{}', '[]\n', '<p>{"a":1}</p>'];
const jsonExpected = jsonCases.map((c) => isJsonPage(c));
check('T4 isJsonPage の代表例', JSON.stringify(jsonExpected) === JSON.stringify([true, true, false, false, false, false, false, false, true, true, false]), jsonExpected);

const pyTest = String.raw`
import sys, types, json
src = sys.stdin.read()
m = types.ModuleType("requests")
exec(compile(src, "<requests>", "exec"), m.__dict__)
used = []
m._cf_setup(CONFIG)
m._cf_on_use = lambda: used.append(1)
sys.modules["requests"] = m
sys.modules["requests.exceptions"] = m.exceptions

import requests
from requests.exceptions import HTTPError, ConnectionError as RCE, MissingSchema, InvalidSchema, JSONDecodeError
results = []
def check(name, ok, detail=""):
    results.append([name, bool(ok), str(detail)])

r = requests.get("https://example.com/news")
check("P1 200 で中身が返る", r.status_code == 200 and r.ok and "<ul>" in r.text, r.status_code)
check("P1 重複した URL は先の土台", r.text != "duplicate")
check("P1 HTML の Content-Type", r.headers["content-type"] == "text/html; charset=utf-8", r.headers)
check("P1 content は UTF-8 の bytes", requests.get("https://example.com/a").content == "<h1>記事A</h1>".encode("utf-8"))
check("P1 repr", repr(r) == "<Response [200]>", repr(r))
check("P1 url", r.url == "https://example.com/news", r.url)

check("P2 末尾の / を同一視", requests.get("https://example.com/a").status_code == 200)
check("P2 末尾の / を同一視（逆）", requests.get("https://example.com/news/").status_code == 200)
check("P2 ホストの大文字小文字", requests.get("https://Example.COM/news").status_code == 200)
check("P2 # 以降は捨てる", requests.get("https://example.com/news#top").status_code == 200)
check("P2 params でクエリ", requests.get("https://example.com/search", params={"q": "py"}).text == "<p>py</p>")
check("P2 クエリは完全一致", requests.get("https://example.com/search?q=js").status_code == 404)
rp = requests.get("https://example.com/search", params={"q": "py"})
check("P2 params の付いた url", rp.url == "https://example.com/search?q=py", rp.url)

nf = requests.get("https://example.com/missing")
check("P3 パスが無ければ 404（例外にしない）", nf.status_code == 404 and not nf.ok and nf.reason == "Not Found")
try:
    nf.raise_for_status()
    check("P3 raise_for_status", False)
except HTTPError as e:
    check("P3 raise_for_status の文言", str(e) == "404 Client Error: Not Found for url: https://example.com/missing", e)
    check("P3 例外に response", e.response is nf)
r.raise_for_status()
check("P3 200 では raise しない", True)

try:
    requests.get("https://other.example.org/")
    check("P4 未登録ホスト", False)
except RCE as e:
    msg = str(e)
    check("P4 ConnectionError に URL 一覧", msg.startswith("NO https://other.example.org/ | https://example.com/news, https://example.com/a/"), msg)
    check("P4 RequestException の子", isinstance(e, requests.RequestException))
try:
    requests.get("http://example.com/news")
    check("P4 http と https は別", False)
except RCE:
    check("P4 http と https は別", True)

try:
    requests.get("example.com/news")
    check("P5 スキーム無し", False)
except MissingSchema as e:
    check("P5 MissingSchema", "No scheme supplied" in str(e) and isinstance(e, ValueError), e)
try:
    requests.get("ftp://example.com/")
    check("P5 ftp", False)
except InvalidSchema:
    check("P5 InvalidSchema", True)

api = requests.get("https://api.example.com/items")
check("P6 JSON の Content-Type", api.headers.get("Content-Type") == "application/json", api.headers)
check("P6 json()", api.json() == [{"id": 1}])
broken = requests.get("https://example.com/broken")
check("P6 壊れた JSON は HTML 扱い", broken.headers["Content-Type"].startswith("text/html"))
try:
    broken.json()
    check("P6 json() の失敗", False)
except JSONDecodeError as e:
    check("P6 JSONDecodeError は ValueError でもある", isinstance(e, ValueError))

h = requests.head("https://example.com/news")
check("P7 HEAD は本文が空", h.status_code == 200 and h.text == "" and h.headers["Content-Type"].startswith("text/html"))
p = requests.post("https://example.com/news", data={"a": 1})
check("P7 POST は 405", p.status_code == 405 and p.headers["Allow"] == "GET, HEAD", p.status_code)

with requests.Session() as s:
    s.headers.update({"User-Agent": "test"})
    check("P8 Session.get", s.get("https://example.com/news", timeout=3).status_code == 200)
check("P8 session()", requests.session().get("https://example.com/a").ok)

lines = list(requests.get("https://example.com/a").iter_lines(decode_unicode=True))
check("P9 iter_lines", lines == ["<h1>記事A</h1>"], lines)
check("P9 codes", requests.codes.ok == 200)
check("P9 from requests import HTTPError", requests.HTTPError is HTTPError)
check("P10 呼ぶたびに通知", len(used) >= 20, len(used))

for i, (c, ts) in enumerate(zip(JSON_CASES, JSON_TS)):
    py_json = m._content_type(c) == "application/json"
    check("P11 JSON の判定が TS と一致 #%d" % i, py_json == ts, repr(c))

print(json.dumps(results, ensure_ascii=False))
`.replace('CONFIG', JSON.stringify(JSON.stringify(config)))
  .replace('JSON_CASES', JSON.stringify(jsonCases))
  .replace('JSON_TS', JSON.stringify(jsonExpected).replace(/true/g, 'True').replace(/false/g, 'False'));

const py = spawnSync('python3', ['-c', pyTest], { input: PY_REQUESTS_SHIM_SOURCE, encoding: 'utf8' });
if (py.status !== 0) {
  failures++;
  console.log('✗ python3 の実行に失敗', py.stderr || py.error);
} else {
  const results = JSON.parse(py.stdout.trim().split('\n').pop() ?? '[]') as [string, boolean, string][];
  for (const [name, ok, detail] of results) check(name, ok, detail);
}

console.log(`\n${failures === 0 ? '✓' : '✗'} verify:pyrequests  ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
