import AppKit

// Menu bar helper. Runs the engine as a child process (so macOS privacy prompts name this app)
// and offers pause/resume. Usage: EnhancedPresenceHelper NODE_PATH main.mjs [engine arguments...]
let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count >= 2 else { fputs("usage: EnhancedPresenceHelper NODE_PATH SCRIPT [ARGS]\n", stderr); exit(2) }
let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/EnhancedPresence")
let configPath = root.appendingPathComponent("config.local.json").path
let setupScript = root.appendingPathComponent("presence-engine/setup.mjs").path

final class Helper: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
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

    func menuWillOpen(_ menu: NSMenu) { toggle.title = sharingEnabled() ? "Pause Sharing" : "Resume Sharing" }

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
