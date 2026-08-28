@preconcurrency import ARKit
import CoreImage
import Foundation
import RoomPlan
import SwiftUI
import UIKit

struct C14_8LiveTelemetry: Equatable, Sendable {
  let ambientIntensity: Int?
  let blurScoreMillionths: Int
  let coverageCellId: String
  let exposureScoreMillionths: Int
  let motionScoreMillionths: Int
  let spatialEvidence: C14_10LiveSpatialEvidence
  let trackingState: C14_8TrackingState
}

enum C14_8GuidedCaptureEvent: Equatable, Sendable {
  case interruptionEnded
  case interrupted
  case runtimeFailure
}

enum C14_8GuidedCaptureEngineError: Error, Equatable, Sendable {
  case candidateRejected(C14_10KeyframeDecisionReason)
  case encodingFailed
  case frameUnavailable
  case trackingUnavailable
}

@MainActor
protocol C14_8CapabilityProviding: Sendable {
  func current() -> C14_8CapabilityDeclaration
}

@MainActor
struct C14_8SystemCapabilityProvider: C14_8CapabilityProviding {
  func current() -> C14_8CapabilityDeclaration {
    #if targetEnvironment(simulator)
      return C14_8CapabilityDeclaration(
        appBuild: Self.appBuild,
        appVersion: Self.appVersion,
        arWorldTracking: false,
        cameraIntrinsics: false,
        cameraPoses: false,
        deviceModelIdentifier: "Simulator",
        operatingSystemVersion: UIDevice.current.systemVersion,
        qualityTier: .simulatorFixture,
        rgbKeyframes: true,
        rgbVideo: false,
        roomPlan: false,
        runtime: .simulatorFixture,
        sceneDepth: false,
        schemaVersion: "capture-capabilities-v1"
      )
    #else
      let sceneDepth = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
      let roomPlan = RoomCaptureSession.isSupported
      return C14_8CapabilityDeclaration(
        appBuild: Self.appBuild,
        appVersion: Self.appVersion,
        arWorldTracking: ARWorldTrackingConfiguration.isSupported,
        cameraIntrinsics: ARWorldTrackingConfiguration.isSupported,
        cameraPoses: ARWorldTrackingConfiguration.isSupported,
        deviceModelIdentifier: Self.deviceModelIdentifier,
        operatingSystemVersion: UIDevice.current.systemVersion,
        qualityTier: sceneDepth
          ? (roomPlan ? .guidedRGBDepthRoomPlan : .guidedRGBDepth)
          : .guidedRGB,
        rgbKeyframes: true,
        rgbVideo: false,
        roomPlan: roomPlan,
        runtime: .physicalDevice,
        sceneDepth: sceneDepth,
        schemaVersion: "capture-capabilities-v1"
      )
    #endif
  }

  private static var appBuild: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
  }

  private static var appVersion: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
  }

  private static var deviceModelIdentifier: String {
    var system = utsname()
    uname(&system)
    return withUnsafePointer(to: &system.machine) {
      $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
    }
  }
}

@MainActor
protocol C14_8GuidedCaptureServing: AnyObject {
  var previewSession: ARSession? { get }
  var syntheticFixture: Bool { get }

  func applyResourcePolicy(_ policy: C14_10ResourcePolicy)
  func captureKeyframe(
    to destination: URL,
    localIdentifier: UUID,
    roomId: UUID,
    segmentId: UUID,
    captureStartedAt: Date,
    retentionMode: C14_10KeyframeRetentionMode,
    zoneId: UUID
  ) async throws -> C14_8CapturedKeyframe
  func start(
    telemetry: @escaping @MainActor (C14_8LiveTelemetry) -> Void,
    events: @escaping @MainActor (C14_8GuidedCaptureEvent) -> Void
  ) throws
  func stop()
}

