export type TokenType = 'keyword' | 'string' | 'comment' | 'number' | 'type' | 'punctuation' | 'plain';
export type Token = { text: string; type: TokenType };

const JS_KEYWORDS = [
  'const','let','var','function','return','if','else','for','while','do','switch','case',
  'break','continue','class','extends','import','export','default','new','this','typeof',
  'instanceof','try','catch','finally','throw','async','await','of','in','null','undefined',
  'true','false','void','delete','yield','from','static','super','get','set',
];
const TS_EXTRA_KEYWORDS = [
  'type','interface','enum','implements','declare','abstract','as','namespace','module',
  'readonly','private','public','protected','override','satisfies','keyof','infer','never',
  'unknown','any',
];

const KEYWORDS: Record<string, Set<string>> = {
  javascript: new Set(JS_KEYWORDS),
  typescript: new Set([...JS_KEYWORDS, ...TS_EXTRA_KEYWORDS]),
  python: new Set([
    'def','class','return','if','elif','else','for','while','break','continue','import','from',
    'as','try','except','finally','raise','with','pass','lambda','yield','and','or','not','in',
    'is','None','True','False','global','nonlocal','del','assert','async','await',
  ]),
  java: new Set([
    'public','private','protected','class','interface','extends','implements','new','return',
    'if','else','for','while','do','switch','case','break','continue','try','catch','finally',
    'throw','throws','import','package','static','final','void','int','long','float','double',
    'boolean','char','byte','short','null','true','false','abstract','synchronized','volatile',
    'transient','native','instanceof','super','this','enum',
  ]),
  swift: new Set([
    'func','let','var','class','struct','enum','protocol','extension','return','if','else','for',
    'while','repeat','switch','case','break','continue','do','try','catch','throw','throws',
    'rethrows','import','guard','defer','in','where','as','is','nil','true','false','self',
    'Self','super','static','final','override','mutating','nonmutating','init','deinit',
    'subscript','get','set','willSet','didSet','lazy','weak','unowned','private','fileprivate',
    'internal','public','open','async','await','actor','some','any',
  ]),
  bash: new Set([
    'if','then','else','elif','fi','for','do','done','while','until','case','in','esac',
    'function','return','exit','echo','read','export','local','source','declare','set','unset',
    'shift','break','continue','true','false',
  ]),
  sql: new Set([
    'SELECT','FROM','WHERE','JOIN','LEFT','RIGHT','INNER','OUTER','ON','AS','AND','OR','NOT',
    'IN','IS','NULL','ORDER','BY','GROUP','HAVING','INSERT','INTO','VALUES','UPDATE','SET',
    'DELETE','CREATE','TABLE','DROP','ALTER','INDEX','PRIMARY','KEY','FOREIGN','REFERENCES',
    'DISTINCT','LIMIT','OFFSET','UNION','ALL','EXISTS','CASE','WHEN','THEN','ELSE','END',
    'select','from','where','join','left','right','inner','outer','on','as','and','or','not',
    'in','is','null','order','by','group','having','insert','into','values','update','set',
    'delete','create','table','drop','alter','index','primary','key','foreign','references',
    'distinct','limit','offset','union','all','exists','case','when','then','else','end',
  ]),
  cpp: new Set([
    'auto','bool','break','case','catch','char','class','const','continue','default','delete',
    'do','double','else','enum','explicit','extern','false','float','for','friend','goto','if',
    'inline','int','long','mutable','namespace','new','nullptr','operator','private','protected',
    'public','register','return','short','signed','sizeof','static','struct','switch','template',
    'this','throw','true','try','typedef','typename','union','unsigned','using','virtual','void',
    'volatile','while','include','define',
  ]),
  json: new Set(['true','false','null']),
  html: new Set([]),
  css: new Set([]),
  plaintext: new Set([]),
};

const TS_TYPES = new Set([
  'string','number','boolean','object','symbol','bigint','Array','Promise','Record',
  'Partial','Required','Readonly','Pick','Omit','Exclude','Extract','ReturnType',
  'Parameters','ConstructorParameters','InstanceType','NonNullable','Map','Set',
  'WeakMap','WeakSet','Date','RegExp','Error','void','never','unknown','any',
  'Function','Object','Number','String','Boolean','Symbol',
]);

