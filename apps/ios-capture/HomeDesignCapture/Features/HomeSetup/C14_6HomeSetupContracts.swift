import Foundation

enum C14_6DwellingType: String, CaseIterable, Codable, Identifiable, Sendable {
  case flat
  case terracedHouse = "terraced-house"
  case semiDetachedHouse = "semi-detached-house"
  case detachedHouse = "detached-house"
  case bungalow
  case other

  var id: String { rawValue }
  var title: String {
    switch self {
    case .flat: "Flat"
    case .terracedHouse: "Terraced house"
    case .semiDetachedHouse: "Semi-detached house"
    case .detachedHouse: "Detached house"
    case .bungalow: "Bungalow"
    case .other: "Other"
    }
  }
}

struct C14_6EvidenceAvailable: Codable, Equatable, Sendable {
  var photographs: Bool
  var plans: Bool
  var roomCapture: Bool
  var video: Bool
}

struct C14_6Household: Codable, Equatable, Sendable {
  var adults: Int
  var children: Int
  var pets: Int
}

struct C14_6HomeIntake: Codable, Equatable, Sendable {
  var accessibilityNeeds: [String]
  var addressSummary: String?
  var bathrooms: Int?
  var bedrooms: Int?
  var dwellingType: C14_6DwellingType
  var evidenceAvailable: C14_6EvidenceAvailable
  var goals: [String]
  var household: C14_6Household
  var levels: Int?
  var mustChange: [String]
  var mustKeep: [String]
  var notes: String?
  var styleWords: [String]

  static let empty = C14_6HomeIntake(
    accessibilityNeeds: [],
    addressSummary: nil,
    bathrooms: nil,
    bedrooms: nil,
    dwellingType: .flat,
    evidenceAvailable: C14_6EvidenceAvailable(
      photographs: false,
      plans: false,
      roomCapture: false,
      video: false
    ),
    goals: [],
    household: C14_6Household(adults: 1, children: 0, pets: 0),
    levels: nil,
    mustChange: [],
    mustKeep: [],
    notes: nil,
    styleWords: []
  )

  var isValid: Bool {
    !goals.isEmpty
      && goals.count <= 12
      && [accessibilityNeeds, goals, mustChange, mustKeep, styleWords].allSatisfy { list in
        list.count <= 12
          && list.allSatisfy { C14_6ContractValidation.boundedNonBlank($0, maximum: 120) }
      }
      && (0...30).contains(household.adults)
      && (0...30).contains(household.children)
      && (0...30).contains(household.pets)
      && bedrooms.map { (0...30).contains($0) } ?? true
      && bathrooms.map { (0...20).contains($0) } ?? true
      && levels.map { (1...10).contains($0) } ?? true
      && addressSummary.map {
        C14_6ContractValidation.boundedNonBlank($0, maximum: 160)
      } ?? true
      && notes.map {
        $0 == $0.trimmingCharacters(in: .whitespacesAndNewlines) && $0.count <= 2_000
      } ?? true
  }
}

struct C14_6ProjectIntake: Codable, Equatable, Sendable {
  let intake: C14_6HomeIntake
  let projectId: String
  let updatedAt: String
  let updatedBy: String
  let version: Int

  var isValid: Bool {
    UUID(uuidString: projectId) != nil
      && UUID(uuidString: updatedBy) != nil
      && version > 0
      && intake.isValid
      && C14_6ContractValidation.date(updatedAt) != nil
  }
}

struct C14_6PropertyAddress: Codable, Equatable, Sendable {
  var countryCode: String = "GB"
  var line1: String
  var line2: String?
  var locality: String?
  var postcode: String?

  var displayValue: String {
    [line1, line2, locality, postcode].compactMap { $0 }.joined(separator: ", ")
  }

