import AppKit
import CoreFoundation
import WebKit

let settingsNotification = NSNotification.Name("app.enhancedpresence.openSettings")
func isSettingsRequest(_ arguments: [String]) -> Bool { arguments == ["--settings"] }
func hasBundledRuntime(_ resources: URL?) -> Bool {
    guard let resources else { return false }
    let node = resources.appendingPathComponent("runtime/node").path
    let setup = resources.appendingPathComponent("scripts/bundle-setup.mjs").path
    return FileManager.default.isExecutableFile(atPath: node) && FileManager.default.fileExists(atPath: setup)
}
func isManualLaunch(_ arguments: [String], resources: URL?) -> Bool { arguments.isEmpty && hasBundledRuntime(resources) }

func startInstalledService() throws {
    let home = FileManager.default.homeDirectoryForCurrentUser
    let plist = home.appendingPathComponent("Library/LaunchAgents/app.enhancedpresence.engine.plist")
    var info = stat()
    guard lstat(plist.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
          info.st_uid == getuid(), (info.st_mode & 0o077) == 0 else {
        throw NSError(domain: "EnhancedPresenceHelper", code: 1, userInfo: [NSLocalizedDescriptionKey: "The installed companion service was not found. Open Install Enhanced Presence to finish setup."])
    }
    let domain = "gui/\(getuid())", service = "\(domain)/app.enhancedpresence.engine"
    let bootstrap = Process()
    bootstrap.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    bootstrap.arguments = ["bootstrap", domain, plist.path]
    try bootstrap.run(); bootstrap.waitUntilExit()
    if bootstrap.terminationStatus == 0 { return }
    let kickstart = Process()
    kickstart.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    kickstart.arguments = ["kickstart", service]
    try kickstart.run(); kickstart.waitUntilExit()
    guard kickstart.terminationStatus == 0 else {
        throw NSError(domain: "EnhancedPresenceHelper", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not start the installed companion service. Open Install Enhanced Presence to repair setup."])
    }
}
if isSettingsRequest(Array(CommandLine.arguments.dropFirst())) {
    DistributedNotificationCenter.default().postNotificationName(settingsNotification, object: nil, userInfo: nil, deliverImmediately: true)
    exit(0)
}

// Read status on menu open; the engine remains the source of truth for sharing settings.
struct MenuStatus {
    let title: String
    let activity: String
    init(enabled: Bool?, runtime: [String: Any]?, running: Bool, now: Double = Date().timeIntervalSince1970 * 1000) {
        let updated = runtime?["updatedAt"] as? Double ?? 0
        guard running, let enabled, updated > 0, now - updated < 90000, updated <= now + 60000 else {
            title = "Companion unavailable"; activity = "Open Settings to check setup"; return
        }
        guard enabled else { title = "Sharing paused"; activity = "Nothing is shared"; return }
        let source = (runtime?["perf"] as? [String: Any])?["source"] as? String
        title = source == "vencord" ? "Vencord connected" : source == "ipc" ? "Standalone mode" : "Waiting for Vencord"
        if ["vencord", "ipc"].contains(source), let name = (runtime?["activity"] as? [String: Any])?["appName"] as? String, !name.isEmpty {
            activity = "Sharing \(String(name.prefix(80)))"
        } else { activity = "No activity shared" }
    }
}

func settingsURL(_ text: String) -> URL? {
    guard let parts = URLComponents(string: text), parts.scheme == "http", parts.host == "127.0.0.1",
          parts.port == 43822, parts.path == "/", parts.user == nil, parts.password == nil, parts.fragment == nil,
          parts.queryItems?.count == 1, let token = parts.queryItems?.first, token.name == "t",
          token.value?.range(of: "^[a-f0-9]{48}$", options: .regularExpression) != nil else { return nil }
    return parts.url
}

struct VoiceHUDSpeaker: Equatable {
    let id: String
    let name: String
    let speaking: Bool
}

struct VoiceHUDStatus: Equatable {
    let updatedAt: Double
    let channelId: String
    let channelName: String
    let selfMute: Bool
    let selfDeaf: Bool
    let speakers: [VoiceHUDSpeaker]
}

func sameVoiceHUDPresentation(_ left: VoiceHUDStatus?, _ right: VoiceHUDStatus?) -> Bool {
    guard let left, let right else { return left == nil && right == nil }
    return left.channelId == right.channelId && left.channelName == right.channelName
        && left.selfMute == right.selfMute && left.selfDeaf == right.selfDeaf && left.speakers == right.speakers
}

func isVoiceSnowflake(_ value: String) -> Bool {
    !value.isEmpty && value.count <= 20 && value.allSatisfy(\.isNumber)
}

func displayVoiceLabel(_ value: Any?) -> String? {
    guard let raw = value as? String else { return nil }
    let name = raw.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }.map(String.init).joined()
        .split(whereSeparator: \.isWhitespace).joined(separator: " ")
    guard !name.isEmpty, name.count <= 80 else { return nil }
    return name
}

func voiceHUDStatus(_ value: [String: Any]?, now: Double = Date().timeIntervalSince1970 * 1000) -> VoiceHUDStatus? {
    guard let value, (value["version"] as? Int) == 1,
          let updatedAt = value["updatedAt"] as? Double, updatedAt.isFinite, updatedAt <= now, now - updatedAt <= 5000,
          let channelId = value["channelId"] as? String, isVoiceSnowflake(channelId),
          let channelName = displayVoiceLabel(value["channelName"]),
          let selfMute = value["selfMute"] as? Bool, let selfDeaf = value["selfDeaf"] as? Bool,
          let rawSpeakers = value["speakers"] as? [[String: Any]], rawSpeakers.count <= 8 else { return nil }
    var speakers: [VoiceHUDSpeaker] = []
    var seen = Set<String>()
    for speaker in rawSpeakers {
        guard let id = speaker["id"] as? String, isVoiceSnowflake(id), seen.insert(id).inserted,
              let name = displayVoiceLabel(speaker["name"]), let speaking = speaker["speaking"] as? Bool else { return nil }
        speakers.append(VoiceHUDSpeaker(id: id, name: name, speaking: speaking))
    }
    return VoiceHUDStatus(updatedAt: updatedAt, channelId: channelId, channelName: channelName,
        selfMute: selfMute, selfDeaf: selfDeaf, speakers: speakers)
}

func voiceHUDCommand(channelId: String, action: String, value: Bool, now: Double = Date().timeIntervalSince1970 * 1000) -> [String: Any]? {
    guard isVoiceSnowflake(channelId), ["mute", "deafen"].contains(action), now.isFinite else { return nil }
    return ["version": 1, "id": UUID().uuidString.lowercased(), "createdAt": Int64(now),
        "channelId": channelId, "action": action, "value": value]
}

func privateVoiceStatus(root: URL, now: Double = Date().timeIntervalSince1970 * 1000) -> VoiceHUDStatus? {
    let url = root.appendingPathComponent("voice.local.json")
    let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW)
    guard descriptor >= 0 else { return nil }
    defer { close(descriptor) }
    var info = stat()
    guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
          info.st_uid == getuid(), (info.st_mode & 0o077) == 0,
          info.st_size > 0, info.st_size <= 4096,
          let data = try? FileHandle(fileDescriptor: descriptor, closeOnDealloc: false).readToEnd(),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    return voiceHUDStatus(object, now: now)
}

