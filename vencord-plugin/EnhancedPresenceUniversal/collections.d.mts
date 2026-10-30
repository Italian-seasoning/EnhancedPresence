export interface SavedMessage {
  channelId: string;
  messageId: string;
  guildId?: string;
  label?: string;
  note?: string;
  tags: string[];
  savedAt: number;
}

export interface WorkspaceChannel {
  channelId: string;
  guildId?: string;
  label?: string;
}

export interface Workspace {
  id: string;
  name: string;
  channels: WorkspaceChannel[];
}

export interface Collections {
  version: 1;
  accountId: string;
  savedMessages: SavedMessage[];
  workspaces: Workspace[];
}

export type SaveMessageInput = Pick<SavedMessage, 'channelId' | 'messageId'> & Partial<Omit<SavedMessage, 'channelId' | 'messageId' | 'savedAt'>>;
export type UpdateSavedMessageInput = Pick<SavedMessage, 'channelId' | 'messageId'> & Partial<Pick<SavedMessage, 'label' | 'note' | 'tags'>>;
export type WorkspaceInput = Workspace;

export function emptyCollections(accountId: string): Collections;
export function validateCollections(value: unknown, accountId: string): Collections;
export function saveMessage(state: Collections, input: SaveMessageInput): Collections;
export function updateSavedMessage(state: Collections, input: UpdateSavedMessageInput): Collections;
export function removeSavedMessage(state: Collections, input: Pick<SavedMessage, 'channelId' | 'messageId'>): Collections;
export function searchSavedMessages(state: Collections, query?: string): SavedMessage[];
export function saveWorkspace(state: Collections, input: WorkspaceInput): Collections;
export function removeWorkspace(state: Collections, id: string): Collections;
export function serializeCollections(state: Collections): string;
export function parseCollections(encoded: string, accountId: string): Collections;
