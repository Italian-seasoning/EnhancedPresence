import AppKit
import CoreGraphics
import ApplicationServices

// App detection needs no Accessibility. Optional names read only the focused
// window of a specifically allowed TextEdit/Final Cut app. Never read content.
let args = CommandLine.arguments
let configPath: String? = args.firstIndex(of: "--config").flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil }
var previousAccess: Bool?
var cachedConfig: [String: Any]?
var configModified: Date?
func nameConfig() -> [String: Any]? {
    guard let path = configPath,
          let attributes = try? FileManager.default.attributesOfItem(atPath: path),
          attributes[.type] as? FileAttributeType == .typeRegular,
          ((attributes[.size] as? NSNumber)?.intValue ?? Int.max) <= 131072,
          (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600,
          (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid() else { cachedConfig = nil; return nil }
    let modified = attributes[.modificationDate] as? Date
    if modified != configModified || cachedConfig == nil {
        configModified = modified
        cachedConfig = FileManager.default.contents(atPath: path).flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }
    }
    return cachedConfig
}

func finalCutProject(_ window: AXUIElement) -> String? {
    var queue: [(AXUIElement, Int)] = [(window, 0)]
    var index = 0
    let deadline = Date().addingTimeInterval(0.5)
    while index < queue.count && index < 600 && Date() < deadline {
        let (element, depth) = queue[index]
        index += 1
        AXUIElementSetMessagingTimeout(element, 0.05)
        var identifier: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, "AXIdentifier" as CFString, &identifier) == .success,
           let identifier = identifier as? String,
           identifier == "editor/timelineContainer/toolbar/projectNamePopUpButton" {
            var value: CFTypeRef?
            guard AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &value) == .success,
                  let title = value as? String, !title.isEmpty, title.count <= 128 else { return nil }
            return title
        }
        if depth < 10 {
            var children: CFTypeRef?
            if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success,
               let children = children as? [AXUIElement] {
                queue.append(contentsOf: children.prefix(max(0, 600 - queue.count)).map { ($0, depth + 1) })
            }
        }
    }
    return nil
}
func focusedName(_ app: NSRunningApplication, config: [String: Any]) -> String? {
    guard let id = app.bundleIdentifier, ["com.apple.TextEdit", "com.apple.FinalCut", "com.adobe.Photoshop", "com.adobe.lightroomCC", "com.adobe.LightroomClassicCC7", "com.adobe.illustrator", "com.adobe.InDesign", "com.adobe.AfterEffects", "com.adobe.PremierePro"].contains(id),
          config["enabled"] as? Bool == true,
          (config["allowlist"] as? [String])?.contains(id) == true,
          (config["denylist"] as? [String])?.contains(id) != true,
          let disclosure = config["disclosure"] as? [String: [String: Bool]],
          disclosure[id]?["showName"] == true, AXIsProcessTrusted() else { return nil }
    let element = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(element, 0.25)
    var window: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXFocusedWindowAttribute as CFString, &window) == .success,
          let window, CFGetTypeID(window) == AXUIElementGetTypeID() else { return nil }
    if id == "com.apple.FinalCut" { return finalCutProject(window as! AXUIElement) }
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(window as! AXUIElement, kAXTitleAttribute as CFString, &value) == .success,
          let title = value as? String, !title.isEmpty, title.count <= 128 else { return nil }
    return title
}
func reportAccess() {
    guard let path = configPath else { return }
    let available = AXIsProcessTrusted()
    guard previousAccess != available else { return }
    let status = URL(fileURLWithPath: path).deletingLastPathComponent().appendingPathComponent("metadata.status.json")
    if let data = try? JSONSerialization.data(withJSONObject: ["namesAvailable": available]) {
        do {
            try data.write(to: status, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: status.path)
            previousAccess = available
        } catch { /* Availability is advisory; generic presence stays working. */ }
    }
}
var sleeping = false
var locked = false
var timer: Timer?
func emit() {
    let app = NSWorkspace.shared.frontmostApplication
    // kCGAnyInputEventType is UInt32.max. A null event does not track user input.
    let anyInputEvent = CGEventType(rawValue: UInt32.max)!
    let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInputEvent)
    let config = nameConfig()
    var snapshot: [String: Any] = [
        "appId": app?.bundleIdentifier ?? "",
        "pid": Int(app?.processIdentifier ?? 0),
        "idleSeconds": idle.isFinite ? idle : 0,
        "inactive": sleeping || locked
    ]
    if let launched = app?.launchDate?.timeIntervalSince1970, launched.isFinite, launched > 0, launched <= Date().timeIntervalSince1970 {
        snapshot["launchTimestamp"] = Int(launched)
    }
    if let allowed = config?["allowlist"] as? [String], let denied = config?["denylist"] as? [String] {
        var running: [String: [Int]] = [:]
        let allowSet = Set(allowed), denySet = Set(denied)
        for runningApp in NSWorkspace.shared.runningApplications.prefix(256) {
            guard let id = runningApp.bundleIdentifier, allowSet.contains(id), !denySet.contains(id), !runningApp.isTerminated else { continue }
            running[id, default: []].append(Int(runningApp.processIdentifier))
        }
        snapshot["runningApps"] = running
    }
    reportAccess()
    if !sleeping && !locked, let app, let config, idle < (config["idleSeconds"] as? Double ?? 300), let title = focusedName(app, config: config) {
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier { snapshot["documentName"] = title }
    }
    if let data = try? JSONSerialization.data(withJSONObject: snapshot),
       let line = String(data: data, encoding: .utf8) {
        print(line)
        fflush(stdout)
    }
    timer?.invalidate()
    let untilIdle = (config?["idleSeconds"] as? Double ?? 300) - idle
    let interval = untilIdle > 0 ? min(15, max(0.5, untilIdle)) : 15
    timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: false) { _ in emit() }
    timer?.tolerance = interval == 15 ? 2 : 0.1
}
let center = NSWorkspace.shared.notificationCenter
let activation = center.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { _ in emit() }
let sleep = center.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { _ in sleeping = true; emit() }
let wake = center.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in sleeping = false; emit() }
let lock = DistributedNotificationCenter.default().addObserver(forName: NSNotification.Name("com.apple.screenIsLocked"), object: nil, queue: .main) { _ in locked = true; emit() }
let unlock = DistributedNotificationCenter.default().addObserver(forName: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil, queue: .main) { _ in locked = false; emit() }
signal(SIGUSR1, SIG_IGN)
let settingsSignal = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
settingsSignal.setEventHandler { emit() }
settingsSignal.resume()
emit()
RunLoop.main.run()
