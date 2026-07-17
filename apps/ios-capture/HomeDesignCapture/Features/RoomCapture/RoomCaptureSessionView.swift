import SwiftUI

@MainActor
struct RoomCaptureSessionView<CaptureSurface: View>: View {
  @ObservedObject var coordinator: RoomCaptureCoordinator
  @State private var roomLabel = ""
  @State private var story = 0
  private let captureSurface: () -> CaptureSurface

  init(
    coordinator: RoomCaptureCoordinator,
    @ViewBuilder captureSurface: @escaping () -> CaptureSurface
  ) {
    self.coordinator = coordinator
    self.captureSurface = captureSurface
  }

  var body: some View {
    Group {
      switch coordinator.state {
      case .permission(let phase, _):
        permissionView(phase)
      case .ready(let run):
        readyView(run)
      case .scanning:
        scanningView
      case .interrupted:
        recoveryView(
          title: "Capture interrupted",
          message:
            "Return to the scanned area while the app attempts bounded relocalisation. Restart if alignment cannot be recovered."
        )
      case .relocalising:
        recoveryView(
          title: "Relocalising",
          message:
            "Move back to a previously scanned area. This attempt is bounded and is not guaranteed to recover the world origin."
        )
      case .roomReview(_, let room):
        roomReview(room)
      case .structureReview(_, let structure):
        structureReview(structure)
      case .packaging:
        statusView("Preparing immutable capture artifacts")
      case .offline:
        statusView("Capture package ready offline")
      case .pausedUpload:
        statusView("Capture upload paused")
      case .uploading:
        statusView("Uploading capture artifacts")
      case .processing:
        statusView("Capture is being processed")
      case .proposed:
        statusView("Capture proposal ready for review")
      case .abstained(let input):
        statusView("Capture abstained: \(input.message)")
      case .cancelled:
        statusView("Capture cancelled")
      case .failed(let failure):
        statusView(
          "Capture stopped safely: \(failure.rawValue). No incompatible rooms were joined.")
      }
    }
    .navigationTitle("Room capture")
  }

  private func permissionView(_ phase: RoomCapturePermissionPhase) -> some View {
    ContentUnavailableView(
      "Capture unavailable",
      systemImage: "camera.badge.ellipsis",
      description: Text(permissionMessage(phase))
    )
  }

  private func readyView(_ run: RoomCaptureRun) -> some View {
    VStack(spacing: 20) {
      Text(run.completedRooms.isEmpty ? "Ready to scan" : "Room saved")
        .font(.title2.bold())
      Text("\(run.completedRooms.count) compatible room(s) in this world origin")
        .foregroundStyle(.secondary)
      Button(run.completedRooms.isEmpty ? "Start room" : "Scan next room") {
        Task { await coordinator.startRoom(includeUSDZ: true) }
      }
      .buttonStyle(.borderedProminent)
      if run.mode == .structure, run.completedRooms.count >= 2 {
        Button("Review connected structure") {
          Task { await coordinator.reviewStructure() }
        }
        .buttonStyle(.bordered)
      }
    }
    .padding()
  }

  private var scanningView: some View {
    ZStack(alignment: .bottom) {
      captureSurface()
        .accessibilityLabel("Live RoomPlan capture surface")
      Button("Finish this room") {
        Task { await coordinator.stopCurrentRoom() }
      }
      .buttonStyle(.borderedProminent)
      .padding()
    }
  }

  private func roomReview(_ room: RoomCaptureRoomEvidence) -> some View {
    Form {
      if room.isSyntheticFixture {
        Text("Synthetic fixture — not RoomPlan, LiDAR, camera, or physical-device evidence")
          .foregroundStyle(.orange)
      }
      Section("Observed capture") {
        LabeledContent("Surfaces", value: "\(room.surfaces.count)")
        LabeledContent("Objects", value: "\(room.objects.count)")
        LabeledContent("Room sequence", value: "\(room.sequence)")
      }
      Section("Review") {
        TextField("Optional room label", text: $roomLabel)
        Stepper("Story \(story)", value: $story, in: -20...200)
      }
      Section {
        Button("Accept room") {
          coordinator.acceptRoom(
            userLabel: roomLabel.isEmpty ? nil : roomLabel,
            story: story
          )
        }
        Button("Rescan room", role: .destructive) {
          Task { await coordinator.rejectRoom() }
        }
      }
    }
    .onChange(of: room.id, initial: true) {
      roomLabel = room.userLabel ?? ""
      story = room.story
    }
  }

  private func structureReview(_ structure: RoomCaptureStructureEvidence) -> some View {
    Form {
      if structure.isSyntheticFixture {
        Text("Synthetic fixture — not a physical multi-room capture")
          .foregroundStyle(.orange)
      }
      LabeledContent("Connected rooms", value: "\(structure.rooms.count)")
      Text("All rooms passed compatible-world-origin enforcement before this review.")
        .foregroundStyle(.secondary)
      Button("Accept structure") { coordinator.acceptStructure() }
        .buttonStyle(.borderedProminent)
    }
  }

  private func recoveryView(title: String, message: String) -> some View {
    ContentUnavailableView {
      Label(title, systemImage: "arrow.trianglehead.2.clockwise.rotate.90")
    } description: {
      Text(message)
    } actions: {
      Button("Restart capture safely") {
        Task { await coordinator.safeRestart() }
      }
      .buttonStyle(.borderedProminent)
    }
  }

  private func statusView(_ message: String) -> some View {
    ContentUnavailableView(message, systemImage: "cube.transparent")
  }

  private func permissionMessage(_ phase: RoomCapturePermissionPhase) -> String {
    switch phase {
    case .cameraDenied:
      "Camera permission was denied. Use Settings or continue with plans, photos, and manual measurements."
    case .cameraNotDetermined:
      "Camera permission has not been requested."
    case .cameraRestricted:
      "Camera access is restricted on this device. Use the manual evidence route."
    case .checking:
      "Checking RoomPlan support before camera permission."
    case .unsupported(.roomPlanUnsupported):
      "RoomPlan is not supported on this physical device. Use plans, photos, and manual measurements."
    case .unsupported(.simulatorUnsupported):
      "Simulator can test these application states but cannot provide camera, LiDAR, AR tracking, or RoomPlan evidence."
    }
  }
}