@MainActor
final class C14_8ARKitGuidedCaptureEngine: NSObject, C14_8GuidedCaptureServing,
  @preconcurrency ARSessionDelegate
{
  let syntheticFixture = false
  let previewSession: ARSession? = ARSession()

  private let capability: C14_8CapabilityDeclaration
  private let ciContext = CIContext(options: [.cacheIntermediates: false])
  private let qualityEvaluator = C8CaptureQualityEvaluator()
  private var eventHandler: (@MainActor (C14_8GuidedCaptureEvent) -> Void)?
  private var frameCounter = 0
  private var latestMotionScoreMillionths = 0
  private var latestSpatialEvidence = C14_10LiveSpatialEvidence(
    connectedToPrevious: false,
    featurePointCount: 0,
    loopClosureCandidate: false,
    overlapScoreMillionths: 0,
    parallaxScoreMillionths: 0,
    telemetryTimestampMicroseconds: 0,
    trajectorySpanMicrometres: 0,
    trajectoryTravelMicrometres: 0,
    translationFromPreviousMicrometres: 0
  )
  private var previousPosition: SIMD3<Float>?
  private var previousRotation: simd_quatf?
  private var previousTimestamp: TimeInterval?
  private var retainedObservations: [C14_10RetainedObservation] = []
  private var resourcePolicy = C14_10ResourcePolicy.policy(for: .nominal)
  private var telemetryHandler: (@MainActor (C14_8LiveTelemetry) -> Void)?

  init(capability: C14_8CapabilityDeclaration) {
    self.capability = capability
    super.init()
    previewSession?.delegate = self
    previewSession?.delegateQueue = .main
  }

  func start(
    telemetry: @escaping @MainActor (C14_8LiveTelemetry) -> Void,
    events: @escaping @MainActor (C14_8GuidedCaptureEvent) -> Void
  ) throws {
    guard capability.arWorldTracking, let previewSession else {
      throw C14_8GuidedCaptureEngineError.trackingUnavailable
    }
    telemetryHandler = telemetry
    eventHandler = events
    previousPosition = nil
    previousRotation = nil
    previousTimestamp = nil
    latestMotionScoreMillionths = 0
    retainedObservations = []
    frameCounter = 0
    let configuration = ARWorldTrackingConfiguration()
    configuration.worldAlignment = .gravity
    configuration.environmentTexturing = .none
    if capability.sceneDepth {
      configuration.frameSemantics.insert(.sceneDepth)
    }
    previewSession.run(configuration, options: [.resetTracking, .removeExistingAnchors])
  }

  func stop() {
    previewSession?.pause()
    previousPosition = nil
    previousRotation = nil
    previousTimestamp = nil
    latestMotionScoreMillionths = 0
    retainedObservations = []
    frameCounter = 0
  }

  func applyResourcePolicy(_ policy: C14_10ResourcePolicy) {
    resourcePolicy = policy
  }

  func captureKeyframe(
    to destination: URL,
    localIdentifier: UUID,
    roomId: UUID,
    segmentId: UUID,
    captureStartedAt: Date,
    retentionMode: C14_10KeyframeRetentionMode,
    zoneId: UUID
  ) async throws -> C14_8CapturedKeyframe {
    guard let frame = previewSession?.currentFrame else {
      throw C14_8GuidedCaptureEngineError.frameUnavailable
    }
    let tracking = Self.tracking(frame.camera.trackingState)
    guard tracking == .normal else {
      throw C14_8GuidedCaptureEngineError.trackingUnavailable
    }
    let quality = Self.quality(frame.capturedImage, evaluator: qualityEvaluator)
    let spatialEvidence = spatialEvidence(for: frame)
    let transform = frame.camera.transform
    let forward = -SIMD3(transform.columns.2.x, transform.columns.2.y, transform.columns.2.z)
    let decision = C14_10KeyframeSelector.decision(
      telemetry: C14_8LiveTelemetry(
        ambientIntensity: frame.lightEstimate.map { Int($0.ambientIntensity.rounded()) },
        blurScoreMillionths: quality.blurScoreMillionths,
        coverageCellId: Self.coverageCell(forward: forward),
        exposureScoreMillionths: quality.exposureScoreMillionths,
        motionScoreMillionths: latestMotionScoreMillionths,
        spatialEvidence: spatialEvidence,
        trackingState: tracking
      ),
      retainedCount: retainedObservations.count,
      lastAutomaticTimestampMicroseconds: nil,
      mode: retentionMode
    )
    guard decision.shouldRetain else {
      throw C14_8GuidedCaptureEngineError.candidateRejected(decision.reason)
    }
    // Retain the native ARKit camera raster. Rotating the pixels here without applying the
    // corresponding intrinsics transform would make the retained camera model internally false.
    let image = CIImage(cvPixelBuffer: frame.capturedImage)
    guard
      let colourSpace = CGColorSpace(name: CGColorSpace.sRGB),
      let jpeg = ciContext.jpegRepresentation(
        of: image,
        colorSpace: colourSpace,
        options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.92]
      )
    else { throw C14_8GuidedCaptureEngineError.encodingFailed }
    try jpeg.write(to: destination, options: [.atomic, .completeFileProtection])
    let quaternion = simd_quatf(transform)
    let intrinsics = frame.camera.intrinsics
    let resolution = frame.camera.imageResolution
    let globalMicroseconds = min(
      C14_8CaptureContract.maximumDurationMicroseconds,
      max(0, Int64(Date().timeIntervalSince(captureStartedAt) * 1_000_000))
    )
    let sample = C14_8LocalCameraSample(
      ambientIntensity: frame.lightEstimate.map { Int($0.ambientIntensity.rounded()) },
      blurScoreMillionths: quality.blurScoreMillionths,
      cameraIntrinsicsMicropixels: C14_8CameraIntrinsics(
        cx: Self.micro(intrinsics.columns.2.x),
        cy: Self.micro(intrinsics.columns.2.y),
        fx: Self.micro(intrinsics.columns.0.x),
        fy: Self.micro(intrinsics.columns.1.y),
        imageHeightPixels: Int(resolution.height),
        imageWidthPixels: Int(resolution.width)
      ),
      connectedToPrevious: spatialEvidence.connectedToPrevious,
      exposureScoreMillionths: quality.exposureScoreMillionths,
      featurePointCount: spatialEvidence.featurePointCount,
      intrinsicsModel: "pinhole-native-camera-raster",
      loopClosureCandidate: spatialEvidence.loopClosureCandidate,
      motionScoreMillionths: latestMotionScoreMillionths,
      orientation: "landscape-right",
      overlapScoreMillionths: spatialEvidence.overlapScoreMillionths,
      parallaxScoreMillionths: spatialEvidence.parallaxScoreMillionths,
      poseTransform: "camera-to-world",
      quaternionOrder: "x-y-z-w",
      quaternionNanounits: [
        Self.nano(quaternion.imag.x), Self.nano(quaternion.imag.y),
        Self.nano(quaternion.imag.z), Self.nano(quaternion.real),
      ],
      roomId: roomId,
      sampleId: UUID(),
      segmentId: segmentId,
      sourceLocalIdentifier: localIdentifier,
      sourceTimestampMicroseconds: globalMicroseconds,
      timestampMicroseconds: globalMicroseconds,
      trackingState: tracking,
      trajectorySpanMicrometres: spatialEvidence.trajectorySpanMicrometres,
      trajectoryTravelMicrometres: spatialEvidence.trajectoryTravelMicrometres,
      translationFromPreviousMicrometres: spatialEvidence.translationFromPreviousMicrometres,
      translationMicrometres: C14_8Translation(
        x: Self.micro(transform.columns.3.x),
        y: Self.micro(transform.columns.3.y),
        z: Self.micro(transform.columns.3.z)
      ),
      retentionMode: retentionMode,
      zoneId: zoneId
    )
    retain(frame: frame, spatialEvidence: spatialEvidence)
    let depth = resourcePolicy.optionalDepthEnabled ? frame.sceneDepth.map(Self.depthBytes) : nil
    return C14_8CapturedKeyframe(
      depthData: depth?.data,
      depthHeight: depth?.height,
      depthWidth: depth?.width,
      sample: sample
    )
  }

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    frameCounter += 1
    let transform = frame.camera.transform
    let position = SIMD3(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
    let rotation = simd_quatf(transform)
    let motion = Self.motionScore(
      position: position,
      rotation: rotation,
      timestamp: frame.timestamp,
      previousPosition: previousPosition,
      previousRotation: previousRotation,
      previousTimestamp: previousTimestamp
    )
    previousPosition = position
    previousRotation = rotation
    previousTimestamp = frame.timestamp
    latestMotionScoreMillionths = motion
    guard frameCounter % resourcePolicy.analysisStride == 0 else { return }
    let quality = Self.quality(frame.capturedImage, evaluator: qualityEvaluator)
    let spatialEvidence = spatialEvidence(for: frame)
    latestSpatialEvidence = spatialEvidence
    let forward = -SIMD3(transform.columns.2.x, transform.columns.2.y, transform.columns.2.z)
    telemetryHandler?(
      C14_8LiveTelemetry(
        ambientIntensity: frame.lightEstimate.map { Int($0.ambientIntensity.rounded()) },
        blurScoreMillionths: quality.blurScoreMillionths,
        coverageCellId: Self.coverageCell(forward: forward),
        exposureScoreMillionths: quality.exposureScoreMillionths,
        motionScoreMillionths: motion,
        spatialEvidence: spatialEvidence,
        trackingState: Self.tracking(frame.camera.trackingState)
      ))
  }

  func sessionWasInterrupted(_ session: ARSession) {
    eventHandler?(.interrupted)
  }

  func sessionInterruptionEnded(_ session: ARSession) {
    eventHandler?(.interruptionEnded)
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    eventHandler?(.runtimeFailure)
  }

  private static func tracking(_ state: ARCamera.TrackingState) -> C14_8TrackingState {
    switch state {
    case .normal: .normal
    case .notAvailable: .unavailable
    case .limited(.initializing), .limited(.relocalizing): .limitedInitializing
    case .limited(.excessiveMotion): .limitedMotion
    case .limited(.insufficientFeatures): .limitedFeatures
    @unknown default: .unavailable
    }
  }

  private func spatialEvidence(for frame: ARFrame) -> C14_10LiveSpatialEvidence {
    let transform = frame.camera.transform
    let position = SIMD3(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
    let featureIds = Set(frame.rawFeaturePoints?.identifiers ?? [])
    guard let previous = retainedObservations.last else {
      return C14_10LiveSpatialEvidence(
        connectedToPrevious: false,
        featurePointCount: featureIds.count,
        loopClosureCandidate: false,
        overlapScoreMillionths: 0,
        parallaxScoreMillionths: 0,
        telemetryTimestampMicroseconds: max(0, Int64((frame.timestamp * 1_000_000).rounded())),
        trajectorySpanMicrometres: 0,
        trajectoryTravelMicrometres: 0,
        translationFromPreviousMicrometres: 0
      )
    }
    let translation = max(0, Self.micro(simd_distance(position, previous.position)))
    let overlap = Self.overlapScore(left: featureIds, right: previous.featureIds)
    let connected =
      featureIds.count >= C14_10SpatialCapturePolicy.minimumFeaturePointCount
      && overlap >= C14_10SpatialCapturePolicy.minimumOverlapScoreMillionths
    let first = retainedObservations[0]
    let distanceFromFirst = max(0, Self.micro(simd_distance(position, first.position)))
    let span = max(previous.trajectorySpanMicrometres, distanceFromFirst)
    let travel = min(10_000_000_000, previous.trajectoryTravelMicrometres + translation)
    let firstOverlap = Self.overlapScore(left: featureIds, right: first.featureIds)
    let loopClosure =
      retainedObservations.count >= C14_10SpatialCapturePolicy.minimumKeyframesPerRoom - 1
      && span >= C14_10SpatialCapturePolicy.minimumTrajectorySpanMicrometres
      && distanceFromFirst <= C14_10SpatialCapturePolicy.minimumLoopClosureDistanceMicrometres
      && firstOverlap >= C14_10SpatialCapturePolicy.minimumOverlapScoreMillionths
    let parallax = min(
      1_000_000,
      Int(
        (Double(translation) / 400_000)
          * Double(overlap)
      )
    )
    return C14_10LiveSpatialEvidence(
      connectedToPrevious: connected,
      featurePointCount: featureIds.count,
      loopClosureCandidate: loopClosure,
      overlapScoreMillionths: overlap,
      parallaxScoreMillionths: max(0, parallax),
      telemetryTimestampMicroseconds: max(0, Int64((frame.timestamp * 1_000_000).rounded())),
      trajectorySpanMicrometres: span,
      trajectoryTravelMicrometres: travel,
      translationFromPreviousMicrometres: translation
    )
  }

  private func retain(frame: ARFrame, spatialEvidence: C14_10LiveSpatialEvidence) {
    let transform = frame.camera.transform
    retainedObservations.append(
      C14_10RetainedObservation(
        featureIds: Set(frame.rawFeaturePoints?.identifiers ?? []),
        position: SIMD3(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z),
        trajectorySpanMicrometres: spatialEvidence.trajectorySpanMicrometres,
        trajectoryTravelMicrometres: spatialEvidence.trajectoryTravelMicrometres
      )
    )
  }

  private static func overlapScore(left: Set<UInt64>, right: Set<UInt64>) -> Int {
    let denominator = min(left.count, right.count)
    guard denominator > 0 else { return 0 }
    return min(1_000_000, left.intersection(right).count * 1_000_000 / denominator)
  }

  private static func coverageCell(forward: SIMD3<Float>) -> String {
    var angle = atan2(Double(forward.x), Double(-forward.z))
    if angle < 0 { angle += Double.pi * 2 }
    let sectorIndex = Int((angle / (Double.pi * 2) * 8).rounded()) % 8
    let sector = C14_8HorizontalSector.allCases[sectorIndex]
    let band: C14_8VerticalBand =
      forward.y > 0.25 ? .upper : (forward.y < -0.25 ? .lower : .middle)
    return "\(sector.rawValue):\(band.rawValue)"
  }

  private static func quality(
    _ pixelBuffer: CVPixelBuffer,
    evaluator: C8CaptureQualityEvaluator
  ) -> C8CapturedMediaQuality {
    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
    guard CVPixelBufferGetPlaneCount(pixelBuffer) > 0,
      let base = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0)
    else {
      return evaluator.evaluate(luma: [], width: 0, height: 0)
    }
    let sourceWidth = CVPixelBufferGetWidthOfPlane(pixelBuffer, 0)
    let sourceHeight = CVPixelBufferGetHeightOfPlane(pixelBuffer, 0)
    let stride = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0)
    let bytes = base.assumingMemoryBound(to: UInt8.self)
    let targetWidth = 64
    let targetHeight = 64
    var luma = [UInt8](repeating: 0, count: targetWidth * targetHeight)
    for y in 0..<targetHeight {
      let sourceY = min(sourceHeight - 1, y * sourceHeight / targetHeight)
      for x in 0..<targetWidth {
        let sourceX = min(sourceWidth - 1, x * sourceWidth / targetWidth)
        luma[y * targetWidth + x] = bytes[sourceY * stride + sourceX]
      }
    }
    return evaluator.evaluate(luma: luma, width: targetWidth, height: targetHeight)
  }

  private static func motionScore(
    position: SIMD3<Float>,
    rotation: simd_quatf,
    timestamp: TimeInterval,
    previousPosition: SIMD3<Float>?,
    previousRotation: simd_quatf?,
    previousTimestamp: TimeInterval?
  ) -> Int {
    guard let previousPosition, let previousRotation, let previousTimestamp,
      timestamp > previousTimestamp
    else { return 0 }
    let elapsed = Float(timestamp - previousTimestamp)
    let metresPerSecond = simd_distance(position, previousPosition) / elapsed
    let quaternionDot = min(1, max(0, abs(simd_dot(rotation.vector, previousRotation.vector))))
    let radiansPerSecond = (2 * acos(quaternionDot)) / elapsed
    let translationScore = Int(metresPerSecond * 1_000_000)
    let rotationScore = Int((radiansPerSecond / .pi) * 1_000_000)
    return min(1_000_000, max(0, max(translationScore, rotationScore)))
  }

  private static func depthBytes(_ depth: ARDepthData) -> (data: Data, height: Int, width: Int) {
    let buffer = depth.depthMap
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    let width = CVPixelBufferGetWidth(buffer)
    let height = CVPixelBufferGetHeight(buffer)
    guard CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_DepthFloat32 else {
      return (Data(), height, width)
    }
    let stride = CVPixelBufferGetBytesPerRow(buffer)
    guard let base = CVPixelBufferGetBaseAddress(buffer) else {
      return (Data(), height, width)
    }
    var data = Data(capacity: width * height * MemoryLayout<Float32>.size)
    for row in 0..<height {
      data.append(
        base.advanced(by: row * stride).assumingMemoryBound(to: UInt8.self), count: width * 4)
    }
    return (data, height, width)
  }

  private static func micro(_ value: Float) -> Int64 {
    Int64((Double(value) * 1_000_000).rounded())
  }
  private static func nano(_ value: Float) -> Int64 {
    Int64((Double(value) * 1_000_000_000).rounded())
  }
}