func writeVoiceHUDCommand(root: URL, channelId: String, action: String, value: Bool) -> Bool {
    guard let command = voiceHUDCommand(channelId: channelId, action: action, value: value),
          let data = try? JSONSerialization.data(withJSONObject: command), data.count <= 1024 else { return false }
    var rootInfo = stat()
    guard lstat(root.path, &rootInfo) == 0, (rootInfo.st_mode & S_IFMT) == S_IFDIR,
          rootInfo.st_uid == getuid(), (rootInfo.st_mode & 0o002) == 0 else { return false }
    let target = root.appendingPathComponent("voice-command.local.json")
    var targetInfo = stat()
    if lstat(target.path, &targetInfo) == 0 {
        guard (targetInfo.st_mode & S_IFMT) == S_IFREG, targetInfo.st_uid == getuid(), (targetInfo.st_mode & 0o077) == 0 else { return false }
    } else if errno != ENOENT { return false }
    let temporary = root.appendingPathComponent(".voice-command-\(UUID().uuidString).tmp")
    let descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    guard descriptor >= 0 else { return false }
    var offset = 0
    let wrote = data.withUnsafeBytes { bytes -> Bool in
        guard let base = bytes.baseAddress else { return false }
        while offset < bytes.count {
            let amount = Darwin.write(descriptor, base.advanced(by: offset), bytes.count - offset)
            guard amount > 0 else { return false }
            offset += amount
        }
        return true
    }
    let ready = wrote && fsync(descriptor) == 0 && fchmod(descriptor, 0o600) == 0
    close(descriptor)
    guard ready, rename(temporary.path, target.path) == 0 else { unlink(temporary.path); return false }
    return true
}

struct MusicControlRequest: Equatable {
    let id: String
    let action: String
    let createdAt: Int64
}

struct MusicControlLease: Equatable {
    let id: String
    let createdAt: Int64
}

enum MusicControlGate: Equatable {
    case allowed
    case disabled
    case cancelled
}

struct MusicAppleEventResult {
    let succeeded: Bool
    let errorNumber: Int?
}

let musicPermissionPreflightScript = "tell application id \"com.apple.Music\" to get name"

func musicJSONInteger(_ value: Any?) -> Int64? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    let double = number.doubleValue
    guard double.isFinite, double >= 1, double <= 9_007_199_254_740_991, double.rounded(.towardZero) == double else { return nil }
    return Int64(double)
}

func musicJSONBoolean(_ value: Any?) -> Bool? {
    guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
    return number.boolValue
}

