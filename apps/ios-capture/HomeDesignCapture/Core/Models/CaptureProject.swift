import Foundation

struct CaptureProject: Identifiable, Hashable, Sendable {
  let id: String
  let name: String
  let locationSummary: String
  let isFixture: Bool

  static let localFixtures: [CaptureProject] = [
    CaptureProject(
      id: "fixture-victorian-terrace",
      name: "Victorian terrace",
      locationSummary: "Synthetic London project",
      isFixture: true
    ),
    CaptureProject(
      id: "fixture-city-flat",
      name: "City flat",
      locationSummary: "Synthetic Manchester project",
      isFixture: true
    ),
  ]
}
