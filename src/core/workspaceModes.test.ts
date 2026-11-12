import { describe, expect, it } from 'vitest';
import { workspaceModeForSelection, workspaceModeFromCommand } from './workspaceModes';

describe('expanded workspace modes', () => {
  it('parses exact native and browser commands including the whole ten-page suffix', () => {
    for (const mode of [1, 2, 3, 4, 6, 8, 10]) {
      expect(workspaceModeFromCommand(`view-${mode}`)).toBe(mode);
      expect(workspaceModeFromCommand(`workspace-${mode}`)).toBe(mode);
    }
    for (const command of ['view-0', 'view-5', 'view-7', 'view-9', 'view-11', 'view-01', 'view-10-extra', 'workspace-100', 'something-view-10']) expect(workspaceModeFromCommand(command)).toBeNull();
  });
  it('chooses the smallest supported capacity for exactly one through ten selected pages', () => {
    expect(Array.from({ length: 10 }, (_, index) => workspaceModeForSelection(index + 1))).toEqual([1, 2, 3, 4, 6, 6, 8, 8, 10, 10]);
    for (const count of [0, -1, 11, 2.5, NaN, Infinity]) expect(workspaceModeForSelection(count)).toBeNull();
  });
});
