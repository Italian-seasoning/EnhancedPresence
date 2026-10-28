export function createInstalledIconLookup(options: {
    roots: string[];
    exists(path: string): boolean;
    findBundle(id: string): Promise<string[]>;
    getFileIcon(path: string): Promise<string>;
}): (id: string) => Promise<string | undefined>;
