import Foundation

enum C14_10FaultCheckpoint: String, CaseIterable, Codable, Equatable, Sendable {
  case beforeEnvelopeAcceptance
  case beforeKeyframeRetention
  case beforeSubmission
  case beforeUpload
  case afterUploadReceipt
}

enum C14_10InjectedFault: String, Codable, Error, Equatable, Sendable {
  case authenticationExpired
  case captureAuthorityExpired
  case offline
  case projectChanged
  case protectedStoragePressure
  case roleChanged
  case rightsWithdrawn
  case serviceUnavailable
  case signedURLExpired
}

protocol C14_10FaultInjecting: Sendable {
  func checkpoint(_ checkpoint: C14_10FaultCheckpoint) async throws
}

struct C14_10NoFaultInjector: C14_10FaultInjecting {
  func checkpoint(_ checkpoint: C14_10FaultCheckpoint) async throws {
    _ = checkpoint
  }
}

#if DEBUG
  actor C14_10ScriptedFaultInjector: C14_10FaultInjecting {
    private var script: [C14_10FaultCheckpoint: [C14_10InjectedFault]]
    private(set) var visited: [C14_10FaultCheckpoint] = []

    init(script: [C14_10FaultCheckpoint: [C14_10InjectedFault]]) {
      self.script = script
    }

    func checkpoint(_ checkpoint: C14_10FaultCheckpoint) async throws {
      visited.append(checkpoint)
      guard var faults = script[checkpoint], !faults.isEmpty else { return }
      let fault = faults.removeFirst()
      script[checkpoint] = faults
      throw fault
    }
  }
#endif
