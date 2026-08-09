/**
 * DB ロジックを Node 上で実行するための検証ハーネス（テストフレームワーク非導入のための代替）。
 *
 * 本アプリの DB 層（`lib/database/*`・`lib/export.ts`・`lib/import.ts`・`lib/tsv.ts`）は
 * expo-sqlite の非同期 API と expo/RN のモジュールに依存しているため、そのままでは Node で動かない。
 * このファイルは次の2つを用意して、**アプリの実コードをそのまま呼べる**ようにする：
 *
 * 1. `installModuleStubs()` … expo/RN モジュールをスタブに差し替え、`@/` エイリアスを解決する
 * 2. `makeDb()`            … `node:sqlite`（同期）を expo-sqlite 互換の非同期 API でくるむ
 *
 * 実行例: `npm run verify:db`（= `sucrase-node scripts/verify-db.ts`）
 *
 * ⚠️ **アプリのモジュールは `import` ではなく `require()` で読むこと。**
 *    `import` はファイル先頭へ巻き上げられ、スタブを入れる前に expo モジュールが解決されて落ちる。
 *
 * 用途：カラム追加マイグレーション・旧エクスポートの読み込み・エクスポート/インポート往復など、
 * `docs/db-migration-checklist.md` の確認を実機を出さずに済ませるためのもの。
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import * as nodePath from 'path';

/** 仮想ファイルシステム（スタブした expo-file-system の中身）。
 *  エクスポートが書いた JSON をインポートに食わせる、といった往復に使う。 */
export const fsFiles: Record<string, string> = {};

const fileSystemStub = {
  documentDirectory: '/doc/',
  cacheDirectory: '/cache/',
  async readAsStringAsync(uri: string) {
    if (!(uri in fsFiles)) throw new Error('ENOENT ' + uri);
    return fsFiles[uri];
  },
  async writeAsStringAsync(uri: string, content: string) {
    fsFiles[uri] = content;
  },
  async getInfoAsync() {
    return { exists: false };
  },
  async deleteAsync() {},
  async makeDirectoryAsync() {},
  async readDirectoryAsync() {
    return [] as string[];
  },
};

/**
 * expo/RN モジュールをスタブに差し替え、`@/` を repo ルートに解決する require フックを入れる。
 * **アプリのモジュールを require する前に一度だけ呼ぶこと。**
 *
 * @param extraStubs 追加のスタブ。キーはモジュール名か、`@/store/settings` のようなエイリアスパス。
 */
export function installModuleStubs(extraStubs: Record<string, unknown> = {}): void {
  const Module = require('module');
  const root = nodePath.resolve(__dirname, '..');

  const stubs: Record<string, unknown> = {
    'expo-file-system/legacy': fileSystemStub,
    'expo-file-system': fileSystemStub,
    'expo-sharing': { async shareAsync() {} },
    'expo-document-picker': { async getDocumentAsync() { return { canceled: true }; } },
    'expo-image-manipulator': { ImageManipulator: {}, SaveFormat: {} },
    'expo-image-picker': {},
    'expo-localization': { getLocales: () => [{ languageCode: 'ja' }] },
    'react-native': { Platform: { OS: 'ios' }, Appearance: { getColorScheme: () => 'light' } },
    '@react-native-async-storage/async-storage': {
      async multiGet() { return [] as [string, string | null][]; },
      async getItem() { return null; },
      async setItem() {},
    },
  };
  // エイリアス（`@/...`）指定のスタブは実パスへ寄せておく（フックが解決後の名前で引くため）
  for (const [key, value] of Object.entries(extraStubs)) {
    stubs[key.startsWith('@/') ? nodePath.join(root, key.slice(2)) : key] = value;
  }

  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request: string, ...rest: unknown[]) {
    const resolved = request.startsWith('@/') ? nodePath.join(root, request.slice(2)) : request;
    if (resolved in stubs) {
      // すでに解決済みの「モジュール」として cache に差し込み、その id を返す
      if (!Module._cache[resolved]) {
        Module._cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: stubs[resolved] };
      }
      return resolved;
    }
    return origResolve.call(this, resolved, ...rest);
  };
}

/** expo-sqlite が受け取る値に寄せる（undefined → NULL・boolean → 0/1）。 */
function toParam(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

/** expo-sqlite 互換（本アプリが使う範囲）の DB を `node:sqlite` のインメモリ DB で作る。 */
export function makeDb() {
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(':memory:');
  return {
    async execAsync(sql: string) {
      raw.exec(sql);
    },
    async runAsync(sql: string, params: unknown[] = []) {
      raw.prepare(sql).run(...params.map(toParam));
    },
    async getAllAsync(sql: string, params: unknown[] = []) {
      return raw.prepare(sql).all(...params.map(toParam));
    },
    async getFirstAsync(sql: string, params: unknown[] = []) {
      return raw.prepare(sql).get(...params.map(toParam)) ?? null;
    },
    async withTransactionAsync(fn: () => Promise<void>) {
      raw.exec('BEGIN');
      try {
        await fn();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    /** 生の同期 DB（PRAGMA や、アプリ側には無い操作＝旧スキーマの再現などに使う） */
    raw,
  };
}

/** 素朴なアサーション。最後に `report()` を呼ぶと結果を出して失敗時に exit(1) する。 */
export function createAsserts() {
  let passed = 0;
  const failed: string[] = [];

  function check(label: string, cond: boolean, detail?: unknown) {
    if (cond) {
      passed++;
      console.log('  ✓ ' + label);
    } else {
      failed.push(label);
      console.log('  ✗ ' + label + (detail !== undefined ? '  → ' + JSON.stringify(detail) : ''));
    }
  }

  /** 深い等価（JSON 文字列比較）。期待値をラベルに添えて出す。 */
  function eq(label: string, actual: unknown, expected: unknown) {
    check(`${label}  (期待: ${JSON.stringify(expected)})`, JSON.stringify(actual) === JSON.stringify(expected), actual);
  }

  function report() {
    console.log(`\n===== ${passed} passed, ${failed.length} failed =====`);
    if (failed.length > 0) {
      failed.forEach((f) => console.log('FAILED: ' + f));
      process.exit(1);
    }
  }

  return { check, eq, report };
}
