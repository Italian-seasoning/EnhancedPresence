import AppKit
import WebKit

// Menu bar helper. Runs the engine as a child process (so macOS privacy prompts name this app)
// and offers pause/resume. Usage: EnhancedPresenceHelper NODE_PATH main.mjs [engine arguments...]
let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count >= 2 else { fputs("usage: EnhancedPresenceHelper NODE_PATH SCRIPT [ARGS]\n", stderr); exit(2) }
let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/EnhancedPresence")
let configPath = root.appendingPathComponent("config.local.json").path
let sessionPath = root.appendingPathComponent("settings-session.json").path
let statusPath = root.appendingPathComponent("status.local.json").path
let setupScript = root.appendingPathComponent("presence-engine/setup.mjs").path

final class Helper: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    let perfLine = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    var window: NSWindow?
    let toggle = NSMenuItem(title: "", action: #selector(toggleSharing), keyEquivalent: "")
    var engine: Process?
    var stopping = false

    func applicationDidFinishLaunching(_ note: Notification) {
        item.button?.image = NSImage(systemSymbolName: "dot.radiowaves.left.and.right", accessibilityDescription: "Enhanced Presence")
        let menu = NSMenu()
        menu.delegate = self
        let title = NSMenuItem(title: "Enhanced Presence", action: nil, keyEquivalent: "")
        title.isEnabled = false
        menu.addItem(title)
        perfLine.isEnabled = false
        menu.addItem(perfLine)
        let settings = NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        settings.target = self
        menu.addItem(settings)
        toggle.target = self
        menu.addItem(toggle)
        let discord = NSMenuItem(title: "Open Discord", action: #selector(openDiscord), keyEquivalent: "")
        discord.target = self
        menu.addItem(discord)
        let folder = NSMenuItem(title: "Show Settings Folder", action: #selector(showFolder), keyEquivalent: "")
        folder.target = self
        menu.addItem(folder)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit and Stop Sharing", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        item.menu = menu
        startEngine()
    }

    func startEngine() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: arguments[0])
        process.arguments = Array(arguments.dropFirst())
        process.terminationHandler = { [weak self] _ in
            guard let self, !self.stopping else { return }
            // Restart after a short pause if the engine exits unexpectedly.
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self.startEngine() }
        }
        try? process.run()
        engine = process
    }

    func sharingEnabled() -> Bool {
        guard let data = FileManager.default.contents(atPath: configPath),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return json["enabled"] as? Bool ?? true
    }

    func menuWillOpen(_ menu: NSMenu) {
        toggle.title = sharingEnabled() ? "Pause Sharing" : "Resume Sharing"
        perfLine.title = performanceSummary()
    }

    // One short line from the engine's own status file: CPU, memory and battery saver.
    func performanceSummary() -> String {
        guard let data = FileManager.default.contents(atPath: statusPath),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let perf = json["perf"] as? [String: Any],
              let cpu = perf["cpuPercent"] as? Double, let memory = perf["rssMB"] as? Double else { return "Starting…" }
        let saver = (perf["saver"] as? Bool ?? false) ? " · Battery saver on" : ""
        return String(format: "CPU %.1f%% · %.0f MB%@", cpu, memory, saver)
    }

    @objc func openSettings() {
        guard let data = FileManager.default.contents(atPath: sessionPath),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let text = json["url"] as? String, let url = URL(string: text) else {
            let alert = NSAlert()
            alert.messageText = "Settings are not ready yet"
            alert.informativeText = "The companion is still starting. Try again in a few seconds."
            alert.runModal()
            return
        }
        if window == nil {
            let view = WKWebView(frame: .zero)
            let created = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 960, height: 700), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            created.title = "Enhanced Presence Settings"
            created.contentView = view
            created.isReleasedWhenClosed = false
            created.center()
            window = created
        }
        (window?.contentView as? WKWebView)?.load(URLRequest(url: url))
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func toggleSharing() {
        // The setup command validates and writes the settings atomically; the engine reloads them on its own.
        let process = Process()
        process.executableURL = URL(fileURLWithPath: arguments[0])
        process.arguments = [setupScript, sharingEnabled() ? "pause" : "resume", "--config", configPath]
        try? process.run()
    }
    @objc func openDiscord() { NSWorkspace.shared.open(URL(fileURLWithPath: "/Applications/Discord.app")) }
    @objc func showFolder() { NSWorkspace.shared.open(root) }
    @objc func quit() {
        stopping = true
        engine?.terminate()
        // Without this launchd would start the helper again immediately.
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
    source.setEventHandler { delegate.engine?.terminate(); exit(0) }
    source.resume()
    return source
}
_ = sources
app.run()
