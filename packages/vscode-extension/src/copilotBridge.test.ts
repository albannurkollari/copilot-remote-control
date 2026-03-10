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
        content: 'console.log("hi")\n'
      })
    ).toEqual({
      kind: 'edit_file',
      filePath: 'src/index.ts',
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

  it('uses the minimal execution result payload', () => {
    expect(__testing.createExecutionResult()).toBe('ok');
  });

  it('renders a compact Copilot prompt', () => {
    expect(
      __testing.renderPromptText({
        type: 'copilot_prompt',
        clientId: 'default',
        requestId: 'req-1',
        mode: 'plan',
        prompt: 'Add tests',
        userDisplayName: 'alice'
      })
    ).toBe('Reply with a brief plan.\nCtx:alice@default\nAdd tests');
  });

  it('keeps tool descriptions short', () => {
    expect(__testing.remoteTools.map((tool) => tool.description)).toEqual([
      'Run a terminal command after approval.',
      'Write a workspace file after approval.',
      'Run a VS Code command after approval.'
    ]);
  });

  it('uses short mode instructions', () => {
    expect(__testing.createModeInstruction('ask')).toBe('Reply briefly.');
    expect(__testing.createModeInstruction('plan')).toBe(
      'Reply with a brief plan.'
    );
    expect(__testing.createModeInstruction('agent')).toBe(
      'Act and reply briefly.'
    );
  });
});
