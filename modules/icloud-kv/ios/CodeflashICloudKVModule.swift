import ExpoModulesCore
import Foundation

/**
 * iCloud Key-Value Store（`NSUbiquitousKeyValueStore`）アクセス（チケット035）。
 *
 * Pro 1週間体験の開始時刻（trialStartedAt）を Apple ID 単位で保持し、
 * 再インストール後も「一度きり」を守るために使う。
 * KV ストアは iCloud Documents（DB同期）とは別権限（ubiquity-kvstore-identifier）で、
 * 容量 1MB/1024キーまで・自動同期・エンタイトルメント以外の設定不要。
 *
 * 注意: `synchronize()` は「ディスクへの反映＋同期キュー投入」であり、即時のクラウド往復ではない。
 * iCloud 未サインイン時は端末ローカルにのみ保存される（isICloudAvailable で判別可能）。
 */
public class CodeflashICloudKVModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CodeflashICloudKV")

    // iCloud にサインインしているか（＝KV が実際に Apple ID と同期されるかの目安）
    Function("isICloudAvailable") { () -> Bool in
      FileManager.default.ubiquityIdentityToken != nil
    }

    Function("getString") { (key: String) -> String? in
      let store = NSUbiquitousKeyValueStore.default
      // 読み出し前に最新化を要求（起動直後にリモート値が未取得のことがあるため）
      store.synchronize()
      return store.string(forKey: key)
    }

    // 戻り値: synchronize が受理されたか（false は KV ストア利用不可のシグナル）
    Function("setString") { (key: String, value: String) -> Bool in
      let store = NSUbiquitousKeyValueStore.default
      store.set(value, forKey: key)
      return store.synchronize()
    }

    Function("removeKey") { (key: String) in
      let store = NSUbiquitousKeyValueStore.default
      store.removeObject(forKey: key)
      store.synchronize()
    }
  }
}