func isMusicControlUUID(_ value: String) -> Bool {
    value.range(of: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$", options: .regularExpression) != nil
}

func musicControlRequest(_ value: [String: Any]?, now: Double = Date().timeIntervalSince1970 * 1000) -> MusicControlRequest? {
    guard let value, Set(value.keys) == Set(["version", "id", "action", "createdAt"]),
          musicJSONInteger(value["version"]) == 1, let id = value["id"] as? String, isMusicControlUUID(id),
          let action = value["action"] as? String, ["play", "pause", "next", "previous"].contains(action),
          let createdAt = musicJSONInteger(value["createdAt"]), now.isFinite, Double(createdAt) <= now,
          now - Double(createdAt) <= 10_000 else { return nil }
    return MusicControlRequest(id: id, action: action, createdAt: createdAt)
}

func musicAppleScript(for action: String) -> String? {
    switch action {
    case "play": return "tell application id \"com.apple.Music\" to play"
    case "pause": return "tell application id \"com.apple.Music\" to pause"
    case "next": return "tell application id \"com.apple.Music\" to next track"
    case "previous": return "tell application id \"com.apple.Music\" to previous track"
    default: return nil
    }
}

func musicLease(_ value: [String: Any]?, now: Double) -> MusicControlLease? {
    guard let value, Set(value.keys) == Set(["version", "id", "createdAt"]),
          musicJSONInteger(value["version"]) == 1, let id = value["id"] as? String, isMusicControlUUID(id),
          let createdAt = musicJSONInteger(value["createdAt"]), now.isFinite, Double(createdAt) <= now,
          now - Double(createdAt) <= 65_000 else { return nil }
    return MusicControlLease(id: id, createdAt: createdAt)
}

func musicControlDeadlineOpen(_ request: MusicControlRequest, now: Double) -> Bool {
    now.isFinite && Double(request.createdAt) <= now && now < Double(request.createdAt) + 60_000
}

func currentMusicControlGate(_ request: MusicControlRequest, root: URL, now: Double) -> MusicControlGate {
    guard musicControlDeadlineOpen(request, now: now) else { return .cancelled }
    guard let directory = openMusicSupportDirectory(root) else { return .cancelled }
    defer { close(directory) }
    guard let file = readMusicSupportFile(directory: directory, name: "music.control.lock", limit: 1024) else { return .cancelled }
    defer { close(file.descriptor) }
    let value = (try? JSONSerialization.jsonObject(with: file.data)) as? [String: Any]
    guard let lease = musicLease(value, now: now), lease.id == request.id, lease.createdAt == request.createdAt else { return .cancelled }
    return localMusicPlayerEnabled(root: root) ? .allowed : .disabled
}

func readCurrentMusicBundleIdentifier(root: URL, timeoutSeconds: Double = 8) -> String? {
    guard timeoutSeconds > 0, timeoutSeconds <= 8,
          let directory = openMusicSupportDirectory(root) else { return nil }
    defer { close(directory) }
    let adapterFD = openat(directory, "vendor/mediaremote-adapter/bin/mediaremote-adapter.pl", O_RDONLY | O_NOFOLLOW)
    guard adapterFD >= 0 else { return nil }
    var adapterInfo = stat()
    let adapterSafe = fstat(adapterFD, &adapterInfo) == 0 && (adapterInfo.st_mode & S_IFMT) == S_IFREG
        && adapterInfo.st_uid == getuid() && (adapterInfo.st_mode & 0o022) == 0
        && adapterInfo.st_size > 0 && adapterInfo.st_size <= 262_144
    close(adapterFD)
    guard adapterSafe else { return nil }

    let process = Process(), output = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/perl")
    process.arguments = [root.appendingPathComponent("vendor/mediaremote-adapter/bin/mediaremote-adapter.pl").path,
        root.appendingPathComponent("build/MediaRemoteAdapter.framework").path, "get", "--no-artwork"]
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    do { try process.run() } catch { return nil }
    let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeoutSeconds, execute: timeout)
    var data = Data(), exceededLimit = false
    do {
        while let chunk = try output.fileHandleForReading.read(upToCount: 8192), !chunk.isEmpty {
            if data.count + chunk.count > 65_536 { exceededLimit = true; process.terminate(); break }
            data.append(chunk)
        }
    } catch { exceededLimit = true; process.terminate() }
    process.waitUntilExit()
    timeout.cancel()
    try? output.fileHandleForReading.close()
    guard !exceededLimit, process.terminationStatus == 0,
          let current = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    let bundleId = (current["parentApplicationBundleIdentifier"] as? String) ?? (current["bundleIdentifier"] as? String)
    return bundleId
}

func musicControlGateResponse(_ gate: MusicControlGate, request: MusicControlRequest, now: Double) -> [String: Any]? {
    guard gate == .disabled else { return nil }
    return musicControlResponse(id: request.id, ok: false, reason: "disabled", now: now)
}

func musicControlReason(appleEventError: Int?) -> String {
    appleEventError == -1743 || appleEventError == -1744 ? "permission-required" : "control-failed"
}

func runMusicAppleScript(_ source: String) -> MusicAppleEventResult {
    guard let script = NSAppleScript(source: source) else { return MusicAppleEventResult(succeeded: false, errorNumber: nil) }
    var error: NSDictionary?
    _ = script.executeAndReturnError(&error)
    guard let error else { return MusicAppleEventResult(succeeded: true, errorNumber: nil) }
    return MusicAppleEventResult(succeeded: false, errorNumber: (error["NSAppleScriptErrorNumber"] as? NSNumber)?.intValue)
}

func musicControlResponse(id: String?, ok: Bool, reason: String, now: Double = Date().timeIntervalSince1970 * 1000) -> [String: Any]? {
    guard let id, isMusicControlUUID(id), now.isFinite, now >= 1, now <= 9_007_199_254_740_991 else { return nil }
    if ok && reason != "applied" { return nil }
    if !ok && !["permission-required", "disabled", "control-failed"].contains(reason) { return nil }
    return ["version": 1, "id": id, "ok": ok, "reason": reason, "updatedAt": Int64(now)]
}

func openMusicSupportDirectory(_ root: URL) -> Int32? {
    let descriptor = open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard descriptor >= 0 else { return nil }
    var info = stat()
    guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR,
          info.st_uid == getuid(), (info.st_mode & 0o777) == 0o700 else { close(descriptor); return nil }
    return descriptor
}

func readMusicSupportFile(directory: Int32, name: String, limit: Int) -> (descriptor: Int32, info: stat, data: Data)? {
    let descriptor = openat(directory, name, O_RDONLY | O_NOFOLLOW)
    guard descriptor >= 0 else { return nil }
    var info = stat()
    guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
          info.st_uid == getuid(), (info.st_mode & 0o777) == 0o600,
          info.st_size > 0, info.st_size <= Int64(limit),
          let data = try? FileHandle(fileDescriptor: descriptor, closeOnDealloc: false).readToEnd() else { close(descriptor); return nil }
    return (descriptor, info, data)
}

func localMusicPlayerEnabled(root: URL) -> Bool {
    guard let directory = openMusicSupportDirectory(root) else { return false }
    defer { close(directory) }
    guard let file = readMusicSupportFile(directory: directory, name: "music.local.settings.json", limit: 1024) else { return false }
    defer { close(file.descriptor) }
    guard let value = try? JSONSerialization.jsonObject(with: file.data) as? [String: Any],
          Set(value.keys) == Set(["version", "enabled"]), musicJSONInteger(value["version"]) == 1,
          let enabled = musicJSONBoolean(value["enabled"]) else { return false }
    return enabled
}

