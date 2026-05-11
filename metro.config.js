const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// iOS/Android ビルド時に expo-sqlite の web worker (.wasm) を空モジュールで解決する
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith('.wasm')) {
    return { type: 'empty' };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
