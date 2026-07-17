import Foundation

struct CaptureProject: Identifiable, Hashable, Sendable {
  let id: String
  let name: String
  let locationSummary: String
  let isFixture: Bool

  static let localFixtures: [CaptureProject] = [
    CaptureProject(
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Sample terrace refresh",
      locationSummary: "Synthetic local project",
      isFixture: true
    ),
    CaptureProject(
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Sample city flat",
      locationSummary: "Synthetic local project",
      isFixture: true
    ),
  ]

  static func projectService(
    id: String,
    name: String,
    status: String
  ) -> CaptureProject {
    CaptureProject(
      id: id,
      name: name,
      locationSummary: "\(status.capitalized) · Project service",
      isFixture: false
    )
  }
}
