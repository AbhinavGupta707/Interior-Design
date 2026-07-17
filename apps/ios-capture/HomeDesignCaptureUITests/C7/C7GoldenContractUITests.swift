import CryptoKit
import Foundation
import XCTest

/// Independent Swift acceptance of the same exact bytes consumed by
/// tests/mobile/capture/golden-contract.test.ts. This is schema conformance
/// evidence only; the bytes are visibly synthetic and contain no RoomPlan scan.
final class C7GoldenContractUITests: XCTestCase {
  private let expectedSHA256 = "f793e3b63d8342931be13c2931062ebd3b9d44328cab5f59e91729571cec9f74"

  func testExactCrossLanguageGoldenBytesAreStrictlyAccepted() throws {
    let data = try XCTUnwrap(
      Data(base64Encoded: Self.goldenBase64, options: .ignoreUnknownCharacters))
    XCTAssertEqual(
      SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), expectedSHA256)
    XCTAssertNoThrow(try C7StrictNormalizedFixture.validate(data))

    XCTAssertNoThrow(try JSONSerialization.jsonObject(with: data))
  }

  func testCrossLanguageAdversarialMutationsFailClosed() throws {
    let data = try XCTUnwrap(
      Data(base64Encoded: Self.goldenBase64, options: .ignoreUnknownCharacters))
    let original = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

    var unknownField = original
    unknownField["worldMap"] = "must-never-cross-the-boundary"
    XCTAssertThrowsError(try C7StrictNormalizedFixture.validate(encoded(unknownField)))

    var floatingCoordinate = original
    var floatingSurfaces = try XCTUnwrap(floatingCoordinate["surfaces"] as? [[String: Any]])
    var floatingSurface = try XCTUnwrap(floatingSurfaces.first)
    var floatingTransform = try XCTUnwrap(floatingSurface["transform"] as? [String: Any])
    var floatingTranslation = try XCTUnwrap(
      floatingTransform["translationMicrometres"] as? [String: Any]
    )
    floatingTranslation["x"] = 0.5
    floatingTransform["translationMicrometres"] = floatingTranslation
    floatingSurface["transform"] = floatingTransform
    floatingSurfaces[0] = floatingSurface
    floatingCoordinate["surfaces"] = floatingSurfaces
    XCTAssertThrowsError(try C7StrictNormalizedFixture.validate(encoded(floatingCoordinate)))

    var duplicateIdentifier = original
    var duplicateSurfaces = try XCTUnwrap(duplicateIdentifier["surfaces"] as? [[String: Any]])
    duplicateSurfaces[1]["sourceIdentifier"] = duplicateSurfaces[0]["sourceIdentifier"]
    duplicateIdentifier["surfaces"] = duplicateSurfaces
    XCTAssertThrowsError(try C7StrictNormalizedFixture.validate(encoded(duplicateIdentifier)))

    var missingParent = original
    var parentObjects = try XCTUnwrap(missingParent["objects"] as? [[String: Any]])
    parentObjects[0]["parentSourceIdentifier"] = "99999999-9999-4999-8999-999999999999"
    missingParent["objects"] = parentObjects
    XCTAssertThrowsError(try C7StrictNormalizedFixture.validate(encoded(missingParent)))

    var missingIdentifier = original
    var missingSurfaces = try XCTUnwrap(missingIdentifier["surfaces"] as? [[String: Any]])
    missingSurfaces[0].removeValue(forKey: "sourceIdentifier")
    missingIdentifier["surfaces"] = missingSurfaces
    XCTAssertThrowsError(try C7StrictNormalizedFixture.validate(encoded(missingIdentifier)))

    var missingStructure = original
    missingStructure.removeValue(forKey: "structureIdentifier")
    XCTAssertThrowsError(try C7StrictNormalizedFixture.validate(encoded(missingStructure)))
  }

  func testSemanticEquivalentLegacyBytesAreNotMistakenForTheFrozenGolden() throws {
    let golden = try XCTUnwrap(
      Data(base64Encoded: Self.goldenBase64, options: .ignoreUnknownCharacters)
    )
    let legacy = try XCTUnwrap(
      Data(base64Encoded: Self.legacyMinifiedGoldenBase64, options: .ignoreUnknownCharacters)
    )
    XCTAssertNotEqual(SHA256.hash(data: legacy), SHA256.hash(data: golden))
    XCTAssertEqual(
      try JSONSerialization.jsonObject(with: legacy) as? NSDictionary,
      try JSONSerialization.jsonObject(with: golden) as? NSDictionary
    )
  }

  private func encoded(_ object: [String: Any]) throws -> Data {
    try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  }

  private static let goldenBase64 = """
    ewogICJjYXB0dXJlU2Vzc2lvbklkIjogIjIyMjIyMjIyLTIyMjItNDIyMi04MjIyLTIyMjIyMjIyMjIyMiIsCiAgImNvb3JkaW5hdGVTeXN0ZW0iOiB7CiAgICAiaGFuZGVkbmVzcyI6ICJyaWdodCIsCiAgICAicm90YXRpb25Vbml0IjogIm5hbm91bml0LWJhc2lzIiwKICAgICJzb3VyY2UiOiAicm9vbXBsYW4td29ybGQiLAogICAgInRyYW5zbGF0aW9uVW5pdCI6ICJtaWNyb21ldHJlIgogIH0sCiAgIm9iamVjdHMiOiBbCiAgICB7CiAgICAgICJjYXRlZ29yeSI6ICJ0YWJsZSIsCiAgICAgICJjb25maWRlbmNlIjogIm1lZGl1bSIsCiAgICAgICJkaW1lbnNpb25zTWljcm9tZXRyZXMiOiB7ICJ4IjogMTIwMDAwMCwgInkiOiA3NjAwMDAsICJ6IjogODAwMDAwIH0sCiAgICAgICJwYXJlbnRTb3VyY2VJZGVudGlmaWVyIjogIjU1NTU1NTU1LTU1NTUtNDU1NS04NTU1LTU1NTU1NTU1NTU1MiIsCiAgICAgICJyb29tSWQiOiAiMzMzMzMzMzMtMzMzMy00MzMzLTgzMzMtMzMzMzMzMzMzMzMyIiwKICAgICAgInNvdXJjZUlkZW50aWZpZXIiOiAiNjY2NjY2NjYtNjY2Ni00NjY2LTg2NjYtNjY2NjY2NjY2NjYxIiwKICAgICAgInN0b3J5IjogMCwKICAgICAgInRyYW5zZm9ybSI6IHsKICAgICAgICAiYmFzaXNOYW5vdW5pdHMiOiBbMTAwMDAwMDAwMCwgMCwgMCwgMCwgMTAwMDAwMDAwMCwgMCwgMCwgMCwgMTAwMDAwMDAwMF0sCiAgICAgICAgInRyYW5zbGF0aW9uTWljcm9tZXRyZXMiOiB7ICJ4IjogMTAwMDAwMCwgInkiOiAzODAwMDAsICJ6IjogLTUwMDAwMCB9CiAgICAgIH0KICAgIH0KICBdLAogICJwcm9qZWN0SWQiOiAiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwKICAicXVhbGl0eSI6IHsKICAgICJoZXVyaXN0aWNOYW1lIjogImM3LXJvb21wbGFuLXF1YWxpdHkiLAogICAgImhldXJpc3RpY1ZlcnNpb24iOiAic3ludGhldGljLTEuMC4wIiwKICAgICJpbnN0cnVjdGlvbkNvdW50cyI6IHsKICAgICAgImxvdy10ZXh0dXJlIjogMSwKICAgICAgIm1vdmUtYXdheS1mcm9tLXdhbGwiOiAyLAogICAgICAibW92ZS1jbG9zZS10by13YWxsIjogMywKICAgICAgIm5vcm1hbCI6IDQwLAogICAgICAic2xvdy1kb3duIjogNCwKICAgICAgInR1cm4tb24tbGlnaHQiOiAxCiAgICB9LAogICAgImludGVycnVwdGlvbkNvdW50IjogMSwKICAgICJsb3dDb25maWRlbmNlT2JqZWN0Q291bnQiOiAwLAogICAgImxvd0NvbmZpZGVuY2VTdXJmYWNlQ291bnQiOiAxLAogICAgInJlbG9jYWxpc2F0aW9uQXR0ZW1wdENvdW50IjogMSwKICAgICJyZWxvY2FsaXNhdGlvblN1Y2Nlc3NDb3VudCI6IDEsCiAgICAic2NhbkR1cmF0aW9uTWlsbGlzZWNvbmRzIjogNDIwMDAwLAogICAgIndvcmxkTWFwcGluZ1N0YXR1c0F0RmluaXNoIjogIm1hcHBlZCIKICB9LAogICJyZWZlcmVuY2VNZWFzdXJlbWVudHMiOiBbCiAgICB7CiAgICAgICJkaXN0YW5jZU1pbGxpbWV0cmVzIjogNDAwMCwKICAgICAgImZyb21Tb3VyY2VFbnRpdHlJZCI6ICI1NTU1NTU1NS01NTU1LTQ1NTUtODU1NS01NTU1NTU1NTU1NTEiLAogICAgICAibWVhc3VyZW1lbnRJZCI6ICI4ODg4ODg4OC04ODg4LTQ4ODgtODg4OC04ODg4ODg4ODg4ODEiLAogICAgICAibWV0aG9kIjogImxhc2VyIiwKICAgICAgInRvU291cmNlRW50aXR5SWQiOiAiNTU1NTU1NTUtNTU1NS00NTU1LTg1NTUtNTU1NTU1NTU1NTUyIgogICAgfQogIF0sCiAgInJvb21zIjogWwogICAgewogICAgICAiY2FwdHVyZWRSb29tVmVyc2lvbiI6IDEsCiAgICAgICJyb29tSWQiOiAiMzMzMzMzMzMtMzMzMy00MzMzLTgzMzMtMzMzMzMzMzMzMzMxIiwKICAgICAgInNlcXVlbmNlIjogMSwKICAgICAgInNvdXJjZVJvb21JZGVudGlmaWVyIjogIjQ0NDQ0NDQ0LTQ0NDQtNDQ0NC04NDQ0LTQ0NDQ0NDQ0NDQ0MSIsCiAgICAgICJzdG9yeSI6IDAsCiAgICAgICJ1c2VyTGFiZWwiOiAiU3ludGhldGljIHJvb20gQSIKICAgIH0sCiAgICB7CiAgICAgICJjYXB0dXJlZFJvb21WZXJzaW9uIjogMSwKICAgICAgInJvb21JZCI6ICIzMzMzMzMzMy0zMzMzLTQzMzMtODMzMy0zMzMzMzMzMzMzMzIiLAogICAgICAic2VxdWVuY2UiOiAyLAogICAgICAic291cmNlUm9vbUlkZW50aWZpZXIiOiAiNDQ0NDQ0NDQtNDQ0NC00NDQ0LTg0NDQtNDQ0NDQ0NDQ0NDQyIiwKICAgICAgInN0b3J5IjogMCwKICAgICAgInVzZXJMYWJlbCI6ICJTeW50aGV0aWMgcm9vbSBCIgogICAgfQogIF0sCiAgInNjaGVtYVZlcnNpb24iOiAiYzctcm9vbXBsYW4tbm9ybWFsaXplZC12MSIsCiAgInN0cnVjdHVyZUlkZW50aWZpZXIiOiAiNzc3Nzc3NzctNzc3Ny00Nzc3LTg3NzctNzc3Nzc3Nzc3NzcxIiwKICAic3VyZmFjZXMiOiBbCiAgICB7CiAgICAgICJjYXRlZ29yeSI6ICJ3YWxsIiwKICAgICAgImNvbXBsZXRlZEVkZ2VzIjogWyJ0b3AiLCAiYm90dG9tIiwgImxlZnQiLCAicmlnaHQiXSwKICAgICAgImNvbmZpZGVuY2UiOiAiaGlnaCIsCiAgICAgICJkaW1lbnNpb25zTWljcm9tZXRyZXMiOiB7ICJ4IjogNDAwMDAwMCwgInkiOiAyNTAwMDAwLCAieiI6IDEwMDAwMCB9LAogICAgICAicG9seWdvbkNvcm5lcnNNaWNyb21ldHJlcyI6IFsKICAgICAgICB7ICJ4IjogLTIwMDAwMDAsICJ5IjogLTEyNTAwMDAsICJ6IjogMCB9LAogICAgICAgIHsgIngiOiAyMDAwMDAwLCAieSI6IC0xMjUwMDAwLCAieiI6IDAgfSwKICAgICAgICB7ICJ4IjogMjAwMDAwMCwgInkiOiAxMjUwMDAwLCAieiI6IDAgfSwKICAgICAgICB7ICJ4IjogLTIwMDAwMDAsICJ5IjogMTI1MDAwMCwgInoiOiAwIH0KICAgICAgXSwKICAgICAgInJvb21JZCI6ICIzMzMzMzMzMy0zMzMzLTQzMzMtODMzMy0zMzMzMzMzMzMzMzEiLAogICAgICAic291cmNlSWRlbnRpZmllciI6ICI1NTU1NTU1NS01NTU1LTQ1NTUtODU1NS01NTU1NTU1NTU1NTEiLAogICAgICAic3RvcnkiOiAwLAogICAgICAidHJhbnNmb3JtIjogewogICAgICAgICJiYXNpc05hbm91bml0cyI6IFsxMDAwMDAwMDAwLCAwLCAwLCAwLCAxMDAwMDAwMDAwLCAwLCAwLCAwLCAxMDAwMDAwMDAwXSwKICAgICAgICAidHJhbnNsYXRpb25NaWNyb21ldHJlcyI6IHsgIngiOiAwLCAieSI6IDEyNTAwMDAsICJ6IjogMCB9CiAgICAgIH0KICAgIH0sCiAgICB7CiAgICAgICJjYXRlZ29yeSI6ICJ3YWxsIiwKICAgICAgImNvbXBsZXRlZEVkZ2VzIjogWyJ0b3AiLCAiYm90dG9tIl0sCiAgICAgICJjb25maWRlbmNlIjogIm1lZGl1bSIsCiAgICAgICJjdXJ2ZSI6IHsKICAgICAgICAiY2VudHJlWE1pY3JvbWV0cmVzIjogMCwKICAgICAgICAiY2VudHJlWk1pY3JvbWV0cmVzIjogMCwKICAgICAgICAiZW5kTmFub3JhZGlhbnMiOiAxNTcwNzk2MzI3LAogICAgICAgICJyYWRpdXNNaWNyb21ldHJlcyI6IDIwMDAwMDAsCiAgICAgICAgInN0YXJ0TmFub3JhZGlhbnMiOiAwCiAgICAgIH0sCiAgICAgICJkaW1lbnNpb25zTWljcm9tZXRyZXMiOiB7ICJ4IjogMzUwMDAwMCwgInkiOiAyNTAwMDAwLCAieiI6IDEwMDAwMCB9LAogICAgICAicG9seWdvbkNvcm5lcnNNaWNyb21ldHJlcyI6IFtdLAogICAgICAicm9vbUlkIjogIjMzMzMzMzMzLTMzMzMtNDMzMy04MzMzLTMzMzMzMzMzMzMzMiIsCiAgICAgICJzb3VyY2VJZGVudGlmaWVyIjogIjU1NTU1NTU1LTU1NTUtNDU1NS04NTU1LTU1NTU1NTU1NTU1MiIsCiAgICAgICJzdG9yeSI6IDAsCiAgICAgICJ0cmFuc2Zvcm0iOiB7CiAgICAgICAgImJhc2lzTmFub3VuaXRzIjogWzEwMDAwMDAwMDAsIDAsIDAsIDAsIDEwMDAwMDAwMDAsIDAsIDAsIDAsIDEwMDAwMDAwMDBdLAogICAgICAgICJ0cmFuc2xhdGlvbk1pY3JvbWV0cmVzIjogeyAieCI6IDQwMDAwMDAsICJ5IjogMTI1MDAwMCwgInoiOiAwIH0KICAgICAgfQogICAgfQogIF0KfQo=
    """

  // Kept as an adversarial semantic-equivalence stream: it decodes to the
  // same JSON value but does not have the frozen cross-language byte hash.
  private static let legacyMinifiedGoldenBase64 = """
    eyJjYXB0dXJlU2Vzc2lvbklkIjoiMjIyMjIyMjItMjIyMi00MjIyLTgyMjItMjIyMjIyMjIyMjIyIiwiY29vcmRpbmF0ZVN5c3RlbSI6eyJoYW5kZWRuZXNzIjoicmlnaHQiLCJyb3RhdGlvblVuaXQiOiJuYW5vdW5pdC1iYXNpcyIsInNvdXJjZSI6InJvb21wbGFuLXdvcmxkIiwidHJhbnNsYXRpb25Vbml0IjoibWljcm9tZXRyZSJ9LCJvYmplY3RzIjpbeyJjYXRlZ29yeSI6InRhYmxlIiwiY29uZmlkZW5jZSI6Im1lZGl1bSIsImRpbWVuc2lvbnNNaWNyb21ldHJlcyI6eyJ4IjoxMjAwMDAwLCJ5Ijo3NjAwMDAsInoiOjgwMDAwMH0sInBhcmVudFNvdXJjZUlkZW50aWZpZXIiOiI1NTU1NTU1NS01NTU1LTQ1NTUtODU1NS01NTU1NTU1NTU1NTIiLCJyb29tSWQiOiIzMzMzMzMzMy0zMzMzLTQzMzMtODMzMy0zMzMzMzMzMzMzMzIiLCJzb3VyY2VJZGVudGlmaWVyIjoiNjY2NjY2NjYtNjY2Ni00NjY2LTg2NjYtNjY2NjY2NjY2NjYxIiwic3RvcnkiOjAsInRyYW5zZm9ybSI6eyJiYXNpc05hbm91bml0cyI6WzEwMDAwMDAwMDAsMCwwLDAsMTAwMDAwMDAwMCwwLDAsMCwxMDAwMDAwMDAwXSwidHJhbnNsYXRpb25NaWNyb21ldHJlcyI6eyJ4IjoxMDAwMDAwLCJ5IjozODAwMDAsInoiOi01MDAwMDB9fX1dLCJwcm9qZWN0SWQiOiIxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTEiLCJxdWFsaXR5Ijp7ImhldXJpc3RpY05hbWUiOiJjNy1yb29tcGxhbi1xdWFsaXR5IiwiaGV1cmlzdGljVmVyc2lvbiI6InN5bnRoZXRpYy0xLjAuMCIsImluc3RydWN0aW9uQ291bnRzIjp7Imxvdy10ZXh0dXJlIjoxLCJtb3ZlLWF3YXktZnJvbS13YWxsIjoyLCJtb3ZlLWNsb3NlLXRvLXdhbGwiOjMsIm5vcm1hbCI6NDAsInNsb3ctZG93biI6NCwidHVybi1vbi1saWdodCI6MX0sImludGVycnVwdGlvbkNvdW50IjoxLCJsb3dDb25maWRlbmNlT2JqZWN0Q291bnQiOjAsImxvd0NvbmZpZGVuY2VTdXJmYWNlQ291bnQiOjEsInJlbG9jYWxpc2F0aW9uQXR0ZW1wdENvdW50IjoxLCJyZWxvY2FsaXNhdGlvblN1Y2Nlc3NDb3VudCI6MSwic2NhbkR1cmF0aW9uTWlsbGlzZWNvbmRzIjo0MjAwMDAsIndvcmxkTWFwcGluZ1N0YXR1c0F0RmluaXNoIjoibWFwcGVkIn0sInJlZmVyZW5jZU1lYXN1cmVtZW50cyI6W3siZGlzdGFuY2VNaWxsaW1ldHJlcyI6NDAwMCwiZnJvbVNvdXJjZUVudGl0eUlkIjoiNTU1NTU1NTUtNTU1NS00NTU1LTg1NTUtNTU1NTU1NTU1NTUxIiwibWVhc3VyZW1lbnRJZCI6Ijg4ODg4ODg4LTg4ODgtNDg4OC04ODg4LTg4ODg4ODg4ODg4MSIsIm1ldGhvZCI6Imxhc2VyIiwidG9Tb3VyY2VFbnRpdHlJZCI6IjU1NTU1NTU1LTU1NTUtNDU1NS04NTU1LTU1NTU1NTU1NTU1MiJ9XSwicm9vbXMiOlt7ImNhcHR1cmVkUm9vbVZlcnNpb24iOjEsInJvb21JZCI6IjMzMzMzMzMzLTMzMzMtNDMzMy04MzMzLTMzMzMzMzMzMzMzMSIsInNlcXVlbmNlIjoxLCJzb3VyY2VSb29tSWRlbnRpZmllciI6IjQ0NDQ0NDQ0LTQ0NDQtNDQ0NC04NDQ0LTQ0NDQ0NDQ0NDQ0MSIsInN0b3J5IjowLCJ1c2VyTGFiZWwiOiJTeW50aGV0aWMgcm9vbSBBIn0seyJjYXB0dXJlZFJvb21WZXJzaW9uIjoxLCJyb29tSWQiOiIzMzMzMzMzMy0zMzMzLTQzMzMtODMzMy0zMzMzMzMzMzMzMzIiLCJzZXF1ZW5jZSI6Miwic291cmNlUm9vbUlkZW50aWZpZXIiOiI0NDQ0NDQ0NC00NDQ0LTQ0NDQtODQ0NC00NDQ0NDQ0NDQ0NDIiLCJzdG9yeSI6MCwidXNlckxhYmVsIjoiU3ludGhldGljIHJvb20gQiJ9XSwic2NoZW1hVmVyc2lvbiI6ImM3LXJvb21wbGFuLW5vcm1hbGl6ZWQtdjEiLCJzdHJ1Y3R1cmVJZGVudGlmaWVyIjoiNzc3Nzc3NzctNzc3Ny00Nzc3LTg3NzctNzc3Nzc3Nzc3NzcxIiwic3VyZmFjZXMiOlt7ImNhdGVnb3J5Ijoid2FsbCIsImNvbXBsZXRlZEVkZ2VzIjpbInRvcCIsImJvdHRvbSIsImxlZnQiLCJyaWdodCJdLCJjb25maWRlbmNlIjoiaGlnaCIsImRpbWVuc2lvbnNNaWNyb21ldHJlcyI6eyJ4Ijo0MDAwMDAwLCJ5IjoyNTAwMDAwLCJ6IjoxMDAwMDB9LCJwb2x5Z29uQ29ybmVyc01pY3JvbWV0cmVzIjpbeyJ4IjotMjAwMDAwMCwieSI6LTEyNTAwMDAsInoiOjB9LHsieCI6MjAwMDAwMCwieSI6LTEyNTAwMDAsInoiOjB9LHsieCI6MjAwMDAwMCwieSI6MTI1MDAwMCwieiI6MH0seyJ4IjotMjAwMDAwMCwieSI6MTI1MDAwMCwieiI6MH1dLCJyb29tSWQiOiIzMzMzMzMzMy0zMzMzLTQzMzMtODMzMy0zMzMzMzMzMzMzMzEiLCJzb3VyY2VJZGVudGlmaWVyIjoiNTU1NTU1NTUtNTU1NS00NTU1LTg1NTUtNTU1NTU1NTU1NTUxIiwic3RvcnkiOjAsInRyYW5zZm9ybSI6eyJiYXNpc05hbm91bml0cyI6WzEwMDAwMDAwMDAsMCwwLDAsMTAwMDAwMDAwMCwwLDAsMCwxMDAwMDAwMDAwXSwidHJhbnNsYXRpb25NaWNyb21ldHJlcyI6eyJ4IjowLCJ5IjoxMjUwMDAwLCJ6IjowfX19LHsiY2F0ZWdvcnkiOiJ3YWxsIiwiY29tcGxldGVkRWRnZXMiOlsidG9wIiwiYm90dG9tIl0sImNvbmZpZGVuY2UiOiJtZWRpdW0iLCJjdXJ2ZSI6eyJjZW50cmVYTWljcm9tZXRyZXMiOjAsImNlbnRyZVpNaWNyb21ldHJlcyI6MCwiZW5kTmFub3JhZGlhbnMiOjE1NzA3OTYzMjcsInJhZGl1c01pY3JvbWV0cmVzIjoyMDAwMDAwLCJzdGFydE5hbm9yYWRpYW5zIjowfSwiZGltZW5zaW9uc01pY3JvbWV0cmVzIjp7IngiOjM1MDAwMDAsInkiOjI1MDAwMDAsInoiOjEwMDAwMH0sInBvbHlnb25Db3JuZXJzTWljcm9tZXRyZXMiOltdLCJyb29tSWQiOiIzMzMzMzMzMy0zMzMzLTQzMzMtODMzMy0zMzMzMzMzMzMzMzIiLCJzb3VyY2VJZGVudGlmaWVyIjoiNTU1NTU1NTUtNTU1NS00NTU1LTg1NTUtNTU1NTU1NTU1NTUyIiwic3RvcnkiOjAsInRyYW5zZm9ybSI6eyJiYXNpc05hbm91bml0cyI6WzEwMDAwMDAwMDAsMCwwLDAsMTAwMDAwMDAwMCwwLDAsMCwxMDAwMDAwMDAwXSwidHJhbnNsYXRpb25NaWNyb21ldHJlcyI6eyJ4Ijo0MDAwMDAwLCJ5IjoxMjUwMDAwLCJ6IjowfX19XX0K
    """
}