func claimMusicControlRequest(root: URL) -> MusicControlRequest? {
    guard let directory = openMusicSupportDirectory(root) else { return nil }
    defer { close(directory) }
    guard let file = readMusicSupportFile(directory: directory, name: "music.control.request.json", limit: 1024) else { return nil }
    defer { close(file.descriptor) }
    let claimedName = ".music-control-\(UUID().uuidString).claimed"
    guard renameat(directory, "music.control.request.json", directory, claimedName) == 0 else { return nil }
    defer { unlinkat(directory, claimedName, 0) }
    let claimed = openat(directory, claimedName, O_RDONLY | O_NOFOLLOW)
    guard claimed >= 0 else { return nil }
    defer { close(claimed) }
    var claimedInfo = stat()
    guard fstat(claimed, &claimedInfo) == 0, claimedInfo.st_dev == file.info.st_dev,
          claimedInfo.st_ino == file.info.st_ino, claimedInfo.st_uid == getuid(),
          (claimedInfo.st_mode & 0o777) == 0o600 else { return nil }
    let value = (try? JSONSerialization.jsonObject(with: file.data)) as? [String: Any]
    return musicControlRequest(value)
}

func writeMusicControlResponse(root: URL, response: [String: Any]) -> Bool {
    guard let directory = openMusicSupportDirectory(root),
          let data = try? JSONSerialization.data(withJSONObject: response), data.count <= 1024 else { return false }
    defer { close(directory) }
    var targetInfo = stat()
    if fstatat(directory, "music.control.response.json", &targetInfo, AT_SYMLINK_NOFOLLOW) == 0 {
        guard (targetInfo.st_mode & S_IFMT) == S_IFREG, targetInfo.st_uid == getuid(),
              (targetInfo.st_mode & 0o777) == 0o600 else { return false }
    } else if errno != ENOENT { return false }
    let temporaryName = ".music-control-response-\(UUID().uuidString).tmp"
    let descriptor = openat(directory, temporaryName, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    guard descriptor >= 0 else { return false }
    var offset = 0
    let wrote = data.withUnsafeBytes { bytes -> Bool in
        guard let base = bytes.baseAddress else { return false }
        while offset < bytes.count {
            let amount = Darwin.write(descriptor, base.advanced(by: offset), bytes.count - offset)
            guard amount > 0 else { return false }
            offset += amount
        }
        return true
    }
    let ready = wrote && fsync(descriptor) == 0 && fchmod(descriptor, 0o600) == 0
    close(descriptor)
    guard ready, renameat(directory, temporaryName, directory, "music.control.response.json") == 0 else {
        unlinkat(directory, temporaryName, 0); return false
    }
    return true
}

func executeMusicControl(_ request: MusicControlRequest, root: URL,
                         now: () -> Double = { Date().timeIntervalSince1970 * 1000 },
                         runAppleScript: (String) -> MusicAppleEventResult = runMusicAppleScript,
                         readCurrentPlayer: (URL) -> String? = { readCurrentMusicBundleIdentifier(root: $0) }) -> [String: Any]? {
    let startedAt = now()
    guard startedAt - Double(request.createdAt) <= 10_000,
          currentMusicControlGate(request, root: root, now: startedAt) == .allowed else {
        return musicControlGateResponse(currentMusicControlGate(request, root: root, now: now()), request: request, now: now())
    }
    let preflight = runAppleScript(musicPermissionPreflightScript)
    let afterPreflight = now()
    let preflightGate = currentMusicControlGate(request, root: root, now: afterPreflight)
    if preflightGate != .allowed { return musicControlGateResponse(preflightGate, request: request, now: afterPreflight) }
    guard preflight.succeeded else {
        return musicControlResponse(id: request.id, ok: false,
            reason: musicControlReason(appleEventError: preflight.errorNumber), now: afterPreflight)
    }

    let currentPlayer = readCurrentPlayer(root)
    let afterRead = now()
    let readGate = currentMusicControlGate(request, root: root, now: afterRead)
    if readGate != .allowed { return musicControlGateResponse(readGate, request: request, now: afterRead) }
    guard currentPlayer == "com.apple.Music",
          let action = musicAppleScript(for: request.action) else {
        return musicControlResponse(id: request.id, ok: false, reason: "control-failed", now: afterRead)
    }

    let beforeAction = now()
    let actionGate = currentMusicControlGate(request, root: root, now: beforeAction)
    if actionGate != .allowed { return musicControlGateResponse(actionGate, request: request, now: beforeAction) }
    let result = runAppleScript(action)
    let completedAt = now()
    let completionGate = currentMusicControlGate(request, root: root, now: completedAt)
    if completionGate != .allowed { return musicControlGateResponse(completionGate, request: request, now: completedAt) }
    if result.succeeded { return musicControlResponse(id: request.id, ok: true, reason: "applied", now: completedAt) }
    return musicControlResponse(id: request.id, ok: false,
        reason: musicControlReason(appleEventError: result.errorNumber), now: completedAt)
}

if CommandLine.arguments.contains("--self-test") {
    assert(isSettingsRequest(["--settings"]))
    assert(!isSettingsRequest(["node", "main.mjs", "--settings"]))
    let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("ep-helper-\(UUID().uuidString)")
    let runtime = scratch.appendingPathComponent("runtime/node"), setup = scratch.appendingPathComponent("scripts/bundle-setup.mjs")
    try! FileManager.default.createDirectory(at: runtime.deletingLastPathComponent(), withIntermediateDirectories: true)
    try! FileManager.default.createDirectory(at: setup.deletingLastPathComponent(), withIntermediateDirectories: true)
    FileManager.default.createFile(atPath: runtime.path, contents: Data())
    FileManager.default.createFile(atPath: setup.path, contents: Data())
    try! FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: runtime.path)
    assert(isManualLaunch([], resources: scratch))
    assert(!isManualLaunch(["--settings"], resources: scratch))
    try! FileManager.default.removeItem(at: scratch)
    let now = Date().timeIntervalSince1970 * 1000
    let live: [String: Any] = ["updatedAt": now, "perf": ["source": "vencord"], "activity": ["appName": "Codex"]]
    assert(MenuStatus(enabled: true, runtime: live, running: true).title == "Vencord connected")
    assert(MenuStatus(enabled: true, runtime: live, running: true).activity == "Sharing Codex")
    assert(MenuStatus(enabled: false, runtime: live, running: true).activity == "Nothing is shared")
    assert(MenuStatus(enabled: true, runtime: live, running: false).title == "Companion unavailable")
    assert(MenuStatus(enabled: true, runtime: live, running: true, now: now + 91000).title == "Companion unavailable")
    let token = String(repeating: "a", count: 48)
    assert(settingsURL("http://127.0.0.1:43822/?t=\(token)") != nil)
    for text in ["https://example.com/?t=\(token)", "http://localhost:43822/?t=\(token)", "http://127.0.0.1:43822/?t=x", "http://127.0.0.1:43822/?t=\(token)&other=1"] { assert(settingsURL(text) == nil) }
    let voice: [String: Any] = ["version": 1, "updatedAt": now, "channelId": "123456789012345678", "channelName": "General",
        "selfMute": false, "selfDeaf": true, "speakers": [["id": "223456789012345678", "name": "Alex", "speaking": true]]]
    let voiceStatus = voiceHUDStatus(voice, now: now)
    let heartbeat = voiceHUDStatus(voice.merging(["updatedAt": now + 2000]) { _, new in new }, now: now + 2000)
    assert(voiceStatus?.speakers.first?.speaking == true)
    assert(voiceStatus != heartbeat)
    assert(sameVoiceHUDPresentation(voiceStatus, heartbeat))
    assert(!sameVoiceHUDPresentation(voiceStatus, voiceHUDStatus(voice.merging(["channelName": "Lounge"]) { _, new in new }, now: now)))
    assert(voiceHUDStatus(voice, now: now + 5001) == nil)
    assert(voiceHUDStatus(voice.merging(["channelId": "../Discord"]) { _, new in new }, now: now) == nil)
    assert(voiceHUDCommand(channelId: "../Discord", action: "mute", value: true, now: now) == nil)
    assert(voiceHUDCommand(channelId: "123456789012345678", action: "shell", value: true, now: now) == nil)
    let musicRequestObject: [String: Any] = ["version": 1, "id": "7b24f2c1-9eea-4af4-a1bc-251cdd0fceab",
        "action": "next", "createdAt": Int64(now)]
    let musicRequest = musicControlRequest(musicRequestObject, now: now)
    assert(musicRequest?.action == "next")
    assert(musicControlRequest(musicRequestObject.merging(["script": "arbitrary"]) { _, new in new }, now: now) == nil)
    assert(musicControlRequest(musicRequestObject.merging(["createdAt": Int64(now - 10001)]) { _, new in new }, now: now) == nil)
    assert(musicControlRequest(musicRequestObject.merging(["createdAt": Int64(now + 1)]) { _, new in new }, now: now) == nil)
    assert(musicAppleScript(for: "play") == "tell application id \"com.apple.Music\" to play")
    assert(musicAppleScript(for: "pause") == "tell application id \"com.apple.Music\" to pause")
    assert(musicAppleScript(for: "next") == "tell application id \"com.apple.Music\" to next track")
    assert(musicAppleScript(for: "previous") == "tell application id \"com.apple.Music\" to previous track")
    assert(musicAppleScript(for: "unexpected") == nil)
    assert(musicControlReason(appleEventError: -1743) == "permission-required")
    assert(musicControlReason(appleEventError: -1744) == "permission-required")
    assert(musicControlReason(appleEventError: nil) == "control-failed")
    assert(musicControlResponse(id: musicRequest?.id, ok: true, reason: "applied", now: now)?["ok"] as? Bool == true)
    assert(musicControlResponse(id: musicRequest?.id, ok: true, reason: "permission-required", now: now) == nil)
    assert(musicControlResponse(id: musicRequest?.id, ok: false, reason: "permission-required", now: now)?["reason"] as? String == "permission-required")
    assert(musicJSONBoolean(1) == nil)
    let musicRoot = FileManager.default.temporaryDirectory.appendingPathComponent("ep-music-helper-\(UUID().uuidString)")
    try! FileManager.default.createDirectory(at: musicRoot, withIntermediateDirectories: true)
    try! FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: musicRoot.path)
    func writeMusicFixture(_ value: [String: Any], name: String) {
        let url = musicRoot.appendingPathComponent(name)
        try! JSONSerialization.data(withJSONObject: value).write(to: url, options: .atomic)
        try! FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    let musicSettings = musicRoot.appendingPathComponent("music.local.settings.json")
    try! JSONSerialization.data(withJSONObject: ["version": 1, "enabled": true]).write(to: musicSettings)
    try! FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: musicSettings.path)
    assert(localMusicPlayerEnabled(root: musicRoot))
    let requestFile = musicRoot.appendingPathComponent("music.control.request.json")
    try! JSONSerialization.data(withJSONObject: musicRequestObject).write(to: requestFile)
    try! FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: requestFile.path)
    let claimedRequest = claimMusicControlRequest(root: musicRoot)
    assert(claimedRequest == musicRequest)
    assert(!FileManager.default.fileExists(atPath: requestFile.path))
    let response = musicControlResponse(id: claimedRequest?.id, ok: true, reason: "applied", now: now)!
    assert(writeMusicControlResponse(root: musicRoot, response: response))
    let savedResponse = try! JSONSerialization.jsonObject(with: Data(contentsOf: musicRoot.appendingPathComponent("music.control.response.json"))) as! [String: Any]
    assert(savedResponse["id"] as? String == musicRequest?.id)
    assert(savedResponse["reason"] as? String == "applied")

    let lease: [String: Any] = ["version": 1, "id": musicRequest!.id, "createdAt": musicRequest!.createdAt]
    writeMusicFixture(lease, name: "music.control.lock")
    var testTime = Double(now)
    var appleScripts: [String] = []
    var currentPlayerReads = 0
    let latePermission = executeMusicControl(musicRequest!, root: musicRoot, now: { testTime }, runAppleScript: { source in
        appleScripts.append(source); testTime = Double(now) + 60_001
        return MusicAppleEventResult(succeeded: true, errorNumber: nil)
    }, readCurrentPlayer: { _ in currentPlayerReads += 1; return "com.apple.Music" })
    assert(latePermission == nil)
    assert(appleScripts == [musicPermissionPreflightScript])
    assert(currentPlayerReads == 0)

    testTime = Double(now)
    appleScripts = []; currentPlayerReads = 0
    writeMusicFixture(lease, name: "music.control.lock")
    let disabledDuringPrompt = executeMusicControl(musicRequest!, root: musicRoot, now: { testTime }, runAppleScript: { source in
        appleScripts.append(source)
        writeMusicFixture(["version": 1, "enabled": false], name: "music.local.settings.json")
        return MusicAppleEventResult(succeeded: true, errorNumber: nil)
    }, readCurrentPlayer: { _ in currentPlayerReads += 1; return "com.apple.Music" })
    assert(disabledDuringPrompt?["reason"] as? String == "disabled")
    assert(appleScripts == [musicPermissionPreflightScript])
    assert(currentPlayerReads == 0)

    testTime = Double(now)
    appleScripts = []; currentPlayerReads = 0
    writeMusicFixture(lease, name: "music.control.lock")
    writeMusicFixture(["version": 1, "enabled": true], name: "music.local.settings.json")
    let changedPlayer = executeMusicControl(musicRequest!, root: musicRoot, now: { testTime }, runAppleScript: { source in
        appleScripts.append(source); return MusicAppleEventResult(succeeded: true, errorNumber: nil)
    }, readCurrentPlayer: { _ in currentPlayerReads += 1; return "com.spotify.client" })
    assert(changedPlayer?["reason"] as? String == "control-failed")
    assert(appleScripts == [musicPermissionPreflightScript])
    assert(currentPlayerReads == 1)

    appleScripts = []; currentPlayerReads = 0
    writeMusicFixture(lease, name: "music.control.lock")
    let cancelledDuringPlayerRead = executeMusicControl(musicRequest!, root: musicRoot, now: { testTime }, runAppleScript: { source in
        appleScripts.append(source); return MusicAppleEventResult(succeeded: true, errorNumber: nil)
    }, readCurrentPlayer: { _ in
        currentPlayerReads += 1
        try? FileManager.default.removeItem(at: musicRoot.appendingPathComponent("music.control.lock"))
        return "com.apple.Music"
    })
    assert(cancelledDuringPlayerRead == nil)
    assert(appleScripts == [musicPermissionPreflightScript])
    assert(currentPlayerReads == 1)

    appleScripts = []; currentPlayerReads = 0
    writeMusicFixture(lease, name: "music.control.lock")
    let applied = executeMusicControl(musicRequest!, root: musicRoot, now: { testTime }, runAppleScript: { source in
        appleScripts.append(source); return MusicAppleEventResult(succeeded: true, errorNumber: nil)
    }, readCurrentPlayer: { _ in currentPlayerReads += 1; return "com.apple.Music" })
    assert(applied?["reason"] as? String == "applied")
    assert(appleScripts == [musicPermissionPreflightScript, musicAppleScript(for: "next")!])
    assert(currentPlayerReads == 1)
    try! FileManager.default.removeItem(at: musicRoot)
    print("Helper checks passed"); exit(0)
}

