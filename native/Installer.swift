import AppKit
import SwiftUI

struct InstallerResources {
    let helperApp: URL
    let node: URL
    let setupScript: URL
    let terms: URL

    static func resolve(resources: URL, fileManager: FileManager = .default) -> InstallerResources? {
        let helper = resources.appendingPathComponent("payload/EnhancedPresence Helper.app", isDirectory: true)
        let helperContents = helper.appendingPathComponent("Contents", isDirectory: true)
        let contents = helperContents.appendingPathComponent("Resources", isDirectory: true)
        let helperExecutable = helperContents.appendingPathComponent("MacOS/EnhancedPresenceHelper")
        let node = contents.appendingPathComponent("runtime/node")
        let script = contents.appendingPathComponent("scripts/bundle-setup.mjs")
        let terms = resources.appendingPathComponent("TERMS.md")
        guard fileManager.fileExists(atPath: helperContents.appendingPathComponent("Info.plist").path),
              fileManager.isExecutableFile(atPath: helperExecutable.path),
              fileManager.isExecutableFile(atPath: node.path),
              fileManager.fileExists(atPath: script.path),
              fileManager.fileExists(atPath: terms.path) else { return nil }
        return InstallerResources(helperApp: helper, node: node, setupScript: script, terms: terms)
    }
}

enum InstallerContract {
    static func validApplicationID(_ value: String) -> Bool {
        value.range(of: #"^[0-9]{17,20}$"#, options: .regularExpression) != nil
    }

    static func discordResources(app: URL, bundleIdentifier: String?) -> URL? {
        guard app.isFileURL, app.pathExtension == "app", bundleIdentifier == "com.hnc.Discord" else { return nil }
        return app.standardizedFileURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("Resources", isDirectory: true)
    }

    static func arguments(operation: String, applicationID: String = "", withHooks: Bool = false, standalone: Bool = false, discordResources: String? = nil) -> [String]? {
        switch operation {
        case "install":
            guard validApplicationID(applicationID),
                  standalone ? discordResources == nil : discordResources.map({ URL(fileURLWithPath: $0).path == $0 }) == true else { return nil }
            return ["install", "--application-id", applicationID]
                + (withHooks ? ["--with-hooks"] : [])
                + (standalone ? ["--standalone"] : [])
                + (discordResources.map { ["--discord-resources", $0] } ?? [])
        case "uninstall": return ["uninstall"]
        default: return nil
        }
    }
}

private func existingApplicationID() -> String {
    let path = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/EnhancedPresence/bridge.local.json").path
    var info = stat()
    guard lstat(path, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
          (info.st_mode & 0o077) == 0, info.st_uid == getuid(), info.st_size <= 4096,
          let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let applicationID = object["applicationId"] as? String,
          InstallerContract.validApplicationID(applicationID) else { return "" }
    return applicationID
}

private final class OutputCapture {
    private let lock = NSLock()
    private var value = ""
    private let limit: Int
    let pipe = Pipe()

    init(limit: Int) { self.limit = limit }

    func start(onLine: @escaping (String) -> Void) {
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { handle.readabilityHandler = nil; return }
            let text = String(decoding: data, as: UTF8.self)
            self?.append(text)
            guard let line = text.split(whereSeparator: \.isNewline).last.map(String.init), !line.hasPrefix("{") else { return }
            let safe = String(line.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }.prefix(180))
            if !safe.isEmpty { DispatchQueue.main.async { onLine(safe) } }
        }
    }

    private func append(_ text: String) {
        lock.lock(); defer { lock.unlock() }
        value += text
        if value.count > limit { value = String(value.suffix(limit)) }
    }

    func finish() -> String {
        pipe.fileHandleForReading.readabilityHandler = nil
        while true {
            let data = pipe.fileHandleForReading.availableData
            if data.isEmpty { break }
            append(String(decoding: data, as: UTF8.self))
        }
        lock.lock(); defer { lock.unlock() }
        return value
    }
}

@MainActor
private final class InstallerModel: ObservableObject {
    @Published var applicationID = existingApplicationID()
    @Published var useVencord = true
    @Published var withHooks = false
    @Published var isWorking = false
    @Published var progress = ""
    @Published var message = ""
    @Published var isError = false
    @Published var showTerms = false
    @Published var confirmUninstall = false
    private var scopedDiscordURL: URL?

