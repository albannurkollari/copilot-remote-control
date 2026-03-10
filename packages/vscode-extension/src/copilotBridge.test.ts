import { vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { __testing } from './copilotBridge.ts';

describe('copilot bridge tool execution helpers', () => {
  it('normalizes safe workspace-relative paths', () => {
    expect(__testing.normalizeWorkspaceRelativePath('src\\index.ts')).toBe(
      'src/index.ts'
    );
    expect(__testing.normalizeWorkspaceRelativePath('/nested/file.ts')).toBe(
      'nested/file.ts'
    );
  });

  it('rejects paths that escape the workspace', () => {
    expect(() => __testing.normalizeWorkspaceRelativePath('../secret.txt')).toThrow(
      /within the current workspace/
    );
  });

  it('builds a terminal command execution plan', () => {
    expect(
      __testing.toToolExecutionPlan('run_terminal_command', {
        command: 'pnpm test'
      })
    ).toEqual({
      kind: 'run_terminal_command',
      command: 'pnpm test'
    });
  });

  it('requires concrete file content for file edits', () => {
    expect(
      __testing.toToolExecutionPlan('edit_file', {
        filePath: 'src/index.ts',
        summary: 'Update entrypoint',
        content: 'console.log("hi")\n'
      })
    ).toEqual({
      kind: 'edit_file',
      filePath: 'src/index.ts',
      summary: 'Update entrypoint',
      content: 'console.log("hi")\n'
    });
  });

  it('maps command payload args for execute_tool', () => {
    expect(
      __testing.toToolExecutionPlan('execute_tool', {
        toolName: 'workbench.action.files.save',
        input: { args: ['a', 2] }
      })
    ).toEqual({
      kind: 'execute_tool',
      commandId: 'workbench.action.files.save',
      args: ['a', 2]
    });
  });

  it('summarizes command results safely', () => {
    expect(__testing.stringifyToolResult(undefined)).toContain(
      'without a return value'
    );
    expect(__testing.stringifyToolResult({ ok: true })).toContain('"ok": true');
  });
});