private enum C7StrictFixtureError: Error {
  case invalid(String)
}

private enum C7StrictNormalizedFixture {
  static func validate(_ data: Data) throws {
    let root = try object(
      JSONSerialization.jsonObject(with: data),
      required: [
        "captureSessionId", "coordinateSystem", "objects", "projectId", "quality",
        "referenceMeasurements", "rooms", "schemaVersion", "surfaces",
      ],
      optional: ["structureIdentifier"]
    )
    try uuid(root["captureSessionId"])
    try uuid(root["projectId"])
    guard root["schemaVersion"] as? String == "c7-roomplan-normalized-v1" else {
      throw C7StrictFixtureError.invalid("schema-version")
    }

    let coordinate = try object(
      root["coordinateSystem"],
      required: ["handedness", "rotationUnit", "source", "translationUnit"]
    )
    guard
      coordinate["handedness"] as? String == "right",
      coordinate["rotationUnit"] as? String == "nanounit-basis",
      coordinate["source"] as? String == "roomplan-world",
      coordinate["translationUnit"] as? String == "micrometre"
    else { throw C7StrictFixtureError.invalid("coordinate-system") }

    let rooms = try array(root["rooms"]).map {
      try object(
        $0,
        required: ["capturedRoomVersion", "roomId", "sequence", "sourceRoomIdentifier", "story"],
        optional: ["userLabel"]
      )
    }
    guard !rooms.isEmpty && rooms.count <= 64 else {
      throw C7StrictFixtureError.invalid("room-count")
    }
    let roomIDs = try Set(rooms.map { try uuid($0["roomId"]) })
    guard roomIDs.count == rooms.count else { throw C7StrictFixtureError.invalid("duplicate-room") }
    for room in rooms {
      try integer(room["capturedRoomVersion"])
      try integer(room["sequence"])
      try uuid(room["sourceRoomIdentifier"])
      try integer(room["story"])
    }
    if rooms.count > 1 { try uuid(root["structureIdentifier"]) }

    try validateQuality(root["quality"])
    try validateMeasurements(root["referenceMeasurements"])

    let surfaces = try array(root["surfaces"]).map {
      try object(
        $0,
        required: [
          "category", "completedEdges", "confidence", "dimensionsMicrometres",
          "polygonCornersMicrometres", "roomId", "sourceIdentifier", "story", "transform",
        ],
        optional: ["curve", "parentSourceIdentifier"]
      )
    }
    let objects = try array(root["objects"]).map {
      try object(
        $0,
        required: [
          "category", "confidence", "dimensionsMicrometres", "roomId", "sourceIdentifier",
          "story", "transform",
        ],
        optional: ["parentSourceIdentifier"]
      )
    }
    guard surfaces.count <= 10_000 && objects.count <= 10_000 else {
      throw C7StrictFixtureError.invalid("entity-count")
    }
    let entities = surfaces + objects
    let entityIDs = try entities.map { try uuid($0["sourceIdentifier"]) }
    guard Set(entityIDs).count == entityIDs.count else {
      throw C7StrictFixtureError.invalid("duplicate-entity")
    }
    let entityIDSet = Set(entityIDs)
    for entity in entities {
      guard roomIDs.contains(try uuid(entity["roomId"])) else {
        throw C7StrictFixtureError.invalid("unknown-room")
      }
      if let parent = entity["parentSourceIdentifier"] {
        guard entityIDSet.contains(try uuid(parent)) else {
          throw C7StrictFixtureError.invalid("missing-parent")
        }
      }
      try integer(entity["story"])
      try validateDimensions(entity["dimensionsMicrometres"])
      try validateTransform(entity["transform"])
    }
    for surface in surfaces {
      for point in try array(surface["polygonCornersMicrometres"]) { try validatePoint(point) }
      if let curve = surface["curve"] {
        let value = try object(
          curve,
          required: [
            "centreXMicrometres", "centreZMicrometres", "endNanoradians",
            "radiusMicrometres", "startNanoradians",
          ]
        )
        for entry in value.values { try integer(entry) }
      }
    }
  }