#if DEBUG
  @MainActor
  final class C14_8FixtureGuidedCaptureEngine: C14_8GuidedCaptureServing {
    let previewSession: ARSession? = nil
    let syntheticFixture = true
    private var telemetryHandler: (@MainActor (C14_8LiveTelemetry) -> Void)?
    private var retainedCount = 0

    func applyResourcePolicy(_ policy: C14_10ResourcePolicy) {
      _ = policy
    }

    func start(
      telemetry: @escaping @MainActor (C14_8LiveTelemetry) -> Void,
      events: @escaping @MainActor (C14_8GuidedCaptureEvent) -> Void
    ) throws {
      telemetryHandler = telemetry
      retainedCount = 0
      telemetry(
        C14_8LiveTelemetry(
          ambientIntensity: nil,
          blurScoreMillionths: 800_000,
          coverageCellId: "north:middle",
          exposureScoreMillionths: 900_000,
          motionScoreMillionths: 0,
          spatialEvidence: C14_10LiveSpatialEvidence(
            connectedToPrevious: retainedCount > 0,
            featurePointCount: 240,
            loopClosureCandidate: retainedCount >= 7,
            overlapScoreMillionths: retainedCount > 0 ? 620_000 : 0,
            parallaxScoreMillionths: retainedCount > 0 ? 240_000 : 0,
            telemetryTimestampMicroseconds: Int64(retainedCount + 1) * 2_100_000,
            trajectorySpanMicrometres: Int64(retainedCount) * 220_000,
            trajectoryTravelMicrometres: Int64(retainedCount) * 300_000,
            translationFromPreviousMicrometres: retainedCount > 0 ? 300_000 : 0
          ),
          trackingState: .normal
        ))
    }

    func stop() {}

    func captureKeyframe(
      to destination: URL,
      localIdentifier: UUID,
      roomId: UUID,
      segmentId: UUID,
      captureStartedAt: Date,
      retentionMode: C14_10KeyframeRetentionMode,
      zoneId: UUID
    ) async throws -> C14_8CapturedKeyframe {
      let renderer = UIGraphicsImageRenderer(size: CGSize(width: 1_280, height: 960))
      let image = renderer.image { context in
        UIColor.systemIndigo.setFill()
        context.fill(CGRect(x: 0, y: 0, width: 1_280, height: 960))
        let text = "SYNTHETIC C14.8 FIXTURE\nNOT PHYSICAL CAMERA OR DEPTH"
        text.draw(
          at: CGPoint(x: 90, y: 400),
          withAttributes: [
            .font: UIFont.monospacedSystemFont(ofSize: 44, weight: .bold),
            .foregroundColor: UIColor.white,
          ]
        )
      }
      guard let data = image.jpegData(compressionQuality: 0.9) else {
        throw C14_8GuidedCaptureEngineError.encodingFailed
      }
      try data.write(to: destination, options: [.atomic, .completeFileProtection])
      let spatial = C14_10LiveSpatialEvidence(
        connectedToPrevious: retainedCount > 0,
        featurePointCount: 240,
        loopClosureCandidate: retainedCount >= 7,
        overlapScoreMillionths: retainedCount > 0 ? 620_000 : 0,
        parallaxScoreMillionths: retainedCount > 0 ? 240_000 : 0,
        telemetryTimestampMicroseconds: Int64(retainedCount + 1) * 2_100_000,
        trajectorySpanMicrometres: Int64(retainedCount) * 220_000,
        trajectoryTravelMicrometres: Int64(retainedCount) * 300_000,
        translationFromPreviousMicrometres: retainedCount > 0 ? 300_000 : 0
      )
      retainedCount += 1
      return C14_8CapturedKeyframe(
        depthData: nil,
        depthHeight: nil,
        depthWidth: nil,
        sample: C14_8LocalCameraSample(
          ambientIntensity: nil,
          blurScoreMillionths: 800_000,
          cameraIntrinsicsMicropixels: C14_8CameraIntrinsics(
            cx: 640_000_000,
            cy: 480_000_000,
            fx: 900_000_000,
            fy: 900_000_000,
            imageHeightPixels: 960,
            imageWidthPixels: 1_280
          ),
          connectedToPrevious: spatial.connectedToPrevious,
          exposureScoreMillionths: 900_000,
          featurePointCount: spatial.featurePointCount,
          intrinsicsModel: "pinhole-native-camera-raster",
          loopClosureCandidate: spatial.loopClosureCandidate,
          motionScoreMillionths: 0,
          orientation: "portrait",
          overlapScoreMillionths: spatial.overlapScoreMillionths,
          parallaxScoreMillionths: spatial.parallaxScoreMillionths,
          poseTransform: "camera-to-world",
          quaternionOrder: "x-y-z-w",
          quaternionNanounits: [0, 0, 0, 1_000_000_000],
          roomId: roomId,
          sampleId: UUID(),
          segmentId: segmentId,
          sourceLocalIdentifier: localIdentifier,
          sourceTimestampMicroseconds: 1_000_000,
          timestampMicroseconds: max(
            0, Int64(Date().timeIntervalSince(captureStartedAt) * 1_000_000)),
          trackingState: .normal,
          trajectorySpanMicrometres: spatial.trajectorySpanMicrometres,
          trajectoryTravelMicrometres: spatial.trajectoryTravelMicrometres,
          translationFromPreviousMicrometres: spatial.translationFromPreviousMicrometres,
          translationMicrometres: C14_8Translation(
            x: Int64(retainedCount) * 300_000,
            y: 1_500_000,
            z: 0
          ),
          retentionMode: retentionMode,
          zoneId: zoneId
        )
      )
    }
  }
#endif

private struct C14_10RetainedObservation {
  let featureIds: Set<UInt64>
  let position: SIMD3<Float>
  let trajectorySpanMicrometres: Int64
  let trajectoryTravelMicrometres: Int64
}

struct C14_8ARPreview: UIViewRepresentable {
  let session: ARSession

  func makeUIView(context: Context) -> ARSCNView {
    let view = ARSCNView(frame: .zero)
    view.session = session
    view.automaticallyUpdatesLighting = false
    return view
  }

  func updateUIView(_ view: ARSCNView, context: Context) {
    if view.session !== session { view.session = session }
  }
}
