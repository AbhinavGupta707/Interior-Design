@preconcurrency import AVFoundation
import CoreGraphics
import CoreVideo
import Foundation
import SwiftUI
import UIKit

enum C8CameraEvent: Equatable, Sendable {
  case interruptionEnded
  case interrupted
  case resourcePressure
  case runtimeFailure
  case thermalPressure
}

struct C8CameraCaptureArtifact: Equatable, Sendable {
  let containsDepthData: Bool
  let mimeType: C8MediaMIMEType
  let origin: C8CaptureEvidenceOrigin
}

enum C8CameraCaptureError: Error, Equatable, Sendable {
  case alreadyRecording
  case captureFailed
  case configurationFailed
  case depthUnavailable
  case fixtureEncodingFailed
  case notPrepared
  case notRecording
  case resourcePressure
}

@MainActor
protocol C8CameraCaptureServing: AnyObject {
  var previewSession: AVCaptureSession? { get }
  var syntheticFixture: Bool { get }

  func capturePhoto(to destination: URL) async throws -> C8CameraCaptureArtifact
  func configure(depthRequested: Bool, eventHandler: @escaping @MainActor (C8CameraEvent) -> Void)
    throws
  func start() async throws
  func startVideo(to destination: URL) throws
  func stop() async
  func stopVideo() async throws -> C8CameraCaptureArtifact
}

@MainActor
final class C8AVFoundationCameraEngine: NSObject, C8CameraCaptureServing {
  let syntheticFixture = false

  private let sessionRunner = C8CaptureSessionRunner()
  private let movieOutput = AVCaptureMovieFileOutput()
  private let photoOutput = AVCapturePhotoOutput()
  private var depthEnabled = false
  private var eventHandler: (@MainActor (C8CameraEvent) -> Void)?
  private var notificationTokens: [NSObjectProtocol] = []
  private var photoDelegate: C8PhotoCaptureDelegate?
  private var movieDelegate: C8MovieCaptureDelegate?
  private var pressureObservation: NSKeyValueObservation?
  private var videoDevice: AVCaptureDevice?

  var previewSession: AVCaptureSession? { sessionRunner.session }

  func configure(
    depthRequested: Bool,
    eventHandler: @escaping @MainActor (C8CameraEvent) -> Void
  ) throws {
    guard let session = previewSession else { throw C8CameraCaptureError.configurationFailed }
    self.eventHandler = eventHandler
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    session.sessionPreset = .high
    for input in session.inputs { session.removeInput(input) }
    for output in session.outputs { session.removeOutput(output) }

    let preferredTypes: [AVCaptureDevice.DeviceType] = [
      .builtInTripleCamera,
      .builtInDualWideCamera,
      .builtInDualCamera,
      .builtInWideAngleCamera,
    ]
    let discovery = AVCaptureDevice.DiscoverySession(
      deviceTypes: preferredTypes,
      mediaType: .video,
      position: .back
    )
    let device =
      discovery.devices.first(where: { device in
        !depthRequested || device.formats.contains(where: { !$0.supportedDepthDataFormats.isEmpty })
      }) ?? discovery.devices.first
    guard let device,
      let input = try? AVCaptureDeviceInput(device: device),
      session.canAddInput(input),
      session.canAddOutput(photoOutput),
      session.canAddOutput(movieOutput)
    else { throw C8CameraCaptureError.configurationFailed }
    session.addInput(input)
    session.addOutput(photoOutput)
    session.addOutput(movieOutput)
    movieOutput.maxRecordedDuration = CMTime(seconds: 90, preferredTimescale: 600)
    movieOutput.maxRecordedFileSize = 1_073_741_824
    depthEnabled = depthRequested && photoOutput.isDepthDataDeliverySupported
    if depthRequested && !depthEnabled { throw C8CameraCaptureError.depthUnavailable }
    photoOutput.isDepthDataDeliveryEnabled = depthEnabled
    videoDevice = device
    observe(session: session, device: device)
  }

  func start() async throws {
    guard let session = previewSession, !session.inputs.isEmpty else {
      throw C8CameraCaptureError.notPrepared
    }
    guard ProcessInfo.processInfo.thermalState != .critical else {
      eventHandler?(.thermalPressure)
      throw C8CameraCaptureError.resourcePressure
    }
    await sessionRunner.start()
  }

