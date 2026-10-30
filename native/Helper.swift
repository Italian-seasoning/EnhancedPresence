import AppKit
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
    let toggle = NSMenuItem(title: "Pause Sharing", action: #selector(toggleSharing), keyEquivalent: "")
    var window: NSWindow?
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
        for (title, action, key) in [("Settings…", #selector(openSettings), ","), ("Open Discord", #selector(openDiscord), "")] {
            let entry = NSMenuItem(title: title, action: action, keyEquivalent: key)
            entry.target = self; menu.addItem(entry)
        }
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit and Stop Sharing", action: #selector(quit), keyEquivalent: "q")
        quit.target = self; menu.addItem(quit)
        item.menu = menu
        startEngine()
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
        (window?.contentView as? WKWebView)?.stopLoading()
        window?.contentView = nil; window = nil
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
        stopping = true; engine?.terminate()
        let stop = Process()
        stop.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        stop.arguments = ["bootout", "gui/\(getuid())/app.enhancedpresence.engine"]
        try? stop.run()
        NSApp.terminate(nil)
    }
    func applicationWillTerminate(_ note: Notification) { stopping = true; engine?.terminate() }
}

let app = NSApplication.shared
let delegate = Helper()
app.delegate = delegate
app.setActivationPolicy(.accessory)
for signalNumber in [SIGTERM, SIGINT] { signal(signalNumber, SIG_IGN) }
let sources = [SIGTERM, SIGINT].map { number -> DispatchSourceSignal in
    let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
    source.setEventHandler { delegate.stopping = true; delegate.engine?.terminate(); exit(0) }
    source.resume(); return source
}
_ = sources
app.run()
