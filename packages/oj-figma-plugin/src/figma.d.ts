// Minimal ambient types for the slice of the Figma Plugin API this plugin uses.
// Kept local (instead of depending on @figma/plugin-typings) so the package has ZERO
// dependencies — nothing to add to the root lockfile, nothing to break a frozen install.
// If this plugin ever grows, swap this for `@figma/plugin-typings` as a devDependency.

export {};

declare global {
  interface BaseNode {
    readonly id: string;
    readonly type: string;
  }
  interface ComponentNode extends BaseNode {
    description: string;
    documentationLinks: ReadonlyArray<{ uri: string }>;
  }
  interface ComponentSetNode extends BaseNode {
    description: string;
    documentationLinks: ReadonlyArray<{ uri: string }>;
  }
  const figma: {
    loadAllPagesAsync(): Promise<void>;
    getNodeByIdAsync(id: string): Promise<BaseNode | null>;
    closePlugin(message?: string): void;
  };
}
