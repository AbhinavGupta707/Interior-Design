import CryptoKit
import Foundation

enum BackgroundUploadNamespace: String, Codable, Sendable {
  case captureArtifact = "c7-capture-artifact"
  case immutableEvidence = "c2-immutable-evidence"
}

struct BackgroundUploadContext: Codable, Equatable, Sendable {
  let captureSessionId: UUID?
  let checksumSha256: String
  let namespace: BackgroundUploadNamespace
  let partNumber: Int
  let projectId: UUID
  let uploadSessionId: UUID

  fileprivate var completionKey: String {
    let captureSession = captureSessionId?.uuidString.lowercased() ?? "none"
    let value = [
      namespace.rawValue,
      projectId.uuidString.lowercased(),
      captureSession,
      uploadSessionId.uuidString.lowercased(),
      String(partNumber),
      checksumSha256,
    ].joined(separator: ":")
    return SHA256.hash(data: Data(value.utf8))
      .map { String(format: "%02x", $0) }
      .joined()
  }

  fileprivate func validate() throws {
    guard (1...10_000).contains(partNumber),
      (16...256).contains(checksumSha256.count),
      checksumSha256.unicodeScalars.allSatisfy({ $0.value >= 32 && $0.value != 127 })
    else { throw BackgroundUploadRecoveryError.invalidContext }
  }
}

enum BackgroundUploadRecoveryError: Error, Equatable, Sendable {
  case corrupt
  case invalidContext
  case persistence
}

private struct BackgroundUploadTaskRecord: Codable, Sendable {
  let context: BackgroundUploadContext
  let registeredAt: Date
}

private struct BackgroundUploadCompletionRecord: Codable, Sendable {
  let completedAt: Date
  let context: BackgroundUploadContext
  let etag: String
  let statusCode: Int
}

private struct BackgroundUploadRecoveryState: Codable, Sendable {
  var completions: [String: BackgroundUploadCompletionRecord] = [:]
  var tasks: [String: BackgroundUploadTaskRecord] = [:]
}

/// Persists only opaque scope UUIDs, checksums, part numbers, response status, and ETag. It never
/// persists a signed URL, bearer token, object key, request header, source path, or response body.
final class BackgroundUploadRecoveryStore: @unchecked Sendable {
  private static let maximumCompletions = 2_048
  private static let maximumTasks = 2_048
  private static let retentionSeconds: TimeInterval = 7 * 24 * 60 * 60

  private let decoder = JSONDecoder()
  private let encoder: JSONEncoder
  private let fileManager: FileManager
  private let lock = NSLock()
  private let root: URL
  private let stateURL: URL

  init(root: URL? = nil, fileManager: FileManager = .default) {
    self.fileManager = fileManager
    self.root =
      root
      ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("BackgroundUploadRecovery", isDirectory: true)
    stateURL = self.root.appendingPathComponent("state.json", isDirectory: false)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    self.encoder = encoder
  }

  func register(
    sessionIdentifier: String,
    taskIdentifier: Int,
    context: BackgroundUploadContext
  ) throws {
    try context.validate()
    try lock.withLock {
      var state = try load()
      prune(&state, now: Date())
      let key = taskKey(sessionIdentifier: sessionIdentifier, taskIdentifier: taskIdentifier)
      if let existing = state.tasks[key], existing.context != context {
        throw BackgroundUploadRecoveryError.corrupt
      }
      state.tasks[key] = BackgroundUploadTaskRecord(context: context, registeredAt: Date())
      try save(state)
    }
  }

  func discard(sessionIdentifier: String, taskIdentifier: Int) {
    try? lock.withLock {
      var state = try load()
      state.tasks.removeValue(
        forKey: taskKey(
          sessionIdentifier: sessionIdentifier,
          taskIdentifier: taskIdentifier
        )
      )
      try save(state)
    }
  }

  func recordCompletion(
    sessionIdentifier: String,
    taskIdentifier: Int,
    response: HTTPURLResponse?
  ) {
    try? lock.withLock {
      var state = try load()
      let key = taskKey(sessionIdentifier: sessionIdentifier, taskIdentifier: taskIdentifier)
      guard let task = state.tasks.removeValue(forKey: key) else { return }
      if let response,
        (200..<300).contains(response.statusCode),
        let etag = response.value(forHTTPHeaderField: "ETag"),
        (1...1_024).contains(etag.count),
        etag.unicodeScalars.allSatisfy({ $0.value >= 32 && $0.value != 127 })
      {
        state.completions[task.context.completionKey] = BackgroundUploadCompletionRecord(
          completedAt: Date(),
          context: task.context,
          etag: etag,
          statusCode: response.statusCode
        )
      }
      prune(&state, now: Date())
      try save(state)
    }
  }

