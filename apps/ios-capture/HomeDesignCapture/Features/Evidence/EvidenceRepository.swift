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
  @ObservationIgnored private var operationGeneration = 0
  @ObservationIgnored private var uploadTask: Task<Void, Never>?
  private var projectId: String?

  init(
    service: any EvidenceServing,
    recoveryStore: any EvidenceRecoveryStoring = EvidenceRecoveryStore()
  ) {
    self.service = service
    self.recoveryStore = recoveryStore
  }

  func reset() {
    uploadTask?.cancel()
    uploadTask = nil
    operationGeneration &+= 1
    projectId = nil
    inventoryState = .idle
    transferState = .idle
    selection = nil
    lastAccess = nil
    kind = .plan
    rightsBasis = .ownedByUser
    serviceProcessingConsent = false
    trainingUseConsent = .denied
    attribution = ""
    licenceURL = ""
  }

  func activate(projectId: String) async {
    guard UUID(uuidString: projectId) != nil else {
      reset()
      inventoryState = .failure("The selected project identifier is invalid.")
      return
    }
    uploadTask?.cancel()
    uploadTask = nil
    operationGeneration &+= 1
    let generation = operationGeneration
    if self.projectId != projectId {
      transferState = .idle
      selection = nil
      lastAccess = nil
    }
    self.projectId = projectId
    await loadInventory(projectId: projectId, generation: generation)
    guard isCurrent(projectId: projectId, generation: generation) else { return }
    do {
      if let recovery = try await recoveryStore.load(projectId: projectId) {
        guard isCurrent(projectId: projectId, generation: generation) else { return }
        transferState = .paused(recovery)
      }
    } catch {
      guard isCurrent(projectId: projectId, generation: generation) else { return }
      transferState = .failed("Saved upload recovery could not be read.", recovery: nil)
    }
  }

  func loadInventory() async {
    guard let projectId else { return }
    await loadInventory(projectId: projectId, generation: operationGeneration)
  }

  private func loadInventory(projectId: String, generation: Int) async {
    guard isCurrent(projectId: projectId, generation: generation) else { return }
    inventoryState = .loading
    do {
      let assets = try await service.list(projectId: projectId)
      guard isCurrent(projectId: projectId, generation: generation) else { return }
      guard assets.count <= 10_000, assets.allSatisfy({ $0.isValid(for: projectId) }) else {
        inventoryState = .failure(message(for: .invalidResponse))
        return
      }
      inventoryState = .loaded(assets)
    } catch let error as EvidenceServiceError {
      guard isCurrent(projectId: projectId, generation: generation) else { return }
      switch error {
      case .offline: inventoryState = .offline
      case .expired: inventoryState = .expired
      case .forbidden: inventoryState = .forbidden
      default: inventoryState = .failure(message(for: error))
      }
    } catch {
      guard isCurrent(projectId: projectId, generation: generation) else { return }
      inventoryState = .failure("Evidence could not be loaded.")
    }
  }

  func selectFile(_ sourceURL: URL) async {
    guard let projectId else {
      transferState = .failed("Select an authorised project before adding evidence.", recovery: nil)
      return
    }
    let generation = operationGeneration
    let selectedKind = kind
    var stagedURL: URL?
    do {
      guard let mimeType = EvidenceFileSupport.mimeType(for: sourceURL) else {
        throw EvidenceServiceError.unsupported("The selected file type is unsupported.")
      }
      let staged = try await recoveryStore.stage(sourceURL: sourceURL)
      stagedURL = staged
      guard isCurrent(projectId: projectId, generation: generation) else {
        try? FileManager.default.removeItem(at: staged)
        return
      }
      let values = try staged.resourceValues(forKeys: [.fileSizeKey])
      let size = Int64(values.fileSize ?? 0)
      try EvidenceFileSupport.validate(
        fileName: sourceURL.lastPathComponent,
        size: size,
        mimeType: mimeType,
        kind: selectedKind
      )
      selection = EvidenceSelection(
        fileName: sourceURL.lastPathComponent,
        fileURL: staged,
        kind: selectedKind,
        mimeType: mimeType,
        size: size
      )
      transferState = .idle
    } catch let error as EvidenceServiceError {
      guard isCurrent(projectId: projectId, generation: generation) else {
        if let stagedURL { try? FileManager.default.removeItem(at: stagedURL) }
        return
      }
      transferState = .failed(message(for: error), recovery: nil)
    } catch {
      guard isCurrent(projectId: projectId, generation: generation) else {
        if let stagedURL { try? FileManager.default.removeItem(at: stagedURL) }
        return
      }
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
    let generation = operationGeneration
    let rights = rightsAssertion()
    uploadTask?.cancel()
    uploadTask = Task { [weak self] in
      guard let self else { return }
      do {
        guard isCurrent(projectId: projectId, generation: generation) else { return }
        transferState = .hashing(progress: 0)
        let sha256 = try await EvidenceFileSupport.hash(fileURL: selection.fileURL) { progress in
          await MainActor.run {
            guard self.isCurrent(projectId: projectId, generation: generation) else { return }
            self.transferState = .hashing(progress: progress)
          }
        }
        try Task.checkCancellation()
        let session = try await service.createSession(
          projectId: projectId,
          selection: selection,
          sha256: sha256,
          rights: rights,
          idempotencyKey: UUID().uuidString
        )
        guard isCurrent(projectId: projectId, generation: generation) else {
          try? await service.abort(
            projectId: projectId,
            sessionId: session.sessionId,
            idempotencyKey: "abort-\(session.sessionId)"
          )
          return
        }
        guard session.asset.isValid(for: projectId) else {
          throw EvidenceServiceError.invalidResponse
        }
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
        try await runUpload(recovery, generation: generation)
      } catch is CancellationError {
        guard isCurrent(projectId: projectId, generation: generation) else { return }
        if let recovery = try? await recoveryStore.load(projectId: projectId) {
          guard isCurrent(projectId: projectId, generation: generation) else { return }
          transferState = .paused(recovery)
        } else {
          transferState = .idle
        }
      } catch let error as EvidenceServiceError {
        guard isCurrent(projectId: projectId, generation: generation) else { return }
        let recovery = try? await recoveryStore.load(projectId: projectId)
        guard isCurrent(projectId: projectId, generation: generation) else { return }
        transferState = .failed(message(for: error), recovery: recovery ?? nil)
      } catch {
        guard isCurrent(projectId: projectId, generation: generation) else { return }
        let recovery = try? await recoveryStore.load(projectId: projectId)
        guard isCurrent(projectId: projectId, generation: generation) else { return }
        transferState = .failed("The upload could not continue. Retry resumes recorded parts.", recovery: recovery ?? nil)
      }
    }
  }

  func pause() {
    uploadTask?.cancel()
  }

  func resume(_ recovery: EvidenceRecoveryRecord) {
    guard let projectId, recovery.projectId == projectId else {
      transferState = .failed("The saved upload belongs to a different project and was not resumed.", recovery: nil)
      return
    }
    let generation = operationGeneration
    uploadTask?.cancel()
    uploadTask = Task { [weak self] in
      guard let self else { return }
      var activeRecovery = recovery
      do {
        let session = try await service.session(projectId: recovery.projectId, sessionId: recovery.sessionId)
        guard isCurrent(projectId: projectId, generation: generation) else { return }
        guard session.asset.isValid(for: projectId) else {
          throw EvidenceServiceError.invalidResponse
        }
        activeRecovery = EvidenceResumeReconciler.reconcile(
          recovery,
          recordedPartNumbers: session.recordedPartNumbers
        )
        try await recoveryStore.save(activeRecovery)
        switch session.state {
        case .aborted, .expired:
          try await recoveryStore.clear(projectId: recovery.projectId)
          guard isCurrent(projectId: projectId, generation: generation) else { return }
          transferState = .failed("The saved session is \(session.state.rawValue). Select the file again.", recovery: nil)
        case .completed:
          try await recoveryStore.clear(projectId: recovery.projectId)
          guard isCurrent(projectId: projectId, generation: generation) else { return }
          transferState = .completed
          await loadInventory(projectId: projectId, generation: generation)
        case .initiated, .uploading:
          try await runUpload(activeRecovery, generation: generation)
        }
      } catch is CancellationError {
        guard isCurrent(projectId: projectId, generation: generation) else { return }
        transferState = .paused(activeRecovery)
      } catch let error as EvidenceServiceError {
        guard isCurrent(projectId: projectId, generation: generation) else { return }
        transferState = .failed(message(for: error), recovery: activeRecovery)
      } catch {
        guard isCurrent(projectId: projectId, generation: generation) else { return }
        transferState = .failed("The saved upload could not be reconciled.", recovery: activeRecovery)
      }
    }
  }

  func cancel(_ recovery: EvidenceRecoveryRecord?) async {
    guard let projectId else { return }
    let generation = operationGeneration
    uploadTask?.cancel()
    if let recovery, recovery.projectId == projectId {
      try? await service.abort(
        projectId: recovery.projectId,
        sessionId: recovery.sessionId,
        idempotencyKey: "abort-\(recovery.sessionId)"
      )
      try? await recoveryStore.clear(projectId: recovery.projectId)
    }
    guard isCurrent(projectId: projectId, generation: generation) else { return }
    transferState = .idle
    await loadInventory(projectId: projectId, generation: generation)
  }

  func requestPreview(asset: EvidenceAsset) async {
    guard asset.status == .ready, let projectId, asset.isValid(for: projectId) else { return }
    let generation = operationGeneration
    do {
      let access = try await service.access(
        projectId: projectId,
        assetId: asset.id,
        representation: "preview"
      )
      guard isCurrent(projectId: projectId, generation: generation) else { return }
      lastAccess = access
    } catch let error as EvidenceServiceError {
      guard isCurrent(projectId: projectId, generation: generation) else { return }
      inventoryState = .failure(message(for: error))
    } catch {
      guard isCurrent(projectId: projectId, generation: generation) else { return }
      inventoryState = .failure("Short-lived preview access could not be issued.")
    }
  }

  private func runUpload(_ initialRecovery: EvidenceRecoveryRecord, generation: Int) async throws {
    var recovery = initialRecovery
    guard isCurrent(projectId: recovery.projectId, generation: generation) else {
      throw CancellationError()
    }
    let totalParts = Int(ceil(Double(fileSize(recovery.fileURL)) / Double(recovery.partSize)))
    var completed = Set(recovery.completedParts.map(\.partNumber))
    for partNumber in 1...max(totalParts, 1) where !completed.contains(partNumber) {
      try Task.checkCancellation()
      guard isCurrent(projectId: recovery.projectId, generation: generation) else {
        throw CancellationError()
      }
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
      var etag: String?
      for signingGeneration in 0...2 where etag == nil {
        let signed = try await service.signPart(
          projectId: recovery.projectId,
          sessionId: recovery.sessionId,
          partNumber: partNumber,
          byteSize: length,
          checksumSha256: checksum,
          idempotencyKey:
            "part-\(recovery.sessionId)-\(partNumber)-\(checksumKey.prefix(12))-\(signingGeneration)"
        )
        guard isCurrent(projectId: recovery.projectId, generation: generation) else {
          throw CancellationError()
        }
        guard signed.requiredHeaders.contains(where: {
          $0.key.lowercased().contains("checksum-sha256") && $0.value == checksum
        }) else {
          throw EvidenceServiceError.checksumBindingMissing
        }
        do {
          etag = try await service.uploadPart(fileURL: partURL, signedPart: signed)
        } catch EvidenceServiceError.signedURLExpired where signingGeneration < 2 {
          continue
        }
      }
      guard let etag else { throw EvidenceServiceError.signedURLExpired }
      guard isCurrent(projectId: recovery.projectId, generation: generation) else {
        throw CancellationError()
      }
      recovery.completedParts.append(
        CompletedEvidencePart(checksumSha256: checksum, etag: etag, partNumber: partNumber)
      )
      recovery.completedParts.sort { $0.partNumber < $1.partNumber }
      recovery.updatedAt = Date()
      completed.insert(partNumber)
      try await recoveryStore.save(recovery)
      transferState = .uploading(progress: Double(completed.count) / Double(max(totalParts, 1)))
    }
    guard isCurrent(projectId: recovery.projectId, generation: generation) else {
      throw CancellationError()
    }
    transferState = .completing
    let asset = try await service.complete(
      projectId: recovery.projectId,
      sessionId: recovery.sessionId,
      sha256: recovery.sha256,
      parts: recovery.completedParts,
      idempotencyKey: recovery.completionKey
    )
    guard isCurrent(projectId: recovery.projectId, generation: generation),
          asset.isValid(for: recovery.projectId)
    else { throw EvidenceServiceError.invalidResponse }
    try await recoveryStore.clear(projectId: recovery.projectId)
    transferState = .completed
    selection = nil
    await loadInventory(projectId: recovery.projectId, generation: generation)
  }

  private func isCurrent(projectId: String, generation: Int) -> Bool {
    self.projectId == projectId && operationGeneration == generation
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
