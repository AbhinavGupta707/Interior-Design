import Foundation
import Observation

protocol EvidenceRecoveryStoring: Sendable {
  func clear(projectId: String) async throws
  func load(projectId: String) async throws -> EvidenceRecoveryRecord?
  func save(_ record: EvidenceRecoveryRecord) async throws
  func stage(sourceURL: URL) async throws -> URL
  func partFile(sourceURL: URL, offset: UInt64, length: Int, partNumber: Int) async throws -> URL
}

actor EvidenceRecoveryStore: EvidenceRecoveryStoring {
  private let root: URL

  init(root: URL? = nil) {
    if let root {
      self.root = root
    } else {
      self.root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("C2Evidence", isDirectory: true)
    }
  }

  func stage(sourceURL: URL) throws -> URL {
    let directory = root.appendingPathComponent("files", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let destination = directory.appendingPathComponent(UUID().uuidString)
    let accessed = sourceURL.startAccessingSecurityScopedResource()
    defer { if accessed { sourceURL.stopAccessingSecurityScopedResource() } }
    try FileManager.default.copyItem(at: sourceURL, to: destination)
    return destination
  }

  func partFile(sourceURL: URL, offset: UInt64, length: Int, partNumber: Int) throws -> URL {
    let directory = root.appendingPathComponent("parts", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let destination = directory.appendingPathComponent("\(sourceURL.deletingPathExtension().lastPathComponent)-part-\(partNumber)")
    FileManager.default.createFile(atPath: destination.path, contents: nil)
    let source = try FileHandle(forReadingFrom: sourceURL)
    let target = try FileHandle(forWritingTo: destination)
    defer {
      try? source.close()
      try? target.close()
    }
    try source.seek(toOffset: offset)
    let data = try source.read(upToCount: length) ?? Data()
    try target.write(contentsOf: data)
    return destination
  }

  func save(_ record: EvidenceRecoveryRecord) throws {
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let data = try JSONEncoder().encode(record)
    try data.write(to: recordURL(projectId: record.projectId), options: .atomic)
  }

  func load(projectId: String) throws -> EvidenceRecoveryRecord? {
    let url = recordURL(projectId: projectId)
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    return try JSONDecoder().decode(EvidenceRecoveryRecord.self, from: Data(contentsOf: url))
  }

  func clear(projectId: String) throws {
    let url = recordURL(projectId: projectId)
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
  }

  private func recordURL(projectId: String) -> URL {
    root.appendingPathComponent("recovery-\(projectId).json")
  }
}

@MainActor
@Observable
final class EvidenceRepository {
  private(set) var inventoryState: EvidenceInventoryState = .idle
  private(set) var transferState: EvidenceTransferState = .idle
  private(set) var selection: EvidenceSelection?
  private(set) var lastAccess: EvidenceAccess?

  var kind: EvidenceKind = .plan
  var rightsBasis: EvidenceRightsBasis = .ownedByUser
  var serviceProcessingConsent = false
  var trainingUseConsent: TrainingUseConsent = .denied
  var attribution = ""
  var licenceURL = ""

  @ObservationIgnored private let service: any EvidenceServing
  @ObservationIgnored private let recoveryStore: any EvidenceRecoveryStoring
  @ObservationIgnored private var uploadTask: Task<Void, Never>?
  private var projectId: String?

  init(
    service: any EvidenceServing,
    recoveryStore: any EvidenceRecoveryStoring = EvidenceRecoveryStore()
  ) {
    self.service = service
    self.recoveryStore = recoveryStore
  }

  func activate(projectId: String) async {
    self.projectId = projectId
    await loadInventory()
    do {
      if let recovery = try await recoveryStore.load(projectId: projectId) {
        transferState = .paused(recovery)
      }
    } catch {
      transferState = .failed("Saved upload recovery could not be read.", recovery: nil)
    }
  }

  func loadInventory() async {
    guard let projectId else { return }
    inventoryState = .loading
    do {
      inventoryState = .loaded(try await service.list(projectId: projectId))
    } catch let error as EvidenceServiceError {
      switch error {
      case .offline: inventoryState = .offline
      case .expired: inventoryState = .expired
      case .forbidden: inventoryState = .forbidden
      default: inventoryState = .failure(message(for: error))
      }
    } catch {
      inventoryState = .failure("Evidence could not be loaded.")
    }
  }

  func selectFile(_ sourceURL: URL) async {
    do {
      guard let mimeType = EvidenceFileSupport.mimeType(for: sourceURL) else {
        throw EvidenceServiceError.unsupported("The selected file type is unsupported.")
      }
      let stagedURL = try await recoveryStore.stage(sourceURL: sourceURL)
      let values = try stagedURL.resourceValues(forKeys: [.fileSizeKey])
      let size = Int64(values.fileSize ?? 0)
      try EvidenceFileSupport.validate(
        fileName: sourceURL.lastPathComponent,
        size: size,
        mimeType: mimeType,
        kind: kind
      )
      selection = EvidenceSelection(
        fileName: sourceURL.lastPathComponent,
        fileURL: stagedURL,
        kind: kind,
        mimeType: mimeType,
        size: size
      )
      transferState = .idle
    } catch let error as EvidenceServiceError {
      transferState = .failed(message(for: error), recovery: nil)
    } catch {
      transferState = .failed("The selected file could not be staged for upload.", recovery: nil)
    }
  }

  func startUpload() {
    guard let projectId, let selection else {
      transferState = .failed("Select a supported file before uploading.", recovery: nil)
      return
    }
    guard serviceProcessingConsent else {
      transferState = .failed("Confirm service processing before uploading.", recovery: nil)
      return
    }
    uploadTask?.cancel()
    uploadTask = Task { [weak self] in
      guard let self else { return }
      do {
        transferState = .hashing(progress: 0)
        let sha256 = try await EvidenceFileSupport.hash(fileURL: selection.fileURL) { progress in
          await MainActor.run { self.transferState = .hashing(progress: progress) }
        }
        try Task.checkCancellation()
        let session = try await service.createSession(
          projectId: projectId,
          selection: selection,
          sha256: sha256,
          rights: rightsAssertion(),
          idempotencyKey: UUID().uuidString
        )
        let recovery = EvidenceRecoveryRecord(
          assetId: session.asset.id,
          completedParts: [],
          completionKey: UUID().uuidString,
          fileName: selection.fileName,
          fileURL: selection.fileURL,
          kind: selection.kind,
          partSize: session.partSize,
          projectId: projectId,
          sessionId: session.sessionId,
          sha256: sha256,
          updatedAt: Date()
        )
        try await recoveryStore.save(recovery)
        try await runUpload(recovery)
      } catch is CancellationError {
        if let recovery = try? await recoveryStore.load(projectId: projectId) {
          transferState = .paused(recovery)
        } else {
          transferState = .idle
        }
      } catch let error as EvidenceServiceError {
        let recovery = try? await recoveryStore.load(projectId: projectId)
        transferState = .failed(message(for: error), recovery: recovery ?? nil)
      } catch {
        let recovery = try? await recoveryStore.load(projectId: projectId)
        transferState = .failed("The upload could not continue. Retry resumes recorded parts.", recovery: recovery ?? nil)
      }
    }
  }

  func pause() {
    uploadTask?.cancel()
  }

  func resume(_ recovery: EvidenceRecoveryRecord) {
    uploadTask?.cancel()
    uploadTask = Task { [weak self] in
      guard let self else { return }
      var activeRecovery = recovery
      do {
        let session = try await service.session(projectId: recovery.projectId, sessionId: recovery.sessionId)
        activeRecovery = EvidenceResumeReconciler.reconcile(
          recovery,
          recordedPartNumbers: session.recordedPartNumbers
        )
        try await recoveryStore.save(activeRecovery)
        switch session.state {
        case .aborted, .expired:
          try await recoveryStore.clear(projectId: recovery.projectId)
          transferState = .failed("The saved session is \(session.state.rawValue). Select the file again.", recovery: nil)
        case .completed:
          try await recoveryStore.clear(projectId: recovery.projectId)
          transferState = .completed
          await loadInventory()
        case .initiated, .uploading:
          try await runUpload(activeRecovery)
        }
      } catch is CancellationError {
        transferState = .paused(activeRecovery)
      } catch let error as EvidenceServiceError {
        transferState = .failed(message(for: error), recovery: activeRecovery)
      } catch {
        transferState = .failed("The saved upload could not be reconciled.", recovery: activeRecovery)
      }
    }
  }

  func cancel(_ recovery: EvidenceRecoveryRecord?) async {
    uploadTask?.cancel()
    if let recovery {
      try? await service.abort(
        projectId: recovery.projectId,
        sessionId: recovery.sessionId,
        idempotencyKey: "abort-\(recovery.sessionId)"
      )
      try? await recoveryStore.clear(projectId: recovery.projectId)
    }
    transferState = .idle
    await loadInventory()
  }

  func requestPreview(asset: EvidenceAsset) async {
    guard asset.status == .ready, let projectId else { return }
    do {
      lastAccess = try await service.access(
        projectId: projectId,
        assetId: asset.id,
        representation: "preview"
      )
    } catch let error as EvidenceServiceError {
      inventoryState = .failure(message(for: error))
    } catch {
      inventoryState = .failure("Short-lived preview access could not be issued.")
    }
  }

  private func runUpload(_ initialRecovery: EvidenceRecoveryRecord) async throws {
    var recovery = initialRecovery
    let totalParts = Int(ceil(Double(fileSize(recovery.fileURL)) / Double(recovery.partSize)))
    var completed = Set(recovery.completedParts.map(\.partNumber))
    for partNumber in 1...max(totalParts, 1) where !completed.contains(partNumber) {
      try Task.checkCancellation()
      let offset = UInt64((partNumber - 1) * recovery.partSize)
      let length = min(recovery.partSize, max(0, fileSize(recovery.fileURL) - Int(offset)))
      let partURL = try await recoveryStore.partFile(
        sourceURL: recovery.fileURL,
        offset: offset,
        length: length,
        partNumber: partNumber
      )
      defer { try? FileManager.default.removeItem(at: partURL) }
      let checksum = try EvidenceFileSupport.checksumBase64(fileURL: partURL)
      let checksumKey = checksum.filter { character in
        character.isASCII && (character.isLetter || character.isNumber)
      }
      let signed = try await service.signPart(
        projectId: recovery.projectId,
        sessionId: recovery.sessionId,
        partNumber: partNumber,
        byteSize: length,
        checksumSha256: checksum,
        idempotencyKey: "part-\(recovery.sessionId)-\(partNumber)-\(checksumKey.prefix(12))"
      )
      guard signed.requiredHeaders.contains(where: {
        $0.key.lowercased().contains("checksum-sha256") && $0.value == checksum
      }) else {
        throw EvidenceServiceError.checksumBindingMissing
      }
      let etag = try await service.uploadPart(fileURL: partURL, signedPart: signed)
      recovery.completedParts.append(
        CompletedEvidencePart(checksumSha256: checksum, etag: etag, partNumber: partNumber)
      )
      recovery.completedParts.sort { $0.partNumber < $1.partNumber }
      recovery.updatedAt = Date()
      completed.insert(partNumber)
      try await recoveryStore.save(recovery)
      transferState = .uploading(progress: Double(completed.count) / Double(max(totalParts, 1)))
    }
    transferState = .completing
    _ = try await service.complete(
      projectId: recovery.projectId,
      sessionId: recovery.sessionId,
      sha256: recovery.sha256,
      parts: recovery.completedParts,
      idempotencyKey: recovery.completionKey
    )
    try await recoveryStore.clear(projectId: recovery.projectId)
    transferState = .completed
    selection = nil
    await loadInventory()
  }

  private func rightsAssertion() -> EvidenceRightsAssertion {
    EvidenceRightsAssertion(
      attribution: attribution.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
      basis: rightsBasis,
      licenceUrl: licenceURL.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
      serviceProcessingConsent: serviceProcessingConsent,
      trainingUseConsent: trainingUseConsent
    )
  }

  private func fileSize(_ url: URL) -> Int {
    (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
  }

  private func message(for error: EvidenceServiceError) -> String {
    switch error {
    case .checksumBindingMissing:
      "The signed upload was not bound to the requested checksum. Nothing was transferred."
    case .expired:
      "The fixture session expired. Sign in again; saved upload metadata remains local."
    case .forbidden:
      "Evidence is unavailable for this project or role. Other projects are not disclosed."
    case .invalidResponse:
      "The evidence service response did not match c2-ingest-v1."
    case .offline:
      "You’re offline. Reconnect and resume; recorded parts are not repeated."
    case .signedURLExpired:
      "The short-lived part URL expired. Retry to request a fresh URL."
    case .unsupported(let message):
      message
    case .unavailable:
      "The evidence service is unavailable. Retry when it is ready."
    }
  }
}

private extension String {
  var nilIfEmpty: String? { isEmpty ? nil : self }
}