  private static func validateQuality(_ value: Any?) throws {
    let quality = try object(
      value,
      required: [
        "heuristicName", "heuristicVersion", "instructionCounts", "interruptionCount",
        "lowConfidenceObjectCount", "lowConfidenceSurfaceCount", "relocalisationAttemptCount",
        "relocalisationSuccessCount", "scanDurationMilliseconds", "worldMappingStatusAtFinish",
      ]
    )
    guard quality["heuristicName"] as? String == "c7-roomplan-quality" else {
      throw C7StrictFixtureError.invalid("quality-name")
    }
    let counts = try object(
      quality["instructionCounts"],
      required: [
        "low-texture", "move-away-from-wall", "move-close-to-wall", "normal", "slow-down",
        "turn-on-light",
      ]
    )
    for entry in counts.values { try integer(entry) }
    for key in [
      "interruptionCount", "lowConfidenceObjectCount", "lowConfidenceSurfaceCount",
      "relocalisationAttemptCount", "relocalisationSuccessCount", "scanDurationMilliseconds",
    ] { try integer(quality[key]) }
  }

  private static func validateMeasurements(_ value: Any?) throws {
    for measurement in try array(value) {
      let object = try object(
        measurement,
        required: [
          "distanceMillimetres", "fromSourceEntityId", "measurementId", "method",
          "toSourceEntityId",
        ]
      )
      try integer(object["distanceMillimetres"])
      try uuid(object["fromSourceEntityId"])
      try uuid(object["measurementId"])
      try uuid(object["toSourceEntityId"])
    }
  }

