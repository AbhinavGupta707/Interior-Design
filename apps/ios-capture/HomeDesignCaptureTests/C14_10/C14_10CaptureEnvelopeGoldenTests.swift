import Foundation
import XCTest

@testable import HomeDesignCapture

final class C14_10CaptureEnvelopeGoldenTests: XCTestCase {
  func testSharedLanguageNeutralCaptureEnvelopeGoldens() throws {
    let bundle = Bundle(for: Self.self)
    let casesURL = try XCTUnwrap(bundle.url(forResource: "cases", withExtension: "json"))
    let casesRoot = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: casesURL)) as? [String: Any]
    )
    XCTAssertEqual(casesRoot["schemaVersion"] as? String, "capture-envelope-golden-cases-v1")
    let baseFile = try XCTUnwrap(casesRoot["baseFile"] as? String)
    let baseURL = try XCTUnwrap(
      bundle.url(
        forResource: (baseFile as NSString).deletingPathExtension,
        withExtension: (baseFile as NSString).pathExtension
      )
    )
    let baseData = try Data(contentsOf: baseURL)
    let expectedLength = try XCTUnwrap(casesRoot["expectedCanonicalByteLength"] as? Int)
    let expectedHash = try XCTUnwrap(casesRoot["expectedCanonicalSha256"] as? String)
    let baseBytes = try C14_10CaptureEnvelopeCodec.canonicalBytes(baseData)

    XCTAssertEqual(baseBytes.count, expectedLength)
    XCTAssertEqual(try C14_10CaptureEnvelopeCodec.canonicalSha256(baseData), expectedHash)

    let cases = try XCTUnwrap(casesRoot["cases"] as? [[String: Any]])
    for fixture in cases {
      let identifier = try XCTUnwrap(fixture["id"] as? String)
      let expected = try XCTUnwrap(fixture["expected"] as? String)
      let mutations = try XCTUnwrap(fixture["mutations"] as? [[String: Any]])
      let input = try mutated(baseData: baseData, mutations: mutations)
      if expected == "valid" {
        XCTAssertNoThrow(try C14_10CaptureEnvelopeCodec.decodeStrict(input), identifier)
        if fixture["sameCanonicalAsBase"] as? Bool == true {
          XCTAssertEqual(
            try C14_10CaptureEnvelopeCodec.canonicalBytes(input), baseBytes, identifier)
          XCTAssertEqual(
            try C14_10CaptureEnvelopeCodec.canonicalSha256(input),
            expectedHash,
            identifier
          )
        }
        if let caseHash = fixture["expectedCanonicalSha256"] as? String {
          let caseBytes = try C14_10CaptureEnvelopeCodec.canonicalBytes(input)
          XCTAssertEqual(
            caseBytes.count,
            try XCTUnwrap(fixture["expectedCanonicalByteLength"] as? Int),
            identifier
          )
          XCTAssertEqual(
            try C14_10CaptureEnvelopeCodec.canonicalSha256(input), caseHash, identifier)
        }
      } else {
        XCTAssertThrowsError(try C14_10CaptureEnvelopeCodec.decodeStrict(input), identifier)
      }
    }
  }

  private func mutated(
    baseData: Data,
    mutations: [[String: Any]]
  ) throws -> Data {
    var root = try mutableJSON(baseData)
    for mutation in mutations {
      let operation = try XCTUnwrap(mutation["operation"] as? String)
      if operation == "uppercase-uuids" {
        let data = try JSONSerialization.data(withJSONObject: root)
        var text = String(decoding: data, as: UTF8.self)
        let regex = try NSRegularExpression(
          pattern: #"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"#,
          options: [.caseInsensitive]
        )
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        for match in regex.matches(in: text, range: range).reversed() {
          guard let swiftRange = Range(match.range, in: text) else { continue }
          text.replaceSubrange(swiftRange, with: text[swiftRange].uppercased())
        }
        root = try mutableJSON(Data(text.utf8))
        continue
      }
      let path = try XCTUnwrap(mutation["path"] as? String)
      if operation == "append" || operation == "append-copy" {
        let target = try XCTUnwrap(read(root: root, path: path) as? NSMutableArray)
        let value: Any
        if operation == "append-copy" {
          value = try XCTUnwrap(read(root: root, path: try XCTUnwrap(mutation["from"] as? String)))
        } else {
          value = try XCTUnwrap(mutation["value"])
        }
        target.add(try deepCopy(value))
        continue
      }
      let (parent, key) = try parent(root: root, path: path)
      if operation == "remove" {
        if let array = parent as? NSMutableArray {
          array.removeObject(at: try XCTUnwrap(Int(key)))
        } else {
          (parent as? NSMutableDictionary)?.removeObject(forKey: key)
        }
      } else {
        let value = mutation["value"] ?? NSNull()
        if let array = parent as? NSMutableArray {
          array[try XCTUnwrap(Int(key))] = try deepCopy(value)
        } else {
          (parent as? NSMutableDictionary)?[key] = try deepCopy(value)
        }
      }
    }
    return try JSONSerialization.data(withJSONObject: root)
  }

  private func mutableJSON(_ data: Data) throws -> Any {
    try JSONSerialization.jsonObject(with: data, options: [.mutableContainers, .mutableLeaves])
  }

  private func read(root: Any, path: String) -> Any? {
    var current: Any? = root
    for token in tokens(path) {
      if let array = current as? NSMutableArray, let index = Int(token), index < array.count {
        current = array[index]
      } else if let dictionary = current as? NSMutableDictionary {
        current = dictionary[token]
      } else {
        return nil
      }
    }
    return current
  }

  private func parent(root: Any, path: String) throws -> (Any, String) {
    var parts = tokens(path)
    let key = try XCTUnwrap(parts.popLast())
    let parentPath = parts.isEmpty ? "" : "/" + parts.joined(separator: "/")
    return (try XCTUnwrap(parentPath.isEmpty ? root : read(root: root, path: parentPath)), key)
  }

  private func tokens(_ path: String) -> [String] {
    path.split(separator: "/").map {
      $0.replacingOccurrences(of: "~1", with: "/").replacingOccurrences(of: "~0", with: "~")
    }
  }

  private func deepCopy(_ value: Any) throws -> Any {
    try JSONSerialization.jsonObject(
      with: JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
      options: [.fragmentsAllowed, .mutableContainers, .mutableLeaves]
    )
  }
}
