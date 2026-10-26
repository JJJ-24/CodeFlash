// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // app-example は create-expo-app のテンプレートの残り（gitignore 済み・tsconfig でも除外）
    ignores: ['dist/*', 'app-example/*'],
  },
  {
    // eslint-config-expo 58（SDK 58）から React Compiler の診断規則がエラーで入った。
    // 既存コードで 300 件以上あり、SDK 移行（060）とは別に直すので当面は警告にとどめる。
    rules: {
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
]);
