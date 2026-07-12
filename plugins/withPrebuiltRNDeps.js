const { withPodfile } = require('@expo/config-plugins');

// RN 本体はソースビルド（patches/react-native の ScrollView キーボードガードを効かせるため）しつつ、
// サードパーティ依存（fmt/folly/glog/boost）はプリビルド（Maven tarball）を使う。
// フルソースビルドだと fmt が新しい Xcode の Clang で consteval エラーになりコンパイルできない。
// ios.buildReactNativeFromSource=true は RCT_USE_RN_DEP / RCT_USE_PREBUILT_RNCORE の両方を落とすので、
// 依存側（RCT_USE_RN_DEP）だけをここで立て直す。
const MARKER = "ENV['RCT_USE_RN_DEP'] ||= '1' # withPrebuiltRNDeps";

module.exports = function withPrebuiltRNDeps(config) {
  return withPodfile(config, (c) => {
    if (!c.modResults.contents.includes(MARKER)) {
      c.modResults.contents = c.modResults.contents.replace(
        /^ENV\['RCT_USE_RN_DEP'\]/m,
        `${MARKER}\nENV['RCT_USE_RN_DEP']`
      );
    }
    return c;
  });
};
