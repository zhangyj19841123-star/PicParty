export const WORKSPACE_PAGE_COUNTS = [1, 2, 3, 4, 6, 8, 10] as const;
export type WorkspacePageCount = typeof WORKSPACE_PAGE_COUNTS[number];
export type WorkspaceMode = WorkspacePageCount | 'overview';

export function isWorkspacePageCount(value: number): value is WorkspacePageCount {
  return WORKSPACE_PAGE_COUNTS.some(count => count === value);
}

/** Read the complete command suffix: view-10 must never become view-0. */
export function workspaceModeFromCommand(command: string): WorkspacePageCount | null {
  const match = /^(?:view|workspace)-(1|2|3|4|6|8|10)$/.exec(command);
  if (!match) return null;
  const value = Number(match[1]);
  return isWorkspacePageCount(value) ? value : null;
}

/** Overview may show five, seven or nine selected pages without filling slots. */
export function workspaceModeForSelection(count: number): WorkspacePageCount | null {
  if (!Number.isInteger(count) || count < 1 || count > 10) return null;
  return WORKSPACE_PAGE_COUNTS.find(mode => mode >= count) ?? null;
}