  func completion(for context: BackgroundUploadContext) -> (statusCode: Int, etag: String)? {
    guard (try? context.validate()) != nil else { return nil }
    return try? lock.withLock {
      var state = try load()
      prune(&state, now: Date())
      try save(state)
      guard let completion = state.completions[context.completionKey],
        completion.context == context
      else { return nil }
      return (completion.statusCode, completion.etag)
    }
  }

  private func load() throws -> BackgroundUploadRecoveryState {
    guard fileManager.fileExists(atPath: stateURL.path) else {
      return BackgroundUploadRecoveryState()
    }
    do {
      return try decoder.decode(
        BackgroundUploadRecoveryState.self,
        from: Data(contentsOf: stateURL)
      )
    } catch {
      throw BackgroundUploadRecoveryError.corrupt
    }
  }

  private func save(_ state: BackgroundUploadRecoveryState) throws {
    do {
      try fileManager.createDirectory(
        at: root,
        withIntermediateDirectories: true,
        attributes: [
          .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication
        ]
      )
      var protectedRoot = root
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try protectedRoot.setResourceValues(values)
      try encoder.encode(state).write(
        to: stateURL,
        options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
      )
      try fileManager.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: stateURL.path
      )
    } catch {
      throw BackgroundUploadRecoveryError.persistence
    }
  }

  private func prune(_ state: inout BackgroundUploadRecoveryState, now: Date) {
    let oldest = now.addingTimeInterval(-Self.retentionSeconds)
    state.tasks = state.tasks.filter { $0.value.registeredAt >= oldest }
    state.completions = state.completions.filter { $0.value.completedAt >= oldest }
    if state.tasks.count > Self.maximumTasks {
      for (key, _) in state.tasks.sorted(by: { $0.value.registeredAt < $1.value.registeredAt })
        .prefix(state.tasks.count - Self.maximumTasks)
      {
        state.tasks.removeValue(forKey: key)
      }
    }
    if state.completions.count > Self.maximumCompletions {
      for (key, _) in state.completions
        .sorted(by: { $0.value.completedAt < $1.value.completedAt })
        .prefix(state.completions.count - Self.maximumCompletions)
      {
        state.completions.removeValue(forKey: key)
      }
    }
  }

  private func taskKey(sessionIdentifier: String, taskIdentifier: Int) -> String {
    "\(sessionIdentifier):\(taskIdentifier)"
  }
}

