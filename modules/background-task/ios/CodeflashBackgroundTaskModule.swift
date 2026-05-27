import ExpoModulesCore
import UIKit

/**
 * iCloud 同期用のバックグラウンドタスクアサーション。
 *
 * アプリがバックグラウンドへ移行すると iOS は数秒で実行を凍結するため、大量データの
 * スナップショット作成や iCloud コンテナへの配置が完了しないことがある。
 * `UIApplication.beginBackgroundTask` で猶予（最大 ~30 秒）を要求し、その間に処理を
 * 完了させる。実際のバイト転送はその後 iCloud デーモンが裏で行う。
 */
public class CodeflashBackgroundTaskModule: Module {
  private var tasks: [Int: UIBackgroundTaskIdentifier] = [:]
  private var counter: Int = 0
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("CodeflashBackgroundTask")

    // バックグラウンド実行の猶予を要求し、JS へ返す識別子（endTask に渡す）を返す。
    Function("beginTask") { () -> Int in
      self.lock.lock()
      self.counter += 1
      let id = self.counter
      self.lock.unlock()

      self.onMain {
        var taskId = UIBackgroundTaskIdentifier.invalid
        taskId = UIApplication.shared.beginBackgroundTask(withName: "codeflash-icloud-sync-\(id)") { [weak self] in
          // 期限切れハンドラ：iOS が打ち切る直前に必ずタスクを終了する。
          self?.endTaskInternal(id)
        }
        self.lock.lock()
        self.tasks[id] = taskId
        self.lock.unlock()
      }
      return id
    }

    // 処理完了時にタスクを終了する（猶予を即解放）。
    Function("endTask") { (id: Int) in
      self.endTaskInternal(id)
    }
  }

  private func endTaskInternal(_ id: Int) {
    self.lock.lock()
    let taskId = self.tasks[id]
    self.tasks.removeValue(forKey: id)
    self.lock.unlock()
    guard let taskId, taskId != .invalid else { return }
    self.onMain {
      UIApplication.shared.endBackgroundTask(taskId)
    }
  }

  /// UIApplication API はメインスレッドから呼ぶ。JS スレッドからの呼び出しでもデッドロックしないようガードする。
  private func onMain(_ block: () -> Void) {
    if Thread.isMainThread {
      block()
    } else {
      DispatchQueue.main.sync(execute: block)
    }
  }
}
