import Foundation

@main struct BeaconVoiceDiagnosticsTests {
  static func main() throws {
    let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    var now = Date(timeIntervalSince1970: 1_800_000_000)
    var store = BeaconVoiceTraceStore(directory: directory, now: { now })
    let current = directory.appendingPathComponent("beacon-voice-diagnostics.log")
    let previous = directory.appendingPathComponent("beacon-voice-diagnostics.previous.log")
    for index in 0..<140 {
      try store.append("live count=\(index) " + String(repeating: "x", count: 1200))
      let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
      let sizes = try files.map { try Data(contentsOf: $0).count }
      precondition(files.count <= 2 && sizes.allSatisfy { $0 <= 64 * 1024 })
      precondition(sizes.reduce(0, +) <= 128 * 1024)
    }
    precondition(FileManager.default.fileExists(atPath: previous.path))
    let retained = try Data(contentsOf: current)
    store = BeaconVoiceTraceStore(directory: directory, now: { now })
    try store.append("after relaunch\nnew line\rcleaned")
    let relaunched = try Data(contentsOf: current)
    precondition(relaunched.starts(with: retained))
    precondition(String(decoding: relaunched, as: UTF8.self).contains("after relaunch new line cleaned\n"))
    let beforeOversize = try Data(contentsOf: current)
    try store.append(String(repeating: "x", count: 4097))
    let afterOversize = try Data(contentsOf: current)
    precondition(afterOversize == beforeOversize)
    now.addTimeInterval(24 * 60 * 60 + 1)
    try store.append("new call after expiry")
    precondition(!FileManager.default.fileExists(atPath: previous.path))
    let afterExpiry = try Data(contentsOf: current)
    precondition(!String(decoding: afterExpiry, as: UTF8.self).contains("live count"))
    // Existing oversized/corrupt files cannot defeat the bound or expiry.
    try Data(repeating: 0, count: 128 * 1024).write(to: previous)
    try Data("invalid timestamp".utf8).write(to: current)
    try store.append("after corrupt cache")
    precondition(!FileManager.default.fileExists(atPath: previous.path))
    let afterCorruption = try Data(contentsOf: current)
    precondition(String(decoding: afterCorruption, as: UTF8.self).contains("after corrupt cache"))
    print("Native diagnostics passed: rotation bounds, relaunch retention, line sanitation, oversized entry rejection, expiry and corrupt-cache recovery.")
  }
}
