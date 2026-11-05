export const STUDIO_DIRECTORY: string;

export const STUDIO_CI_FILES: readonly string[];

export function isStudioPath(file: string): boolean;

export function studioScope(input: { eventName: string; changedFiles: string[] | undefined }): {
  run: boolean;
  reason: string;
};

export function pullRequestChangedFiles(git?: (args: string[]) => string): string[] | undefined;