// Returns tokens for HTML/CSS which need special handling
function tokenizeHtml(code: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < code.length) {
    // Comment <!-- ... -->
    if (code.startsWith('<!--', i)) {
      const end = code.indexOf('-->', i + 4);
      const closeEnd = end === -1 ? code.length : end + 3;
      tokens.push({ text: code.slice(i, closeEnd), type: 'comment' });
      i = closeEnd;
    // DOCTYPE / 宣言
    } else if (code.startsWith('<!', i)) {
      const end = code.indexOf('>', i);
      const closeEnd = end === -1 ? code.length : end + 1;
      tokens.push({ text: code.slice(i, closeEnd), type: 'keyword' });
      i = closeEnd;
    // Tag
    } else if (code[i] === '<') {
      tokens.push({ text: '<', type: 'punctuation' });
      i++;
      // 閉じタグのスラッシュ
      if (i < code.length && code[i] === '/') {
        tokens.push({ text: '/', type: 'punctuation' });
        i++;
      }
      // タグ名
      let j = i;
      while (j < code.length && /[a-zA-Z0-9\-]/.test(code[j])) j++;
      if (j > i) {
        tokens.push({ text: code.slice(i, j), type: 'keyword' });
        i = j;
      }
      // 属性部分（> が来るまで）
      while (i < code.length && code[i] !== '>') {
        if (code[i] === '/' && code[i + 1] === '>') {
          // 自己閉じスラッシュ
          tokens.push({ text: '/', type: 'punctuation' });
          i++;
        } else if (code[i] === '=') {
          tokens.push({ text: '=', type: 'punctuation' });
          i++;
        } else if (code[i] === '"' || code[i] === "'") {
          // 属性値（文字列）
          const quote = code[i];
          let k = i + 1;
          while (k < code.length && code[k] !== quote) {
            if (code[k] === '\\') k++;
            k++;
          }
          tokens.push({ text: code.slice(i, k + 1), type: 'string' });
          i = k + 1;
        } else if (/[a-zA-Z_\-:]/.test(code[i])) {
          // 属性名
          let k = i;
          while (k < code.length && /[a-zA-Z0-9_\-:.]/.test(code[k])) k++;
          tokens.push({ text: code.slice(i, k), type: 'type' });
          i = k;
        } else {
          tokens.push({ text: code[i], type: 'plain' });
          i++;
        }
      }
      // 閉じ >
      if (i < code.length && code[i] === '>') {
        tokens.push({ text: '>', type: 'punctuation' });
        i++;
      }
    // テキストコンテンツ
    } else {
      let j = i;
      while (j < code.length && code[j] !== '<') j++;
      tokens.push({ text: code.slice(i, j), type: 'plain' });
      i = j;
    }
  }
  return mergeAdjacentSameType(tokens);
}