  private static func validateDimensions(_ value: Any?) throws {
    let dimensions = try object(value, required: ["x", "y", "z"])
    for entry in dimensions.values { try integer(entry) }
  }

  private static func validatePoint(_ value: Any?) throws {
    let point = try object(value, required: ["x", "y", "z"])
    for entry in point.values { try integer(entry) }
  }

  private static func validateTransform(_ value: Any?) throws {
    let transform = try object(value, required: ["basisNanounits", "translationMicrometres"])
    let basis = try array(transform["basisNanounits"])
    guard basis.count == 9 else { throw C7StrictFixtureError.invalid("basis-count") }
    for entry in basis { try integer(entry) }
    try validatePoint(transform["translationMicrometres"])
  }

  private static func object(
    _ value: Any?,
    required: Set<String>,
    optional: Set<String> = []
  ) throws -> [String: Any] {
    guard let object = value as? [String: Any] else {
      throw C7StrictFixtureError.invalid("object")
    }
    let keys = Set(object.keys)
    guard required.isSubset(of: keys), keys.isSubset(of: required.union(optional)) else {
      throw C7StrictFixtureError.invalid("object-keys")
    }
    return object
  }

  private static func array(_ value: Any?) throws -> [Any] {
    guard let array = value as? [Any] else { throw C7StrictFixtureError.invalid("array") }
    return array
  }

  @discardableResult
  private static func uuid(_ value: Any?) throws -> String {
    guard let string = value as? String, UUID(uuidString: string) != nil else {
      throw C7StrictFixtureError.invalid("uuid")
    }
    return string
  }

  private static func integer(_ value: Any?) throws {
    guard let number = value as? NSNumber else {
      throw C7StrictFixtureError.invalid("integer")
    }
    let type = String(cString: number.objCType)
    guard type != "d", type != "f" else { throw C7StrictFixtureError.invalid("floating") }
  }
}
