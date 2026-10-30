export type NotificationAction = "mute" | "group";
export type NotificationRule = {
  id: string;
  enabled: boolean;
  action: NotificationAction;
  personId?: string;
  channelId?: string;
  keyword?: string;
};
export type GroupedNotification = {
  ruleId: string;
  channelId: string;
  authorId: string;
  authorName: string;
  channelName: string;
  count: number;
  firstAt: number;
  lastAt: number;
};
export function validateNotificationRules(value: unknown): NotificationRule[];
export function matchNotificationRule(rules: unknown, notification: unknown): NotificationRule | null;
export function previewNotificationRule(rule: unknown, notification: unknown): { matches: boolean; action: NotificationAction | null };
export function shouldShowDesktopNotification(message: unknown, router: ReturnType<typeof createNotificationRouter>, options?: { getChannel?: (id: string) => { name?: string } | undefined; currentUserId?: string }): boolean;
export function createNotificationRouter(options?: {
  getRules?: () => unknown;
  getEnabled?: () => boolean;
  emitGroup?: (group: GroupedNotification) => void;
  now?: () => number;
  maxGroups?: number;
}): {
  route(notification: unknown): "notify" | "muted" | "grouped";
  snapshot(): GroupedNotification[];
  clearGroups(): void;
  start(): void;
  stop(): void;
};