  func capturePhoto(to destination: URL) async throws -> C8CameraCaptureArtifact {
    guard let session = previewSession, session.isRunning else {
      throw C8CameraCaptureError.notPrepared
    }
    let usesHEVC = photoOutput.availablePhotoCodecTypes.contains(.hevc)
    let settings =
      usesHEVC
      ? AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.hevc])
      : AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
    settings.isDepthDataDeliveryEnabled = depthEnabled
    settings.photoQualityPrioritization = .balanced
    let mimeType: C8MediaMIMEType = usesHEVC ? .heic : .jpeg
    return try await withCheckedThrowingContinuation { continuation in
      let delegate = C8PhotoCaptureDelegate(
        destination: destination,
        mimeType: mimeType,
        continuation: continuation
      ) { [weak self] in
        Task { @MainActor in self?.photoDelegate = nil }
      }
      photoDelegate = delegate
      photoOutput.capturePhoto(with: settings, delegate: delegate)
    }
  }

  func startVideo(to destination: URL) throws {
    guard let session = previewSession, session.isRunning else {
      throw C8CameraCaptureError.notPrepared
    }
    guard !movieOutput.isRecording else { throw C8CameraCaptureError.alreadyRecording }
    let delegate = C8MovieCaptureDelegate(destination: destination) { [weak self] in
      Task { @MainActor in self?.movieDelegate = nil }
    }
    movieDelegate = delegate
    movieOutput.startRecording(to: destination, recordingDelegate: delegate)
  }

  func stopVideo() async throws -> C8CameraCaptureArtifact {
    guard movieOutput.isRecording, let delegate = movieDelegate else {
      throw C8CameraCaptureError.notRecording
    }
    return try await withCheckedThrowingContinuation { continuation in
      delegate.install(continuation: continuation)
      movieOutput.stopRecording()
    }
  }

  func stop() async {
    if movieOutput.isRecording { movieOutput.stopRecording() }
    await sessionRunner.stop()
  }

  private func observe(session: AVCaptureSession, device: AVCaptureDevice) {
    for token in notificationTokens { NotificationCenter.default.removeObserver(token) }
    notificationTokens.removeAll()
    let centre = NotificationCenter.default
    notificationTokens.append(
      centre.addObserver(
        forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: .main
      ) {
        [weak self] notification in
        let rawReason = notification.userInfo?[AVCaptureSessionInterruptionReasonKey] as? NSNumber
        let reason = rawReason.flatMap {
          AVCaptureSession.InterruptionReason(rawValue: $0.intValue)
        }
        Task { @MainActor in
          if reason == .videoDeviceNotAvailableDueToSystemPressure {
            self?.eventHandler?(.resourcePressure)
          } else {
            self?.eventHandler?(.interrupted)
          }
        }
      }
    )
    notificationTokens.append(
      centre.addObserver(
        forName: AVCaptureSession.interruptionEndedNotification, object: session, queue: .main
      ) {
        [weak self] _ in
        Task { @MainActor in self?.eventHandler?(.interruptionEnded) }
      }
    )
    notificationTokens.append(
      centre.addObserver(
        forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: .main
      ) {
        [weak self] _ in
        Task { @MainActor in self?.eventHandler?(.runtimeFailure) }
      }
    )
    notificationTokens.append(
      centre.addObserver(
        forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main
      ) {
        [weak self] _ in
        Task { @MainActor in
          if ProcessInfo.processInfo.thermalState == .serious
            || ProcessInfo.processInfo.thermalState == .critical
          {
            self?.eventHandler?(.thermalPressure)
          }
        }
      }
    )
    pressureObservation = device.observe(\.systemPressureState, options: [.new]) {
      [weak self] device, _ in
      let level = device.systemPressureState.level
      guard level == .serious || level == .critical || level == .shutdown else { return }
      Task { @MainActor in self?.eventHandler?(.resourcePressure) }
    }
  }

  deinit {
    for token in notificationTokens { NotificationCenter.default.removeObserver(token) }
  }
}

private final class C8CaptureSessionRunner: @unchecked Sendable {
  let session = AVCaptureSession()

  private let queue = DispatchQueue(label: "com.homedesignstudio.capture.c8-camera-session")

  func start() async {
    await withCheckedContinuation { continuation in
      queue.async { [session] in
        if !session.isRunning { session.startRunning() }
        continuation.resume()
      }
    }
  }

  func stop() async {
    await withCheckedContinuation { continuation in
      queue.async { [session] in
        if session.isRunning { session.stopRunning() }
        continuation.resume()
      }
    }
  }
}

