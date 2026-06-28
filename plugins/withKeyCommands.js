// 034: react-native-key-command の iOS ネイティブ結線を prebuild で恒久化する config plugin。
// ios/ は gitignore（CNG）のため、AppDelegate(Swift) の keyCommands override と
// ブリッジヘッダの import を毎回の prebuild で自動注入する。
const { withAppDelegate, withDangerousMod } = require('@expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');
const fs = require('fs');
const path = require('path');

const IMPORT_LINE = '#import <react-native-key-command/HardwareShortcuts.h>';

const METHODS = `
  // 034: ハードウェアキーを責任者チェーン最下層(AppDelegate)で受ける（react-native-key-command）
  // 矢印・Tab の優先（wantsPriorityOverSystemBehavior）は iPad 限定で立てる。
  // ・iPad: UIFocusSystem が修飾なし矢印/Tab を横取りするため優先が必須（固定。動的出し分けはフリーズ）。
  //   編集が起きる画面では矢印/Tab を JS 側で最初から登録しない運用で編集中カーソル移動と両立させる。
  // ・iPhone: フォーカスエンジンが無いので優先を立てない。立てるとテキスト編集中に矢印が
  //   カーソル移動より優先されてキーコマンド（タブ切替等）が発火してしまう。優先なしなら
  //   責任者チェーンで自然に住み分く（編集中＝入力欄が矢印消費／非編集＝キーコマンド発火）。
  public override var keyCommands: [UIKeyCommand]? {
    let commands = HardwareShortcuts.sharedInstance().keyCommands() as? [UIKeyCommand]
    if #available(iOS 15.0, *), UIDevice.current.userInterfaceIdiom == .pad {
      let focusKeys: Set<String> = [
        UIKeyCommand.inputUpArrow, UIKeyCommand.inputDownArrow,
        UIKeyCommand.inputLeftArrow, UIKeyCommand.inputRightArrow, "\\t",
      ]
      commands?.forEach { cmd in
        if let input = cmd.input, focusKeys.contains(input) {
          cmd.wantsPriorityOverSystemBehavior = true
        }
      }
    }
    return commands
  }
  @objc public func handleKeyCommand(_ keyCommand: UIKeyCommand) {
    HardwareShortcuts.sharedInstance().handleKeyCommand(keyCommand)
  }`;

// AppDelegate.swift の class 本体直後に keyCommands/handleKeyCommand を注入（idempotent）。
function withKeyCommandsAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('[withKeyCommands] AppDelegate が Swift ではありません');
    }
    cfg.modResults.contents = mergeContents({
      tag: 'react-native-key-command',
      src: cfg.modResults.contents,
      newSrc: METHODS,
      anchor: /class AppDelegate:\s*ExpoAppDelegate\s*\{/,
      offset: 1,
      comment: '//',
    }).contents;
    return cfg;
  });
}

// <project>-Bridging-Header.h に HardwareShortcuts の import を追記（idempotent）。
function withKeyCommandsBridgingHeader(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const { platformProjectRoot, projectName } = cfg.modRequest;
      const headerPath = path.join(
        platformProjectRoot,
        projectName,
        `${projectName}-Bridging-Header.h`,
      );
      if (fs.existsSync(headerPath)) {
        let contents = fs.readFileSync(headerPath, 'utf8');
        if (!contents.includes(IMPORT_LINE)) {
          contents = `${contents.trimEnd()}\n${IMPORT_LINE}\n`;
          fs.writeFileSync(headerPath, contents);
        }
      } else {
        throw new Error(`[withKeyCommands] ブリッジヘッダが見つかりません: ${headerPath}`);
      }
      return cfg;
    },
  ]);
}

module.exports = function withKeyCommands(config) {
  config = withKeyCommandsAppDelegate(config);
  config = withKeyCommandsBridgingHeader(config);
  return config;
};
