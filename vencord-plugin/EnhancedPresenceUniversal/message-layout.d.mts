type LayoutMessage = {
  id: string;
  channel_id: string;
  author: { id: string };
  type: number;
  timestamp: Date;
  blocked?: boolean;
  webhookId?: string | null;
  webhook_id?: string | null;
};
export function isRepeatedAuthor(messages: LayoutMessage[] | undefined, message: LayoutMessage | undefined): boolean;