/// A background URLSession cannot use the async completion-handler upload API. This delegate-backed
/// bridge also survives process relaunch: task scope is saved before resume, named sessions are
/// recreated by the app lifecycle callback, and completed ETags remain available to the protected
/// upload journal.
final class BackgroundFileUploadSession: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private final class CancellationBox: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    private var task: URLSessionUploadTask?

    func install(_ task: URLSessionUploadTask) -> Bool {
      lock.withLock {
        guard !cancelled else { return false }
        self.task = task
        return true
      }
    }

    func cancel() {
      let task = lock.withLock { () -> URLSessionUploadTask? in
        cancelled = true
        return self.task
      }
      task?.cancel()
    }
  }

  private struct PendingUpload {
    static let maximumResponseBytes = 1_048_576

    var data = Data()
    let continuation: CheckedContinuation<(Data, HTTPURLResponse), any Error>
  }

  private let configuration: URLSessionConfiguration
  private let identifier: String
  private let lock = NSLock()
  private var pending: [Int: PendingUpload] = [:]
  private let recovery: BackgroundUploadRecoveryStore
  private var systemCompletionHandler: (() -> Void)?
  private lazy var session = URLSession(
    configuration: configuration,
    delegate: self,
    delegateQueue: nil
  )

  init(identifier: String, recovery: BackgroundUploadRecoveryStore) {
    self.identifier = identifier
    self.recovery = recovery
    let configuration = URLSessionConfiguration.background(withIdentifier: identifier)
    configuration.isDiscretionary = false
    configuration.sessionSendsLaunchEvents = true
    configuration.waitsForConnectivity = true
    configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    configuration.urlCache = nil
    self.configuration = configuration
    super.init()
  }

  fileprivate func activate() {
    _ = session
  }

  fileprivate func installSystemCompletionHandler(_ handler: @escaping () -> Void) {
    let displaced = lock.withLock { () -> (() -> Void)? in
      let previous = systemCompletionHandler
      systemCompletionHandler = handler
      return previous
    }
    displaced?()
    activate()
  }

  func upload(
    for request: URLRequest,
    fromFile fileURL: URL,
    context: BackgroundUploadContext?
  ) async throws -> (Data, HTTPURLResponse) {
    if let context, let recovered = recovery.completion(for: context) {
      guard let url = request.url,
        let response = HTTPURLResponse(
          url: url,
          statusCode: recovered.statusCode,
          httpVersion: "HTTP/1.1",
          headerFields: ["ETag": recovered.etag]
        )
      else { throw BackgroundUploadRecoveryError.corrupt }
      return (Data(), response)
    }

    let cancellation = CancellationBox()
    return try await withTaskCancellationHandler {
      try Task.checkCancellation()
      return try await withCheckedThrowingContinuation { continuation in
        let task = session.uploadTask(with: request, fromFile: fileURL)
        do {
          if let context {
            try recovery.register(
              sessionIdentifier: identifier,
              taskIdentifier: task.taskIdentifier,
              context: context
            )
          }
        } catch {
          task.cancel()
          continuation.resume(throwing: error)
          return
        }
        lock.withLock {
          pending[task.taskIdentifier] = PendingUpload(continuation: continuation)
        }
        guard cancellation.install(task), !Task.isCancelled else {
          cancellation.cancel()
          recovery.discard(
            sessionIdentifier: identifier,
            taskIdentifier: task.taskIdentifier
          )
          let upload = lock.withLock { pending.removeValue(forKey: task.taskIdentifier) }
          upload?.continuation.resume(throwing: CancellationError())
          return
        }
        task.resume()
      }
    } onCancel: {
      cancellation.cancel()
    }
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive data: Data
  ) {
    let exceededLimit = lock.withLock { () -> Bool in
      guard var upload = pending[dataTask.taskIdentifier] else { return false }
      guard upload.data.count <= PendingUpload.maximumResponseBytes - data.count else {
        return true
      }
      upload.data.append(data)
      pending[dataTask.taskIdentifier] = upload
      return false
    }
    if exceededLimit { dataTask.cancel() }
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: (any Error)?
  ) {
    let response = error == nil ? task.response as? HTTPURLResponse : nil
    recovery.recordCompletion(
      sessionIdentifier: identifier,
      taskIdentifier: task.taskIdentifier,
      response: response
    )
    guard let upload = lock.withLock({ pending.removeValue(forKey: task.taskIdentifier) }) else {
      return
    }
    if let error {
      upload.continuation.resume(throwing: error)
      return
    }
    guard let response else {
      upload.continuation.resume(throwing: BackgroundUploadRecoveryError.corrupt)
      return
    }
    upload.continuation.resume(returning: (upload.data, response))
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    let handler = lock.withLock { () -> (() -> Void)? in
      let value = systemCompletionHandler
      systemCompletionHandler = nil
      return value
    }
    handler?()
  }
}

final class BackgroundFileUploadCoordinator: @unchecked Sendable {
  static let captureIdentifier = "com.homedesignstudio.capture.c7-artifact-parts"
  static let evidenceIdentifier = "com.homedesignstudio.capture.c2-parts"
  static let shared = BackgroundFileUploadCoordinator()

  private let allowedRelaunchIdentifiers: Set<String>
  private let lock = NSLock()
  private let recovery: BackgroundUploadRecoveryStore
  private var sessions: [String: BackgroundFileUploadSession] = [:]

  private init() {
    allowedRelaunchIdentifiers = [Self.captureIdentifier, Self.evidenceIdentifier]
    recovery = BackgroundUploadRecoveryStore()
  }

  func handleEvents(for identifier: String, completionHandler: @escaping () -> Void) {
    guard allowedRelaunchIdentifiers.contains(identifier) else {
      completionHandler()
      return
    }
    uploader(identifier: identifier).installSystemCompletionHandler(completionHandler)
  }

  func uploader(identifier: String) -> BackgroundFileUploadSession {
    lock.withLock {
      if let existing = sessions[identifier] { return existing }
      let created = BackgroundFileUploadSession(identifier: identifier, recovery: recovery)
      sessions[identifier] = created
      return created
    }
  }
}