    let resources = InstallerResources.resolve(resources: Bundle.main.resourceURL ?? Bundle.main.bundleURL)
    var termsText: String {
        guard let url = resources?.terms, let text = try? String(contentsOf: url, encoding: .utf8) else {
            return "Terms of Use could not be loaded. Download a fresh copy of Enhanced Presence."
        }
        return text
    }
    var canInstall: Bool { !isWorking && resources != nil && InstallerContract.validApplicationID(applicationID.trimmingCharacters(in: .whitespacesAndNewlines)) }

    func install() {
        let id = applicationID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard InstallerContract.validApplicationID(id) else {
            fail("Enter the 17 to 20 digit Discord Application ID. Do not use a bot or account token."); return
        }
        var resourcesPath: String?
        if useVencord {
            guard let appURL = chooseDiscordApplication() else { return }
            guard appURL.startAccessingSecurityScopedResource() else {
                fail("macOS did not grant access to the selected Discord app. Select it again or use standalone mode."); return
            }
            scopedDiscordURL = appURL
            guard let resources = InstallerContract.discordResources(app: appURL, bundleIdentifier: Bundle(url: appURL)?.bundleIdentifier) else {
                stopDiscordAccess()
                fail("Select the stable Discord app (bundle ID com.hnc.Discord). Canary, PTB, and other apps are not supported."); return
            }
            resourcesPath = resources.path
        }
        guard let arguments = InstallerContract.arguments(operation: "install", applicationID: id, withHooks: withHooks, standalone: !useVencord, discordResources: resourcesPath) else {
            stopDiscordAccess()
            fail("The Application ID is invalid."); return
        }
        run(arguments, operation: .install)
    }

    private func chooseDiscordApplication() -> URL? {
        let panel = NSOpenPanel()
        panel.title = "Choose Discord"
        panel.message = "Select the stable Discord app to install the Vencord plugin into."
        panel.prompt = "Choose Discord"
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = URL(fileURLWithPath: "/Applications", isDirectory: true)
        return panel.runModal() == .OK ? panel.url : nil
    }

    private func stopDiscordAccess() {
        scopedDiscordURL?.stopAccessingSecurityScopedResource()
        scopedDiscordURL = nil
    }

    func uninstall() {
        guard let arguments = InstallerContract.arguments(operation: "uninstall") else { fail("Could not prepare uninstall."); return }
        run(arguments, operation: .uninstall)
    }

    private enum Operation { case install, uninstall }

    private func run(_ arguments: [String], operation: Operation) {
        guard !isWorking, let resources else { fail("Installer payload is incomplete. Download a fresh copy."); return }
        isWorking = true; isError = false; message = ""; progress = operation == .install ? "Preparing installation…" : "Removing Enhanced Presence…"
        let process = Process(), output = OutputCapture(limit: 8192), errors = OutputCapture(limit: 2048)
        process.executableURL = resources.node
        process.arguments = [resources.setupScript.path] + arguments
        process.standardOutput = output.pipe; process.standardError = errors.pipe
        output.start { [weak self] line in
            guard let self, self.isWorking else { return }
            self.progress = line
        }
        errors.start { _ in }
        process.terminationHandler = { [weak self] finished in
            let stdout = output.finish(), stderr = errors.finish()
            DispatchQueue.main.async { self?.finish(operation, status: finished.terminationStatus, stdout: stdout, stderr: stderr) }
        }
        do { try process.run() }
        catch {
            isWorking = false; stopDiscordAccess()
            fail("Could not start the bundled setup tool. Download a fresh copy of the installer.")
        }
    }