function tokenizeCss(code: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let blockDepth = 0;   // {} のネスト深さ（0 = セレクター文脈）
  let afterColon = false; // declaration の : 以降（値の文脈）かどうか

  while (i < code.length) {
    // Block comment
    if (code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2);
      const closeEnd = end === -1 ? code.length : end + 2;
      tokens.push({ text: code.slice(i, closeEnd), type: 'comment' });
      i = closeEnd;
    // {
    } else if (code[i] === '{') {
      blockDepth++;
      afterColon = false;
      tokens.push({ text: '{', type: 'punctuation' });
      i++;
    // }
    } else if (code[i] === '}') {
      if (blockDepth > 0) blockDepth--;
      afterColon = false;
      tokens.push({ text: '}', type: 'punctuation' });
      i++;
    // ;
    } else if (code[i] === ';') {
      afterColon = false;
      tokens.push({ text: ';', type: 'punctuation' });
      i++;
    // : セレクター文脈では疑似クラス・疑似要素、宣言文脈ではプロパティ/値の区切り
    } else if (code[i] === ':') {
      if (blockDepth === 0) {
        // 疑似クラス / 疑似要素 (:hover, ::before など)
        let j = i;
        if (code[j + 1] === ':') j++; // ::
        j++;
        while (j < code.length && /[\w-]/.test(code[j])) j++;
        tokens.push({ text: code.slice(i, j), type: 'keyword' });
        i = j;
      } else {
        afterColon = true;
        tokens.push({ text: ':', type: 'punctuation' });
        i++;
      }
    // String
    } else if (code[i] === '"' || code[i] === "'") {
      const quote = code[i];
      let j = i + 1;
      while (j < code.length && code[j] !== quote) {
        if (code[j] === '\\') j++;
        j++;
      }
      tokens.push({ text: code.slice(i, j + 1), type: 'string' });
      i = j + 1;
    // At-rule
    } else if (code[i] === '@') {
      let j = i + 1;
      while (j < code.length && /[\w-]/.test(code[j])) j++;
      tokens.push({ text: code.slice(i, j), type: 'keyword' });
      i = j;
    // .クラスセレクター（セレクター文脈のみ）
    } else if (code[i] === '.' && blockDepth === 0) {
      let j = i + 1;
      while (j < code.length && /[\w-]/.test(code[j])) j++;
      tokens.push({ text: code.slice(i, j), type: 'type' });
      i = j;
    // # — セレクター文脈は ID セレクター、宣言文脈は hex カラー
    } else if (code[i] === '#') {
      let j = i + 1;
      if (blockDepth === 0) {
        // #id セレクター
        while (j < code.length && /[\w-]/.test(code[j])) j++;
        tokens.push({ text: code.slice(i, j), type: 'type' });
      } else {
        // hex カラー値
        while (j < code.length && /[\da-fA-F]/.test(code[j])) j++;
        tokens.push({ text: code.slice(i, j), type: 'string' });
      }
      i = j;
    // Number with units
    } else if (/[0-9]/.test(code[i]) || (code[i] === '-' && /[0-9]/.test(code[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < code.length && /[\d.%a-zA-Z]/.test(code[j])) j++;
      tokens.push({ text: code.slice(i, j), type: 'number' });
      i = j;
    // Word（識別子・セレクター・プロパティ名・値）
    } else if (/[a-zA-Z_]/.test(code[i]) || (code[i] === '-' && /[a-zA-Z_-]/.test(code[i + 1] ?? ''))) {
      let j = i;
      while (j < code.length && /[\w-]/.test(code[j])) j++;
      const word = code.slice(i, j);
      let type: TokenType;
      if (blockDepth === 0) {
        type = 'keyword';   // 要素セレクター (div, p, span …)
      } else if (!afterColon) {
        type = 'type';      // プロパティ名 (color, background-color …)
      } else {
        type = 'plain';     // プロパティ値の単語 (solid, none, inherit …)
      }
      tokens.push({ text: word, type });
      i = j;
    } else {
      tokens.push({ text: code[i], type: 'plain' });
      i++;
    }
  }
  return mergeAdjacentSameType(tokens);
}

function tokenizeJson(code: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < code.length) {
    // String
    if (code[i] === '"') {
      let j = i + 1;
      while (j < code.length && code[j] !== '"') {
        if (code[j] === '\\') j++;
        j++;
      }
      tokens.push({ text: code.slice(i, j + 1), type: 'string' });
      i = j + 1;
    // Number
    } else if (/[-\d]/.test(code[i]) && (i === 0 || /[^a-zA-Z_$]/.test(code[i - 1]))) {
      let j = i;
      if (code[j] === '-') j++;
      while (j < code.length && /[\d.eE+\-]/.test(code[j])) j++;
      if (j > i + (code[i] === '-' ? 1 : 0)) {
        tokens.push({ text: code.slice(i, j), type: 'number' });
        i = j;
      } else {
        tokens.push({ text: code[i], type: 'plain' });
        i++;
      }
    // Keywords
    } else if (/[a-z]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[a-z]/.test(code[j])) j++;
      const word = code.slice(i, j);
      if (word === 'true' || word === 'false' || word === 'null') {
        tokens.push({ text: word, type: 'keyword' });
      } else {
        tokens.push({ text: word, type: 'plain' });
      }
      i = j;
    } else {
      tokens.push({ text: code[i], type: 'plain' });
      i++;
    }
  }
  return mergeAdjacentSameType(tokens);
}