  var isValid: Bool {
    countryCode == "GB"
      && C14_6ContractValidation.boundedNonBlank(line1, maximum: 120)
      && line2.map {
        C14_6ContractValidation.boundedNonBlank($0, maximum: 120)
      } ?? true
      && locality.map {
        C14_6ContractValidation.boundedNonBlank($0, maximum: 120)
      } ?? true
      && postcode.map {
        $0 == $0.trimmingCharacters(in: .whitespacesAndNewlines)
          && (2...16).contains($0.count)
      } ?? true
  }
}

struct C14_6PropertyIdentifier: Codable, Equatable, Sendable {
  let scheme: String
  let value: String
}

struct C14_6PropertyLocation: Codable, Equatable, Sendable {
  let coordinates: [Double]
  let crs: String

  var isValid: Bool {
    guard coordinates.count == 2 else { return false }
    if crs == "EPSG:27700" { return coordinates.allSatisfy(\.isFinite) }
    if crs == "EPSG:4326" {
      return (-180...180).contains(coordinates[0]) && (-90...90).contains(coordinates[1])
    }
    return false
  }
}

struct C14_6PropertyLicence: Codable, Equatable, Sendable {
  let id: String
  let title: String
  let url: String?
}

struct C14_6PropertySource: Codable, Equatable, Sendable {
  let coverage: String
  let dataset: String
  let datasetVersion: String
  let licence: C14_6PropertyLicence
  let modelTrainingAllowed: Bool
  let participantSharingAllowed: Bool
  let providerId: String
  let retrievedAt: String
  let serviceProcessingAllowed: Bool

  var isValid: Bool {
    ["fixture-complete", "partial", "unknown"].contains(coverage)
      && C14_6ContractValidation.boundedNonBlank(dataset, maximum: 120)
      && C14_6ContractValidation.boundedNonBlank(datasetVersion, maximum: 120)
      && !modelTrainingAllowed
      && serviceProcessingAllowed
      && providerId.range(of: "^[a-z0-9][a-z0-9-]{0,79}$", options: .regularExpression) != nil
      && C14_6ContractValidation.date(retrievedAt) != nil
      && C14_6ContractValidation.boundedNonBlank(licence.id, maximum: 120)
      && C14_6ContractValidation.boundedNonBlank(licence.title, maximum: 200)
      && C14_6ContractValidation.validHTTPSURL(licence.url)
  }
}

struct C14_6PropertyCandidate: Codable, Equatable, Identifiable, Sendable {
  let address: C14_6PropertyAddress
  let candidateId: String
  let displayAddress: String
  let identifiers: [C14_6PropertyIdentifier]
  let jurisdiction: String
  let location: C14_6PropertyLocation?
  let source: C14_6PropertySource

  var id: String { candidateId }
  var isValid: Bool {
    UUID(uuidString: candidateId) != nil
      && address.isValid
      && C14_6ContractValidation.boundedNonBlank(displayAddress, maximum: 240)
      && identifiers.count <= 5
      && identifiers.allSatisfy {
        $0.scheme == "UPRN"
          && $0.value.range(of: "^\\d{1,12}$", options: .regularExpression) != nil
      }
      && ["england", "wales", "scotland", "northern-ireland", "unknown"].contains(jurisdiction)
      && (location?.isValid ?? true)
      && source.isValid
  }
}

struct C14_6PropertyResolution: Codable, Equatable, Sendable {
  let candidates: [C14_6PropertyCandidate]
  let expiresAt: String
  let manualEntryAllowed: Bool
  let providerState: String
  let resolutionId: String
  let status: String

  var isValid: Bool {
    let countsAgree =
      (status == "matched" && candidates.count == 1)
      || (status == "ambiguous" && (2...20).contains(candidates.count))
      || (["no-match", "unavailable"].contains(status) && candidates.isEmpty)
    let providerAgrees = status == "unavailable"
      ? ["disabled", "unavailable"].contains(providerState)
      : providerState == "fixture"
    return UUID(uuidString: resolutionId) != nil
      && C14_6ContractValidation.date(expiresAt) != nil
      && manualEntryAllowed
      && countsAgree
      && providerAgrees
      && candidates.allSatisfy(\.isValid)
  }
}