private final class C8PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate,
  @unchecked Sendable
{
  private let continuation: CheckedContinuation<C8CameraCaptureArtifact, any Error>
  private let destination: URL
  private let mimeType: C8MediaMIMEType
  private let onFinish: @Sendable () -> Void
  private let lock = NSLock()
  private var finished = false

  init(
    destination: URL,
    mimeType: C8MediaMIMEType,
    continuation: CheckedContinuation<C8CameraCaptureArtifact, any Error>,
    onFinish: @escaping @Sendable () -> Void
  ) {
    self.destination = destination
    self.mimeType = mimeType
    self.continuation = continuation
    self.onFinish = onFinish
  }

  func photoOutput(
    _ output: AVCapturePhotoOutput,
    didFinishProcessingPhoto photo: AVCapturePhoto,
    error: (any Error)?
  ) {
    lock.lock()
    defer { lock.unlock() }
    guard !finished else { return }
    finished = true
    defer { onFinish() }
    guard error == nil, let data = photo.fileDataRepresentation() else {
      continuation.resume(throwing: C8CameraCaptureError.captureFailed)
      return
    }
    do {
      try data.write(to: destination, options: [.atomic, .completeFileProtection])
      continuation.resume(
        returning: C8CameraCaptureArtifact(
          containsDepthData: photo.depthData != nil,
          mimeType: mimeType,
          origin: .physicalCamera
        )
      )
    } catch {
      continuation.resume(throwing: C8CameraCaptureError.captureFailed)
    }
  }
}

private final class C8MovieCaptureDelegate: NSObject, AVCaptureFileOutputRecordingDelegate,
  @unchecked Sendable
{
  private let destination: URL
  private let onFinish: @Sendable () -> Void
  private let lock = NSLock()
  private var continuation: CheckedContinuation<C8CameraCaptureArtifact, any Error>?
  private var result: Result<C8CameraCaptureArtifact, any Error>?

  init(destination: URL, onFinish: @escaping @Sendable () -> Void) {
    self.destination = destination
    self.onFinish = onFinish
  }

  func install(continuation: CheckedContinuation<C8CameraCaptureArtifact, any Error>) {
    lock.lock()
    defer { lock.unlock() }
    if let result {
      continuation.resume(with: result)
    } else {
      self.continuation = continuation
    }
  }

  func fileOutput(
    _ output: AVCaptureFileOutput,
    didFinishRecordingTo outputFileURL: URL,
    from connections: [AVCaptureConnection],
    error: (any Error)?
  ) {
    let recordingSucceeded =
      (error as NSError?)?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool
    let value: Result<C8CameraCaptureArtifact, any Error> =
      if error == nil || recordingSucceeded == true {
        .success(
          C8CameraCaptureArtifact(
            containsDepthData: false,
            mimeType: .quickTime,
            origin: .physicalCamera
          )
        )
      } else {
        .failure(C8CameraCaptureError.captureFailed)
      }
    lock.lock()
    result = value
    let active = continuation
    continuation = nil
    lock.unlock()
    active?.resume(with: value)
    onFinish()
  }
}

@MainActor
final class C8SyntheticCameraEngine: C8CameraCaptureServing {
  let previewSession: AVCaptureSession? = nil
  let syntheticFixture = true

  private var eventHandler: (@MainActor (C8CameraEvent) -> Void)?
  private var recordingDestination: URL?

  func configure(
    depthRequested: Bool,
    eventHandler: @escaping @MainActor (C8CameraEvent) -> Void
  ) throws {
    guard !depthRequested else { throw C8CameraCaptureError.depthUnavailable }
    self.eventHandler = eventHandler
  }

  func start() async throws {}
  func stop() async { recordingDestination = nil }

  func capturePhoto(to destination: URL) async throws -> C8CameraCaptureArtifact {
    let size = CGSize(width: 640, height: 480)
    let renderer = UIGraphicsImageRenderer(size: size)
    let image = renderer.image { context in
      UIColor.systemIndigo.setFill()
      context.fill(CGRect(origin: .zero, size: size))
      UIColor.white.withAlphaComponent(0.3).setStroke()
      for value in stride(from: 0, through: 640, by: 40) {
        context.cgContext.move(to: CGPoint(x: value, y: 0))
        context.cgContext.addLine(to: CGPoint(x: value, y: 480))
      }
      for value in stride(from: 0, through: 480, by: 40) {
        context.cgContext.move(to: CGPoint(x: 0, y: value))
        context.cgContext.addLine(to: CGPoint(x: 640, y: value))
      }
      context.cgContext.strokePath()
      let title = "SYNTHETIC SIMULATOR FIXTURE"
      let subtitle = "NOT CAMERA · NOT DEPTH · RIGHTS-CLEARED"
      let paragraph = NSMutableParagraphStyle()
      paragraph.alignment = .center
      title.draw(
        in: CGRect(x: 30, y: 180, width: 580, height: 50),
        withAttributes: [
          .font: UIFont.boldSystemFont(ofSize: 28),
          .foregroundColor: UIColor.white,
          .paragraphStyle: paragraph,
        ]
      )
      subtitle.draw(
        in: CGRect(x: 30, y: 240, width: 580, height: 40),
        withAttributes: [
          .font: UIFont.monospacedSystemFont(ofSize: 16, weight: .semibold),
          .foregroundColor: UIColor.white,
          .paragraphStyle: paragraph,
        ]
      )
    }
    guard let data = image.pngData() else { throw C8CameraCaptureError.fixtureEncodingFailed }
    try data.write(to: destination, options: [.atomic, .completeFileProtection])
    return C8CameraCaptureArtifact(
      containsDepthData: false,
      mimeType: .png,
      origin: .syntheticSimulatorFixture
    )
  }

