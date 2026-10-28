// Chooses where activity goes: the Vencord plugin (through the loopback bridge) or Discord's local
// IPC, which works without Vencord. In 'auto', IPC takes over when no plugin has been connected
// for a grace period and steps aside as soon as one connects, so only one source publishes.
export class OutputController {
  constructor({ bridge, rpc, mode = () => 'auto', graceMs = 20000, now = Date.now }) {
    Object.assign(this, { bridge, rpc, mode, graceMs, now });
    this.activity = null; this.ipcActive = false; this.unconnectedSince = now();
  }
  get ipcWanted() {
    const mode = this.mode();
    if (!this.rpc || mode === 'vencord') return false;
    if (mode === 'ipc') return true;
    if (!this.bridge) return true;
    if (this.bridge.authenticatedCount() > 0) { this.unconnectedSince = null; return false; }
    this.unconnectedSince ??= this.now();
    return this.now() - this.unconnectedSince >= this.graceMs;
  }
  // Call on every activity change and periodically.
  update(activity = this.activity) {
    this.activity = activity;
    this.bridge?.update(activity);
    const wanted = this.ipcWanted;
    if (wanted && !this.ipcActive) { this.ipcActive = true; this.rpc.start(); }
    if (!wanted && this.ipcActive) { this.ipcActive = false; this.rpc.update(null); void this.rpc.stop(); return; }
    if (this.ipcActive) this.rpc.update(activity);
  }
  get source() { return this.ipcActive ? 'ipc' : this.bridge?.authenticatedCount() > 0 ? 'vencord' : 'none'; }
  async stop() { if (this.ipcActive) await this.rpc.stop(); await this.bridge?.stop(); }
}
