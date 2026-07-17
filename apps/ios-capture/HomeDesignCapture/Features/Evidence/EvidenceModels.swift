import Foundation

enum EvidenceKind: String, CaseIterable, Codable, Identifiable, Sendable {
  case plan
  case photograph
  case video
  case document

  var id: String { rawValue }

  var title: String {
    switch self {
    case .plan: "Plan"
    case .photograph: "Photograph"
    case .video: "Video"
    case .document: "Document"
    }
  }

  var allowedMIMETypes: Set<String> {
    switch self {
    case .plan: ["application/pdf", "image/jpeg", "image/png", "image/svg+xml"]
    case .photograph: ["image/jpeg", "image/png", "image/heic", "image/heif"]
    case .video: ["video/mp4", "video/quicktime"]
    case .document: ["application/pdf"]
    }
  }
}

enum EvidenceStatus: String, Codable, Sendable {
  case pendingUpload = "pending-upload"
  case uploading
  case uploaded
  case processing
  case ready
  case quarantined
  case rejected
  case aborted

  var title: String {
    switch self {
    case .pendingUpload: "Pending"
    case .uploading: "Uploading"
    case .uploaded: "Uploaded"
    case .processing: "Processing"
    case .ready: "Ready"
    case .quarantined: "Quarantined"
    case .rejected: "Rejected"
    case .aborted: "Aborted"
    }
  }
}

enum EvidenceRejectionCode: String, Codable, Sendable {
  case unsupportedType = "unsupported-type"
  case signatureMismatch = "signature-mismatch"
  case resourceLimit = "resource-limit"
  case malformedMedia = "malformed-media"
  case checksumMismatch = "checksum-mismatch"
  case malwareSuspected = "malware-suspected"
  case processingFailed = "processing-failed"
}

enum EvidenceRightsBasis: String, CaseIterable, Codable, Identifiable, Sendable {
  case ownedByUser = "owned-by-user"
  case permissionGranted = "permission-granted"
  case publicDomain = "public-domain"
  case licensed

  var id: String { rawValue }

  var title: String {
    switch self {
    case .ownedByUser: "I own this file"
    case .permissionGranted: "I have permission"
    case .publicDomain: "Public domain"
    case .licensed: "Licensed for this use"
    }
  }
}

enum TrainingUseConsent: String, Codable, Sendable {
  case denied
  case granted
}

struct EvidenceRightsAssertion: Codable, Equatable, Sendable {
  let attribution: String?
  let basis: EvidenceRightsBasis
  let licenceUrl: String?
  let serviceProcessingConsent: Bool
  let trainingUseConsent: TrainingUseConsent
}

struct EvidenceSourceFingerprint: Codable, Equatable, Sendable {
  let byteSize: Int64
  let sha256: String
}

struct EvidenceAsset: Codable, Equatable, Identifiable, Sendable {
  let createdAt: String
  let declaredMimeType: String
  let detectedMimeType: String?
  let fileName: String
  let id: String
  let kind: EvidenceKind
  let projectId: String
  let rejectionCode: EvidenceRejectionCode?
  let rights: EvidenceRightsAssertion
  let source: EvidenceSourceFingerprint
  let status: EvidenceStatus
  let updatedAt: String
}

enum EvidenceUploadSessionState: String, Codable, Sendable {
  case initiated
  case uploading
  case completed
  case aborted
  case expired
}

struct EvidenceUploadSession: Codable, Equatable, Sendable {
  let asset: EvidenceAsset
  let expiresAt: String
  let maximumPartCount: Int
  let minimumNonFinalPartSize: Int
  let partSize: Int
  let recordedPartNumbers: [Int]
  let sessionId: String
  let state: EvidenceUploadSessionState
}

struct CompletedEvidencePart: Codable, Equatable, Sendable {
  let checksumSha256: String
  let etag: String
  let partNumber: Int
}

struct SignedEvidencePart: Codable, Equatable, Sendable {
  let expiresAt: String
  let partNumber: Int
  let requiredHeaders: [String: String]
  let url: URL
}

struct EvidenceAccess: Codable, Equatable, Sendable {
  let contentDisposition: String
  let expiresAt: String
  let url: URL
}

struct EvidenceSelection: Equatable, Sendable {
  let fileName: String
  let fileURL: URL
  let kind: EvidenceKind
  let mimeType: String
  let size: Int64
}

struct EvidenceRecoveryRecord: Codable, Equatable, Sendable {
  let assetId: String
  var completedParts: [CompletedEvidencePart]
  let completionKey: String
  let fileName: String
  let fileURL: URL
  let kind: EvidenceKind
  let partSize: Int
  let projectId: String
  let sessionId: String
  let sha256: String
  var updatedAt: Date
}

enum EvidenceInventoryState: Equatable, Sendable {
  case idle
  case loading
  case loaded([EvidenceAsset])
  case offline
  case expired
  case forbidden
  case failure(String)
}

enum EvidenceTransferState: Equatable, Sendable {
  case idle
  case hashing(progress: Double)
  case uploading(progress: Double)
  case paused(EvidenceRecoveryRecord)
  case completing
  case failed(String, recovery: EvidenceRecoveryRecord?)
  case completed
}

enum EvidenceServiceError: Error, Equatable, Sendable {
  case checksumBindingMissing
  case expired
  case forbidden
  case invalidResponse
  case offline
  case signedURLExpired
  case unsupported(String)
  case unavailable
}

enum EvidenceResumeReconciler {
  static func reconcile(
    _ record: EvidenceRecoveryRecord,
    recordedPartNumbers: [Int]
  ) -> EvidenceRecoveryRecord {
    let serverParts = Set(recordedPartNumbers.sorted())
    var reconciled = record
    reconciled.completedParts = record.completedParts
      .filter { serverParts.contains($0.partNumber) }
      .sorted { $0.partNumber < $1.partNumber }
    reconciled.updatedAt = Date()
    return reconciled
  }
}