    private func finish(_ operation: Operation, status: Int32, stdout: String, stderr: String) {
        isWorking = false
        stopDiscordAccess()
        let resultLine = stdout.split(whereSeparator: \.isNewline).last.map(String.init) ?? stdout
        guard status == 0,
              let data = resultLine.data(using: .utf8),
              let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              result["success"] as? Bool == true else {
            let detail = stderr.split(whereSeparator: \.isNewline).last.map(String.init)
                .map { String($0.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }.prefix(260)) }
            fail(detail?.isEmpty == false ? detail! : "Setup did not finish. Download a fresh copy and try again."); return
        }
        isError = false
        message = operation == .install
            ? "Installed. Open Discord and restart it if it was already running. Use the menu bar helper to review allowed apps, then choose Resume Sharing."
            : "Removed the helper and its optional task hooks. Settings, activity history, and Vencord were preserved."
        if withHooks && operation == .install { message += " Optional task status hooks were enabled." }
        if !useVencord && operation == .install { message += " Standalone mode shares text only." }
        progress = ""
    }

    private func fail(_ text: String) { isError = true; message = String(text.prefix(300)); progress = "" }
}

private struct InstallerView: View {
    @StateObject var model: InstallerModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 14) {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 48, height: 48)
                    .background(Color.accentColor.opacity(0.11), in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Enhanced Presence").font(.title2.weight(.semibold))
                    Text("Install the per-user Discord companion").foregroundStyle(.secondary)
                }
                Spacer()
            }

            Text("Enhanced Presence is an independent, unsigned beta. Its Vencord option modifies Discord, which may violate Discord’s Terms of Service. Read the Terms before installing; no administrator or broad macOS permissions are requested.")
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 7) {
                Text("Discord Application ID").font(.headline)
                TextField("17 to 20 digits", text: $model.applicationID)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Discord Application ID")
                    .disabled(model.isWorking)
                Link("Get an Application ID from Discord Developer Portal", destination: URL(string: "https://discord.com/developers/applications")!)
                    .font(.callout)
                Text("This ID is public. Never enter a bot token or your account token.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 8) {
                Toggle("Use Vencord plugin (recommended)", isOn: $model.useVencord).disabled(model.isWorking)
                Text(model.useVencord ? "Best compatibility, app icons, and activity controls. You’ll choose the stable Discord app before installation." : "Standalone mode does not modify Discord and shares text only.")
                    .font(.caption).foregroundStyle(.secondary).padding(.leading, 24)
                Toggle("Enable optional task status hooks", isOn: $model.withHooks).disabled(model.isWorking)
                Text("Hooks add local Claude Code or Codex task status. Existing hooks stay enabled during updates.")
                    .font(.caption).foregroundStyle(.secondary).padding(.leading, 24)
            }

            HStack(alignment: .center) {
                Text("Read the Terms of Use before installing.").font(.callout).foregroundStyle(.secondary)
                Button("Read Terms") { model.showTerms = true }
                    .buttonStyle(.link).disabled(model.isWorking)
                Spacer()
            }

            if model.isWorking {
                HStack(spacing: 10) {
                    ProgressView().controlSize(.small)
                    Text(model.progress.isEmpty ? "Working…" : model.progress).lineLimit(1).truncationMode(.middle)
                }.accessibilityElement(children: .combine).accessibilityLabel(model.progress)
            }
            if !model.message.isEmpty {
                Text(model.message)
                    .font(.callout)
                    .foregroundStyle(model.isError ? Color.red : Color.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(model.isError ? .isStaticText : .updatesFrequently)
            }
            if model.resources == nil {
                Text("Installer files are incomplete. Download a fresh copy before continuing.")
                    .font(.callout).foregroundStyle(.red)
            }

            Spacer(minLength: 0)
            Divider()
            HStack {
                Button("Uninstall…") { model.confirmUninstall = true }
                    .disabled(model.isWorking || model.resources == nil)
                Spacer()
                Button(model.useVencord ? "Install…" : "Install") { model.install() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!model.canInstall)
            }
        }
        .padding(26)
        .frame(minWidth: 560, idealWidth: 620, minHeight: 500, idealHeight: 540)
        .sheet(isPresented: $model.showTerms) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Terms of Use").font(.title2.weight(.semibold))
                ScrollView { Text(model.termsText).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                HStack { Spacer(); Button("Close") { model.showTerms = false }.keyboardShortcut(.defaultAction) }
            }.padding(20).frame(minWidth: 580, minHeight: 440)
        }
        .confirmationDialog("Uninstall Enhanced Presence?", isPresented: $model.confirmUninstall, titleVisibility: .visible) {
            Button("Uninstall Helper", role: .destructive) { model.uninstall() }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This removes the Enhanced Presence companion and its login service. Your settings, activity history, and Vencord installation are preserved.")
        }
    }
}