function mergeAdjacentSameType(tokens: Token[]): Token[] {
  const result: Token[] = [];
  for (const t of tokens) {
    if (result.length > 0 && result[result.length - 1].type === t.type) {
      result[result.length - 1] = { text: result[result.length - 1].text + t.text, type: t.type };
    } else {
      result.push({ ...t });
    }
  }
  return result;
}

export function tokenize(code: string, language: string): Token[] {
  if (!code) return [];
  const lang = language.toLowerCase();

  if (lang === 'plaintext') return [{ text: code, type: 'plain' }];
  if (lang === 'html') return tokenizeHtml(code);
  if (lang === 'css') return tokenizeCss(code);
  if (lang === 'json') return tokenizeJson(code);

  const keywords = KEYWORDS[lang] ?? new Set<string>();
  const isTs = lang === 'typescript';
  const isPython = lang === 'python';
  const isBash = lang === 'bash';
  const isSql = lang === 'sql';
  const isCpp = lang === 'cpp';

  const tokens: Token[] = [];
  let i = 0;

  while (i < code.length) {
    // Line comment: // (JS/TS/Java/Swift/C++) or # (Python/Bash) or -- (SQL)
    if (
      (code.startsWith('//', i) && !isPython && !isBash && !isSql) ||
      ((isPython || isBash) && code[i] === '#') ||
      (code.startsWith('--', i) && isSql)
    ) {
      const end = code.indexOf('\n', i);
      const lineEnd = end === -1 ? code.length : end;
      tokens.push({ text: code.slice(i, lineEnd), type: 'comment' });
      i = lineEnd;
      continue;
    }

    // Block comment /* ... */
    if (code.startsWith('/*', i) && !isPython && !isBash) {
      const end = code.indexOf('*/', i + 2);
      const closeEnd = end === -1 ? code.length : end + 2;
      tokens.push({ text: code.slice(i, closeEnd), type: 'comment' });
      i = closeEnd;
      continue;
    }

    // Python string prefix (f, b, r, rb, br, fr, rf, u など) + 文字列
    if (isPython && /[fFbBrRuU]/.test(code[i])) {
      let prefixEnd = i;
      while (prefixEnd < i + 3 && prefixEnd < code.length && /[fFbBrRuU]/.test(code[prefixEnd])) prefixEnd++;
      if (prefixEnd < code.length && (code[prefixEnd] === '"' || code[prefixEnd] === "'")) {
        const quote = code[prefixEnd];
        if (code.startsWith(quote.repeat(3), prefixEnd)) {
          const tripleQuote = quote.repeat(3);
          let j = prefixEnd + 3;
          while (j < code.length && !code.startsWith(tripleQuote, j)) j++;
          tokens.push({ text: code.slice(i, j + 3), type: 'string' });
          i = j + 3;
        } else {
          let j = prefixEnd + 1;
          while (j < code.length && code[j] !== quote && code[j] !== '\n') {
            if (code[j] === '\\') j++;
            j++;
          }
          tokens.push({ text: code.slice(i, j + 1), type: 'string' });
          i = j + 1;
        }
        continue;
      }
      // プレフィックスなし → word トークナイザーへフォールスルー
    }

    // Python triple-quoted string
    if (isPython && (code.startsWith('"""', i) || code.startsWith("'''", i))) {
      const quote = code.slice(i, i + 3);
      let j = i + 3;
      while (j < code.length && !code.startsWith(quote, j)) j++;
      tokens.push({ text: code.slice(i, j + 3), type: 'string' });
      i = j + 3;
      continue;
    }

    // Template literal (backtick) for JS/TS
    if (code[i] === '`' && !isPython && !isBash) {
      let j = i + 1;
      while (j < code.length && code[j] !== '`') {
        if (code[j] === '\\') j++;
        j++;
      }
      tokens.push({ text: code.slice(i, j + 1), type: 'string' });
      i = j + 1;
      continue;
    }

    // String (single or double quote)
    if (code[i] === '"' || code[i] === "'") {
      const quote = code[i];
      let j = i + 1;
      while (j < code.length && code[j] !== quote && code[j] !== '\n') {
        if (code[j] === '\\') j++;
        j++;
      }
      tokens.push({ text: code.slice(i, j + 1), type: 'string' });
      i = j + 1;
      continue;
    }

    // Number (integer, float, hex, binary)
    if (/[0-9]/.test(code[i]) || (code[i] === '.' && /[0-9]/.test(code[i + 1] ?? ''))) {
      let j = i;
      if (code[i] === '0' && (code[i + 1] === 'x' || code[i + 1] === 'X')) {
        j += 2;
        while (j < code.length && /[\da-fA-F_]/.test(code[j])) j++;
      } else if (code[i] === '0' && (code[i + 1] === 'b' || code[i + 1] === 'B')) {
        j += 2;
        while (j < code.length && /[01_]/.test(code[j])) j++;
      } else {
        while (j < code.length && /[\d._]/.test(code[j])) j++;
        if (j < code.length && (code[j] === 'e' || code[j] === 'E')) {
          j++;
          if (j < code.length && (code[j] === '+' || code[j] === '-')) j++;
          while (j < code.length && /[\d_]/.test(code[j])) j++;
        }
      }
      if (isCpp || lang === 'java') {
        while (j < code.length && /[uUlLfF]/.test(code[j])) j++;
      }
      tokens.push({ text: code.slice(i, j), type: 'number' });
      i = j;
      continue;
    }

    // @ decorator / annotation (JS/TS/Python/Java/Swift)
    if (code[i] === '@' && !isSql && !isBash && !isCpp) {
      let j = i + 1;
      while (j < code.length && /[\w.]/.test(code[j])) j++;
      tokens.push({ text: code.slice(i, j), type: 'keyword' });
      i = j;
      continue;
    }

    // Bash $variable / ${variable}
    if (isBash && code[i] === '$') {
      if (code[i + 1] === '{') {
        const end = code.indexOf('}', i + 2);
        const closeEnd = end === -1 ? code.length : end + 1;
        tokens.push({ text: code.slice(i, closeEnd), type: 'type' });
        i = closeEnd;
      } else {
        let j = i + 1;
        while (j < code.length && /\w/.test(code[j])) j++;
        tokens.push({ text: code.slice(i, j), type: 'type' });
        i = j;
      }
      continue;
    }

    // Preprocessor directive (C++): #include, #define, #ifdef など
    if (isCpp && code[i] === '#') {
      let j = i + 1;
      while (j < code.length && /\w/.test(code[j])) j++;
      tokens.push({ text: code.slice(i, j), type: 'keyword' });
      i = j;
      continue;
    }

    // Word (identifier or keyword)
    if (/[a-zA-Z_$]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[\w$]/.test(code[j])) j++;
      const word = code.slice(i, j);

      // 直後に '(' があれば関数呼び出し
      let k = j;
      while (k < code.length && code[k] === ' ') k++;
      const isCall = code[k] === '(' && !keywords.has(word);

      let type: TokenType = 'plain';
      if (keywords.has(word)) {
        type = 'keyword';
      } else if (isTs && TS_TYPES.has(word)) {
        type = 'type';
      } else if (isCall) {
        type = 'type';
      } else if (/^[A-Z][a-zA-Z0-9_]*$/.test(word) && (isTs || lang === 'java' || lang === 'swift' || isCpp)) {
        type = 'type';
      }

      tokens.push({ text: word, type });
      i = j;
      continue;
    }

    // Punctuation / operators
    if (/[{}[\]().,;:=+\-*/<>!&|^~%?@]/.test(code[i])) {
      tokens.push({ text: code[i], type: 'punctuation' });
      i++;
      continue;
    }

    // Whitespace / newlines / other
    tokens.push({ text: code[i], type: 'plain' });
    i++;
  }

  return mergeAdjacentSameType(tokens);
}
