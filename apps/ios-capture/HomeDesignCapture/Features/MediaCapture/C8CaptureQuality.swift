@preconcurrency import AVFoundation
import CoreGraphics
import Foundation
import ImageIO

struct C8CaptureQualityEvaluator: Sendable {
  static let minimumAcceptedBlur = 280_000
  static let minimumAcceptedExposure = 600_000

  func evaluate(luma: [UInt8], width: Int, height: Int) -> C8CapturedMediaQuality {
    guard width >= 3, height >= 3, luma.count == width * height else {
      return C8CapturedMediaQuality(
        blurScoreMillionths: 0,
        exposureScoreMillionths: 0,
        guidance: [.holdSteady, .improveLighting]
      )
    }
    var clipped = 0
    var laplacianSum = 0.0
    var laplacianSquareSum = 0.0
    var laplacianCount = 0
    for value in luma where value < 18 || value > 237 { clipped += 1 }
    for y in 1..<(height - 1) {
      for x in 1..<(width - 1) {
        let index = y * width + x
        let centre = Double(luma[index]) * 4
        let laplacian =
          centre
          - Double(luma[index - 1])
          - Double(luma[index + 1])
          - Double(luma[index - width])
          - Double(luma[index + width])
        laplacianSum += laplacian
        laplacianSquareSum += laplacian * laplacian
        laplacianCount += 1
      }
    }
    let mean = laplacianSum / Double(max(laplacianCount, 1))
    let variance = max(0, laplacianSquareSum / Double(max(laplacianCount, 1)) - mean * mean)
    let blur = min(1_000_000, Int((variance / 1_200) * 1_000_000))
    let exposure = max(0, 1_000_000 - Int(Double(clipped) / Double(luma.count) * 1_000_000))
    var guidance: [C8CaptureGuidance] = []
    if blur < Self.minimumAcceptedBlur { guidance.append(.holdSteady) }
    if exposure < Self.minimumAcceptedExposure { guidance.append(.improveLighting) }
    if guidance.isEmpty { guidance.append(.ready) }
    return C8CapturedMediaQuality(
      blurScoreMillionths: blur,
      exposureScoreMillionths: exposure,
      guidance: guidance
    )
  }
}

protocol C8CapturedMediaInspecting: Sendable {
  func inspect(fileURL: URL, mimeType: C8MediaMIMEType) async throws -> C8CapturedMediaQuality
}

actor C8CapturedMediaInspector: C8CapturedMediaInspecting {
  private let evaluator = C8CaptureQualityEvaluator()

  func inspect(fileURL: URL, mimeType: C8MediaMIMEType) throws -> C8CapturedMediaQuality {
    let image: CGImage?
    switch mimeType {
    case .heic, .jpeg, .png:
      guard let source = CGImageSourceCreateWithURL(fileURL as CFURL, nil) else {
        throw C8CameraCaptureError.captureFailed
      }
      image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    case .mp4, .quickTime:
      let generator = AVAssetImageGenerator(asset: AVURLAsset(url: fileURL))
      generator.appliesPreferredTrackTransform = true
      generator.maximumSize = CGSize(width: 128, height: 128)
      image = try generator.copyCGImage(
        at: CMTime(seconds: 0.25, preferredTimescale: 600), actualTime: nil)
    }
    guard let image else { throw C8CameraCaptureError.captureFailed }
    let width = 128
    let height = 128
    var luma = [UInt8](repeating: 0, count: width * height)
    guard
      let context = CGContext(
        data: &luma,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: width,
        space: CGColorSpaceCreateDeviceGray(),
        bitmapInfo: CGImageAlphaInfo.none.rawValue
      )
    else { throw C8CameraCaptureError.captureFailed }
    context.interpolationQuality = .medium
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return evaluator.evaluate(luma: luma, width: width, height: height)
  }
}

enum C8CoverageGuidance {
  static func sector(after covered: [C8CoverageSector]) -> C8CoverageSector? {
    C8CoverageSector.allCases.first { !covered.contains($0) }
  }

  static func guidance(
    kind: C8MediaCaptureKind,
    covered: [C8CoverageSector],
    latestQuality: C8CapturedMediaQuality?
  ) -> [C8CaptureGuidance] {
    var guidance = latestQuality?.guidance.filter { $0 != .ready } ?? []
    if covered.count < (kind == .photo ? C8CoverageSector.allCases.count : 6) {
      guidance.append(.completeCoverage)
    }
    if kind == .photo && covered.count < 3 { guidance.append(.addParallax) }
    return guidance.isEmpty ? [.ready] : Array(Set(guidance)).sorted { $0.rawValue < $1.rawValue }
  }
}
