export function createClient(options: {
  getSettings: () => { applicationId: string; bridgeToken: string; paused: boolean; appIcons?: boolean };
  dispatch: (activity: unknown) => void;
  socketFactory: (url: string) => WebSocket;
  resolveAsset?: (applicationId: string, key: string) => Promise<string | undefined>;
  shouldPublishMusic?: (activity: unknown) => boolean;
  status?: (value: string) => void;
}): { start(): void; stop(): void; refresh(): void };