struct C14_6ProjectProperty: Codable, Equatable, Sendable {
  let address: C14_6PropertyAddress
  let displayAddress: String
  let identifiers: [C14_6PropertyIdentifier]
  let interiorKnowledgeStatus: String
  let jurisdiction: String
  let location: C14_6PropertyLocation?
  let mode: String
  let projectId: String
  let propertyId: String
  let selectedAt: String
  let source: C14_6PropertySource
  let updatedAt: String
  let version: Int

  var isValid: Bool {
    address.isValid
      && C14_6ContractValidation.boundedNonBlank(displayAddress, maximum: 240)
      && identifiers.count <= 5
      && identifiers.allSatisfy {
        $0.scheme == "UPRN"
          && $0.value.range(of: "^\\d{1,12}$", options: .regularExpression) != nil
      }
      && interiorKnowledgeStatus == "unknown-without-evidence"
      && jurisdiction == "england"
      && ["candidate", "manual"].contains(mode)
      && UUID(uuidString: projectId) != nil
      && UUID(uuidString: propertyId) != nil
      && version > 0
      && source.isValid
      && (location?.isValid ?? true)
      && C14_6ContractValidation.date(selectedAt) != nil
      && C14_6ContractValidation.date(updatedAt) != nil
  }
}

enum C14_6DossierValue: Codable, Equatable, Sendable {
  case boolean(Bool)
  case integer(Int, unit: String?)
  case number(Double, unit: String?)
  case text(String)
  case unknown

  private enum CodingKeys: String, CodingKey { case kind, unit, value }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(String.self, forKey: .kind) {
    case "boolean": self = .boolean(try container.decode(Bool.self, forKey: .value))
    case "integer":
      self = .integer(
        try container.decode(Int.self, forKey: .value),
        unit: try container.decodeIfPresent(String.self, forKey: .unit)
      )
    case "number":
      self = .number(
        try container.decode(Double.self, forKey: .value),
        unit: try container.decodeIfPresent(String.self, forKey: .unit)
      )
    case "text": self = .text(try container.decode(String.self, forKey: .value))
    case "unknown": self = .unknown
    default:
      throw DecodingError.dataCorruptedError(
        forKey: .kind,
        in: container,
        debugDescription: "Unknown dossier value kind"
      )
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .boolean(let value):
      try container.encode("boolean", forKey: .kind)
      try container.encode(value, forKey: .value)
    case .integer(let value, let unit):
      try container.encode("integer", forKey: .kind)
      try container.encode(value, forKey: .value)
      try container.encodeIfPresent(unit, forKey: .unit)
    case .number(let value, let unit):
      try container.encode("number", forKey: .kind)
      try container.encode(value, forKey: .value)
      try container.encodeIfPresent(unit, forKey: .unit)
    case .text(let value):
      try container.encode("text", forKey: .kind)
      try container.encode(value, forKey: .value)
    case .unknown:
      try container.encode("unknown", forKey: .kind)
    }
  }

  var displayValue: String {
    switch self {
    case .boolean(let value): value ? "Yes" : "No"
    case .integer(let value, let unit): "\(value)\(unit.map { " \($0)" } ?? "")"
    case .number(let value, let unit): "\(value.formatted())\(unit.map { " \($0)" } ?? "")"
    case .text(let value): value
    case .unknown: "Unknown"
    }
  }

  var isUnknown: Bool {
    if case .unknown = self { return true }
    return false
  }

  var isValid: Bool {
    switch self {
    case .boolean:
      true
    case .integer(let value, let unit):
      (-1_000_000_000...1_000_000_000).contains(value)
        && (unit.map { ["count", "m2", "mm", "year"].contains($0) } ?? true)
    case .number(let value, let unit):
      value.isFinite
        && (-1_000_000_000...1_000_000_000).contains(value)
        && (unit.map { ["m", "m2", "percent", "rating"].contains($0) } ?? true)
    case .text(let value):
      C14_6ContractValidation.boundedNonBlank(value, maximum: 500)
    case .unknown:
      true
    }
  }
}