  func startVideo(to destination: URL) throws {
    guard recordingDestination == nil else { throw C8CameraCaptureError.alreadyRecording }
    recordingDestination = destination
  }

  func stopVideo() async throws -> C8CameraCaptureArtifact {
    guard let destination = recordingDestination else { throw C8CameraCaptureError.notRecording }
    recordingDestination = nil
    try await C8SyntheticVideoWriter.write(to: destination)
    return C8CameraCaptureArtifact(
      containsDepthData: false,
      mimeType: .quickTime,
      origin: .syntheticSimulatorFixture
    )
  }
}

private enum C8SyntheticVideoWriter {
  @MainActor
  static func write(to destination: URL) async throws {
    let writer = try AVAssetWriter(outputURL: destination, fileType: .mov)
    let input = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoHeightKey: 240,
        AVVideoWidthKey: 320,
      ]
    )
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferHeightKey as String: 240,
        kCVPixelBufferWidthKey as String: 320,
      ]
    )
    guard writer.canAdd(input) else { throw C8CameraCaptureError.fixtureEncodingFailed }
    writer.add(input)
    guard writer.startWriting() else { throw C8CameraCaptureError.fixtureEncodingFailed }
    writer.startSession(atSourceTime: .zero)
    guard let pool = adaptor.pixelBufferPool else {
      throw C8CameraCaptureError.fixtureEncodingFailed
    }
    for frame in 0..<30 {
      var readinessChecks = 0
      while !input.isReadyForMoreMediaData {
        guard writer.status == .writing, readinessChecks < 1_000 else {
          throw C8CameraCaptureError.fixtureEncodingFailed
        }
        readinessChecks += 1
        try await Task.sleep(for: .milliseconds(2))
      }
      var buffer: CVPixelBuffer?
      guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess,
        let buffer
      else { throw C8CameraCaptureError.fixtureEncodingFailed }
      CVPixelBufferLockBaseAddress(buffer, [])
      if let base = CVPixelBufferGetBaseAddress(buffer) {
        let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
        let height = CVPixelBufferGetHeight(buffer)
        let drawingHeight = CGFloat(height)
        let drawingWidth = CGFloat(320)
        guard
          let context = CGContext(
            data: base,
            width: 320,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue
              | CGImageAlphaInfo.premultipliedFirst.rawValue
          )
        else {
          CVPixelBufferUnlockBaseAddress(buffer, [])
          throw C8CameraCaptureError.fixtureEncodingFailed
        }
        let testBarColors: [CGColor] = [
          UIColor.systemRed.cgColor,
          UIColor.systemYellow.cgColor,
          UIColor.systemGreen.cgColor,
          UIColor.systemCyan.cgColor,
          UIColor.systemBlue.cgColor,
          UIColor.systemPurple.cgColor,
        ]
        let barWidth = drawingWidth / CGFloat(testBarColors.count)
        for (index, color) in testBarColors.enumerated() {
          context.setFillColor(color)
          context.fill(
            CGRect(
              x: CGFloat(index) * barWidth,
              y: 0,
              width: barWidth + 1,
              height: drawingHeight
            )
          )
        }
        let motionOffset = CGFloat(frame)
        context.setStrokeColor(UIColor.white.cgColor)
        context.setLineWidth(12)
        context.move(to: CGPoint(x: 12 + motionOffset, y: 12))
        context.addLine(to: CGPoint(x: 308 - motionOffset, y: drawingHeight - 12))
        context.move(to: CGPoint(x: 308 - motionOffset, y: 12))
        context.addLine(to: CGPoint(x: 12 + motionOffset, y: drawingHeight - 12))
        context.strokePath()
      }
      CVPixelBufferUnlockBaseAddress(buffer, [])
      guard
        adaptor.append(
          buffer, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: 15))
      else {
        throw C8CameraCaptureError.fixtureEncodingFailed
      }
    }
    input.markAsFinished()
    await withCheckedContinuation { continuation in
      writer.finishWriting { continuation.resume() }
    }
    guard writer.status == .completed else { throw C8CameraCaptureError.fixtureEncodingFailed }
  }
}

struct C8CameraPreview: UIViewRepresentable {
  let session: AVCaptureSession

  func makeUIView(context: Context) -> C8PreviewView {
    let view = C8PreviewView()
    view.previewLayer.session = session
    view.previewLayer.videoGravity = .resizeAspectFill
    return view
  }

  func updateUIView(_ uiView: C8PreviewView, context: Context) {
    uiView.previewLayer.session = session
  }
}

final class C8PreviewView: UIView {
  override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
  var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}