let arguments = Array(CommandLine.arguments.dropFirst())
if arguments.isEmpty {
    guard isManualLaunch(arguments, resources: Bundle.main.resourceURL) else {
        fputs("Open Install Enhanced Presence to set up the helper.\n", stderr); exit(2)
    }
    do { try startInstalledService(); exit(0) }
    catch { fputs("\(error.localizedDescription)\n", stderr); exit(1) }
}
guard arguments.count >= 2 else { fputs("usage: EnhancedPresenceHelper NODE_PATH SCRIPT [ARGS]\n", stderr); exit(2) }
let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/EnhancedPresence")
func privateJSON(_ name: String) -> [String: Any]? {
    let url = root.appendingPathComponent(name)
    guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
          attributes[.type] as? FileAttributeType == .typeRegular,
          ((attributes[.size] as? NSNumber)?.intValue ?? Int.max) < 262144,
          (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600,
          (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
          let data = try? Data(contentsOf: url) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
}

final class Helper: NSObject, NSApplicationDelegate, NSMenuDelegate, NSWindowDelegate, WKNavigationDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    let connection = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
    let activity = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    let voiceHUDItem = NSMenuItem(title: "Show Voice HUD", action: #selector(toggleVoiceHUD), keyEquivalent: "")
    let toggle = NSMenuItem(title: "Pause Sharing", action: #selector(toggleSharing), keyEquivalent: "")
    var window: NSWindow?
    var voiceWindow: NSPanel?
    var voiceTimer: Timer?
    var lastVoiceHUDStatus: VoiceHUDStatus?
    let musicControlQueue = DispatchQueue(label: "app.enhancedpresence.music-control")
    let musicControlWatchQueue = DispatchQueue(label: "app.enhancedpresence.music-control-watch")
    let musicControlLock = NSLock()
    var musicControlActive = true
    var musicControlWatcher: DispatchSourceFileSystemObject?
    var musicControlWatcherClosed: DispatchSemaphore?
    var engine: Process?
    var stopping = false
    var changing = false
    var restartDelay: Double = 5
    var settingsObserver: NSObjectProtocol?

    func applicationDidFinishLaunching(_ note: Notification) {
        settingsObserver = DistributedNotificationCenter.default().addObserver(forName: settingsNotification, object: nil, queue: .main) { [weak self] _ in self?.openSettings() }
        item.button?.image = NSImage(systemSymbolName: "dot.radiowaves.left.and.right", accessibilityDescription: "Enhanced Presence")
        item.button?.image?.isTemplate = true
        item.button?.toolTip = "Enhanced Presence"
        let menu = NSMenu()
        menu.delegate = self
        menu.autoenablesItems = false
        connection.isEnabled = false; activity.isEnabled = false
        menu.addItem(connection); menu.addItem(activity); menu.addItem(.separator())
        toggle.target = self; menu.addItem(toggle)
        voiceHUDItem.target = self; menu.addItem(voiceHUDItem)
        for (title, action, key) in [("Settings…", #selector(openSettings), ","), ("Open Discord", #selector(openDiscord), "")] {
            let entry = NSMenuItem(title: title, action: action, keyEquivalent: key)
            entry.target = self; menu.addItem(entry)
        }
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit and Stop Sharing", action: #selector(quit), keyEquivalent: "q")
        quit.target = self; menu.addItem(quit)
        item.menu = menu
        startEngine()
        startMusicControlWatcher()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openSettings(); return true
    }

    func startEngine() {
        guard !stopping, engine?.isRunning != true else { return }
        let process = Process(), started = Date()
        process.executableURL = URL(fileURLWithPath: arguments[0])
        process.arguments = Array(arguments.dropFirst())
        process.terminationHandler = { [weak self] _ in DispatchQueue.main.async { self?.scheduleRestart(since: started) } }
        engine = process
        do { try process.run() } catch { scheduleRestart(since: started) }
    }

    func startMusicControlWatcher() {
        guard musicControlWatcher == nil, let descriptor = openMusicSupportDirectory(root) else { return }
        let watcher = DispatchSource.makeFileSystemObjectSource(fileDescriptor: descriptor,
            eventMask: [.write, .rename, .delete], queue: musicControlWatchQueue)
        let closed = DispatchSemaphore(value: 0)
        watcher.setEventHandler { [weak self] in self?.scheduleMusicControlRequest() }
        watcher.setCancelHandler { close(descriptor); closed.signal() }
        musicControlWatcher = watcher
        musicControlWatcherClosed = closed
        watcher.resume()
    }

    func stopMusicControlWatcher() {
        musicControlLock.lock(); musicControlActive = false; musicControlLock.unlock()
        let watcher = musicControlWatcher
        let closed = musicControlWatcherClosed
        musicControlWatcher = nil
        musicControlWatcherClosed = nil
        if let watcher { watcher.cancel(); closed?.wait() }
    }

    func scheduleMusicControlRequest() {
        musicControlQueue.async { [weak self] in
            guard let self else { return }
            self.musicControlLock.lock(); let active = self.musicControlActive; self.musicControlLock.unlock()
            guard active, let request = claimMusicControlRequest(root: root) else { return }
            self.musicControlLock.lock(); let stillActive = self.musicControlActive; self.musicControlLock.unlock()
            guard stillActive, let response = executeMusicControl(request, root: root) else { return }
            self.musicControlLock.lock(); let canRespond = self.musicControlActive; self.musicControlLock.unlock()
            if canRespond { _ = writeMusicControlResponse(root: root, response: response) }
        }
    }

    func scheduleRestart(since started: Date) {
        guard !stopping else { return }
        if Date().timeIntervalSince(started) > 60 { restartDelay = 5 }
        let delay = restartDelay
        restartDelay = min(60, restartDelay * 2)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in self?.startEngine() }
    }

    func menuWillOpen(_ menu: NSMenu) {
        let enabled = privateJSON("config.local.json")?["enabled"] as? Bool
        let status = MenuStatus(enabled: enabled, runtime: privateJSON("status.local.json"), running: engine?.isRunning == true)
        connection.title = status.title; activity.title = status.activity
        toggle.title = enabled == false ? "Resume Sharing" : "Pause Sharing"
        toggle.isEnabled = enabled != nil && engine?.isRunning == true && !changing
        voiceHUDItem.title = voiceWindow == nil ? "Show Voice HUD" : "Hide Voice HUD"
        voiceHUDItem.isEnabled = voiceWindow != nil || privateVoiceStatus(root: root) != nil
    }

    func sessionURL() -> URL? {
        guard let text = privateJSON("settings-session.json")?["url"] as? String else { return nil }
        return settingsURL(text)
    }

    func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = message
        alert.informativeText = "The companion may still be starting. Try again, or open Install Enhanced Presence to repair setup."
        alert.runModal()
    }

    @objc func openSettings() {
        guard let url = sessionURL() else { showError("Settings are unavailable"); return }
        if let window { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        let created = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 860, height: 620), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        created.title = "Enhanced Presence"
        created.minSize = NSSize(width: 650, height: 480)
        created.contentView = view; created.delegate = self
        created.isReleasedWhenClosed = false
        created.center(); window = created
        view.load(URLRequest(url: url))
        created.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        if let closed = notification.object as? NSWindow, closed === voiceWindow {
            voiceTimer?.invalidate(); voiceTimer = nil
            voiceWindow = nil; lastVoiceHUDStatus = nil
            return
        }
        (window?.contentView as? WKWebView)?.stopLoading()
        window?.contentView = nil; window = nil
    }

    @objc func toggleVoiceHUD() {
        if voiceWindow != nil { closeVoiceHUD(); return }
        guard let status = privateVoiceStatus(root: root) else { return }
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 320, height: 250),
            styleMask: [.titled, .closable, .nonactivatingPanel, .fullSizeContentView], backing: .buffered, defer: false)
        panel.title = "Voice HUD"
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.isReleasedWhenClosed = false
        panel.delegate = self
        voiceWindow = panel
        updateVoiceWindow(status)
        panel.center(); panel.orderFrontRegardless()
        voiceTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refreshVoiceHUD() }
    }

    func closeVoiceHUD() {
        voiceTimer?.invalidate(); voiceTimer = nil
        let panel = voiceWindow
        guard let panel else { lastVoiceHUDStatus = nil; return }
        panel.close()
        if voiceWindow === panel { voiceWindow = nil; lastVoiceHUDStatus = nil }
    }

    func refreshVoiceHUD() {
        guard voiceWindow != nil else { closeVoiceHUD(); return }
        guard let status = privateVoiceStatus(root: root) else { closeVoiceHUD(); return }
        if !sameVoiceHUDPresentation(status, lastVoiceHUDStatus) { updateVoiceWindow(status) }
    }

    func updateVoiceWindow(_ status: VoiceHUDStatus) {
        guard let panel = voiceWindow else { return }
        let background = NSVisualEffectView(frame: .zero)
        background.material = .hudWindow
        background.blendingMode = .behindWindow
        background.state = .active
        background.wantsLayer = true
        background.layer?.cornerRadius = 18
        background.layer?.masksToBounds = true

        let content = NSStackView()
        content.orientation = .vertical
        content.alignment = .leading
        content.distribution = .fill
        content.spacing = 12
        content.translatesAutoresizingMaskIntoConstraints = false
        let title = NSTextField(labelWithString: "Voice")
        title.font = .systemFont(ofSize: 18, weight: .semibold)
        let channel = NSTextField(labelWithString: status.channelName)
        channel.textColor = .secondaryLabelColor
        channel.lineBreakMode = .byTruncatingTail
        let names = status.speakers.isEmpty ? "No one is speaking" : status.speakers.map { "\($0.speaking ? "●" : "○")  \($0.name)" }.joined(separator: "\n")
        let speakers = NSTextField(wrappingLabelWithString: names)
        speakers.maximumNumberOfLines = 8
        speakers.font = .systemFont(ofSize: 13)
        let controls = NSStackView()
        controls.orientation = .horizontal
        controls.spacing = 8
        let mute = NSButton(title: status.selfMute ? "Unmute" : "Mute", target: self, action: #selector(setVoiceMute))
        mute.setAccessibilityLabel(status.selfMute ? "Unmute microphone" : "Mute microphone")
        let deaf = NSButton(title: status.selfDeaf ? "Undeafen" : "Deafen", target: self, action: #selector(setVoiceDeafen))
        deaf.setAccessibilityLabel(status.selfDeaf ? "Stop deafen" : "Deafen voice audio")
        controls.addArrangedSubview(mute); controls.addArrangedSubview(deaf)
        [title, channel, speakers, controls].forEach(content.addArrangedSubview)
        background.addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: background.leadingAnchor, constant: 18),
            content.trailingAnchor.constraint(equalTo: background.trailingAnchor, constant: -18),
            content.topAnchor.constraint(equalTo: background.topAnchor, constant: 18),
            content.bottomAnchor.constraint(lessThanOrEqualTo: background.bottomAnchor, constant: -18),
            background.widthAnchor.constraint(equalToConstant: 320)
        ])
        panel.contentView = background
        lastVoiceHUDStatus = status
    }

    @objc func setVoiceMute() {
        guard let status = privateVoiceStatus(root: root) else { closeVoiceHUD(); return }
        _ = writeVoiceHUDCommand(root: root, channelId: status.channelId, action: "mute", value: !status.selfMute)
    }

    @objc func setVoiceDeafen() {
        guard let status = privateVoiceStatus(root: root) else { closeVoiceHUD(); return }
        _ = writeVoiceHUDCommand(root: root, channelId: status.channelId, action: "deafen", value: !status.selfDeaf)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url.flatMap { settingsURL($0.absoluteString) } == nil ? .cancel : .allow)
    }

    @objc func toggleSharing() {
        guard !changing, let enabled = privateJSON("config.local.json")?["enabled"] as? Bool, let url = sessionURL(),
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false), let token = parts.queryItems?.first?.value,
              let endpoint = URL(string: "/api/behavior", relativeTo: url)?.absoluteURL else { showError("Sharing settings are unavailable"); return }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"; request.timeoutInterval = 5
        request.setValue(token, forHTTPHeaderField: "x-ep-token")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["enabled": !enabled])
        changing = true; toggle.isEnabled = false
        URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.changing = false; self.toggle.isEnabled = true
                if error != nil || (response as? HTTPURLResponse)?.statusCode != 200 { self.showError("Couldn’t change sharing") }
            }
        }.resume()
    }
    @objc func openDiscord() { NSWorkspace.shared.open(URL(fileURLWithPath: "/Applications/Discord.app")) }
    @objc func quit() {
        stopping = true; stopMusicControlWatcher(); engine?.terminate()
        let stop = Process()
        stop.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        stop.arguments = ["bootout", "gui/\(getuid())/app.enhancedpresence.engine"]
        try? stop.run()
        NSApp.terminate(nil)
    }
    func applicationWillTerminate(_ note: Notification) { stopping = true; stopMusicControlWatcher(); engine?.terminate() }
}

let app = NSApplication.shared
let delegate = Helper()
app.delegate = delegate
app.setActivationPolicy(.accessory)
for signalNumber in [SIGTERM, SIGINT] { signal(signalNumber, SIG_IGN) }
let sources = [SIGTERM, SIGINT].map { number -> DispatchSourceSignal in
    let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
    source.setEventHandler { delegate.stopping = true; delegate.stopMusicControlWatcher(); delegate.engine?.terminate(); exit(0) }
    source.resume(); return source
}
_ = sources
app.run()