struct C14_6DossierItem: Codable, Equatable, Identifiable, Sendable {
  let classification: String
  let confidencePercent: Int?
  let interiorClaim: String
  let key: String
  let label: String
  let note: String?
  let sourceRecordIds: [String]
  let value: C14_6DossierValue

  var id: String { key }
  var isValid: Bool {
    let confidenceRequired = ["estimate", "inference"].contains(classification)
    return ["source-observation", "user-assertion", "estimate", "inference", "unknown"].contains(classification)
      && confidenceRequired == (confidencePercent != nil)
      && confidencePercent.map { (0...100).contains($0) } ?? true
      && (classification == "unknown") == value.isUnknown
      && (classification == "unknown" || !sourceRecordIds.isEmpty)
      && sourceRecordIds.count <= 20
      && interiorClaim == "none"
      && key.range(of: "^[a-z][a-z0-9-]{0,79}$", options: .regularExpression) != nil
      && C14_6ContractValidation.boundedNonBlank(label, maximum: 120)
      && note.map { C14_6ContractValidation.boundedNonBlank($0, maximum: 500) } ?? true
      && value.isValid
  }
}

struct C14_6PropertySourceRecord: Codable, Equatable, Identifiable, Sendable {
  let fields: [String]
  let id: String
  let normalizedPayloadSha256: String
  let projectId: String
  let propertyId: String
  let source: C14_6PropertySource

  var isValid: Bool {
    UUID(uuidString: id) != nil
      && (1...100).contains(fields.count)
      && fields.allSatisfy {
        $0.range(of: "^[a-z][a-z0-9-]{0,79}$", options: .regularExpression) != nil
      }
      && UUID(uuidString: projectId) != nil
      && UUID(uuidString: propertyId) != nil
      && normalizedPayloadSha256.range(
        of: "^[a-f0-9]{64}$",
        options: .regularExpression
      ) != nil
      && source.isValid
  }
}

struct C14_6PropertyDossier: Codable, Equatable, Sendable {
  let coverageWarnings: [String]
  let generatedAt: String
  let interiorKnowledgeStatus: String
  let items: [C14_6DossierItem]
  let planningStatus: String
  let property: C14_6ProjectProperty
  let sources: [C14_6PropertySourceRecord]
  let version: Int

  var isValid: Bool {
    let sourceIds = Set(sources.map(\.id))
    return !coverageWarnings.isEmpty
      && coverageWarnings.count <= 20
      && coverageWarnings.allSatisfy {
        C14_6ContractValidation.boundedNonBlank($0, maximum: 500)
      }
      && C14_6ContractValidation.date(generatedAt) != nil
      && interiorKnowledgeStatus == "unknown-without-evidence"
      && planningStatus == "not-reviewed"
      && (1...200).contains(items.count)
      && items.allSatisfy(\.isValid)
      && sources.count <= 50
      && sourceIds.count == sources.count
      && items.allSatisfy { Set($0.sourceRecordIds).isSubset(of: sourceIds) }
      && sources.allSatisfy {
        $0.isValid
          && $0.projectId == property.projectId
          && $0.propertyId == property.propertyId
      }
      && version > 0
      && property.isValid
  }
}

enum C14_6ContractValidation {
  static func date(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions.insert(.withFractionalSeconds)
    return formatter.date(from: value)
  }

  static func boundedNonBlank(_ value: String, maximum: Int) -> Bool {
    value == value.trimmingCharacters(in: .whitespacesAndNewlines)
      && (1...maximum).contains(value.count)
  }

  static func validHTTPSURL(_ value: String?) -> Bool {
    guard let value else { return true }
    guard value.count <= 2_048,
          let components = URLComponents(string: value),
          components.scheme?.lowercased() == "https",
          let host = components.host,
          !host.isEmpty,
          components.user == nil,
          components.password == nil
    else { return false }
    return components.url != nil
  }
}
