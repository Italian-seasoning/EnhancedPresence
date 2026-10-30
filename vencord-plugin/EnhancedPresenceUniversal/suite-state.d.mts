export interface FeatureSettings {
  musicPlayer: boolean;
  messageShelf: boolean;
  workspaces: boolean;
  notifications: boolean;
  voice: boolean;
}

export function featureSettings(value: unknown): FeatureSettings;
export function collectionsKey(accountId: string): string;
export function featuresKey(accountId: string): string;
export function notificationRulesKey(accountId: string): string;