@MainActor
private final class InstallerAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow?
    var model: InstallerModel?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let model = InstallerModel()
        self.model = model
        let content = InstallerView(model: model)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 560), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Install Enhanced Presence"
        window.center(); window.contentView = NSHostingView(rootView: content); window.delegate = self
        window.makeKeyAndOrderFront(nil)
        self.window = window
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard model?.isWorking == true else { return true }
        let alert = NSAlert()
        alert.messageText = "Setup is still running"
        alert.informativeText = "Wait for installation or removal to finish before closing this window."
        alert.runModal()
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        model?.isWorking == true ? .terminateCancel : .terminateNow
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main private struct InstallerMain {
    static func main() {
        if CommandLine.arguments.dropFirst().elementsEqual(["--self-test"]) {
            runInstallerSelfTest(); return
        }
        let app = NSApplication.shared
        let delegate = InstallerAppDelegate()
        app.setActivationPolicy(.regular)
        app.delegate = delegate
        app.run()
    }
}

private func runInstallerSelfTest() {
    assert(InstallerContract.validApplicationID("12345678901234567"))
    assert(InstallerContract.validApplicationID("12345678901234567890"))
    for invalid in ["", "1234567890123456", "123456789012345678901", "1234567890123456x", "token-token-token-123"] {
        assert(!InstallerContract.validApplicationID(invalid))
    }
    assert(InstallerContract.arguments(operation: "install", applicationID: "12345678901234567", withHooks: true, standalone: true) == ["install", "--application-id", "12345678901234567", "--with-hooks", "--standalone"])
    assert(InstallerContract.arguments(operation: "uninstall") == ["uninstall"])
    assert(InstallerContract.arguments(operation: "repair") == nil)
    let discordApp = URL(fileURLWithPath: "/Applications/Discord.app")
    let discordResources = InstallerContract.discordResources(app: discordApp, bundleIdentifier: "com.hnc.Discord")!
    assert(discordResources.path == "/Applications/Discord.app/Contents/Resources")
    assert(InstallerContract.discordResources(app: discordApp, bundleIdentifier: "com.hnc.DiscordCanary") == nil)
    assert(InstallerContract.discordResources(app: URL(fileURLWithPath: "/Applications/Other.app"), bundleIdentifier: "com.example.Other") == nil)
    assert(InstallerContract.arguments(operation: "install", applicationID: "12345678901234567", discordResources: discordResources.path)?.suffix(2) == ["--discord-resources", discordResources.path])
    assert(InstallerContract.arguments(operation: "install", applicationID: "12345678901234567") == nil)
    assert(InstallerContract.arguments(operation: "install", applicationID: "12345678901234567", standalone: true, discordResources: discordResources.path) == nil)
    let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("presence-installer-\(UUID().uuidString)", isDirectory: true)
    let helper = scratch.appendingPathComponent("payload/EnhancedPresence Helper.app/Contents/Resources", isDirectory: true)
    let helperContents = helper.deletingLastPathComponent()
    let resources = scratch
    let node = helper.appendingPathComponent("runtime/node")
    let script = helper.appendingPathComponent("scripts/bundle-setup.mjs")
    let helperExecutable = helperContents.appendingPathComponent("MacOS/EnhancedPresenceHelper")
    let terms = resources.appendingPathComponent("TERMS.md")
    do {
        try FileManager.default.createDirectory(at: node.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: script.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: helperExecutable.deletingLastPathComponent(), withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: helperContents.appendingPathComponent("Info.plist").path, contents: Data())
        FileManager.default.createFile(atPath: node.path, contents: Data())
        FileManager.default.createFile(atPath: script.path, contents: Data())
        FileManager.default.createFile(atPath: helperExecutable.path, contents: Data())
        FileManager.default.createFile(atPath: terms.path, contents: Data())
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: node.path)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: helperExecutable.path)
        assert(InstallerResources.resolve(resources: resources) != nil)
        try FileManager.default.removeItem(at: script)
        assert(InstallerResources.resolve(resources: resources) == nil)
    } catch { assertionFailure("Installer self-test setup failed: \(error)") }
    try? FileManager.default.removeItem(at: scratch)
    print("Installer checks passed")
}
