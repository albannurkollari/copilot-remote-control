import {
  createModeInstruction,
  DEFAULT_MAX_SESSION_MESSAGES,
  normalizeMaxSessionMessages,
  normalizeWorkspaceRelativePath,
  renderPromptText,
  toCommandArgs,
  toToolExecutionPlan,
  trimConversation,
  type CopilotPromptMessage
} from './index.ts';

describe('copilot shared helpers', () => {
  it('renders compact prompt text', () => {
    const message: CopilotPromptMessage = {
      type: 'copilot_prompt',
      clientId: 'default',
      requestId: 'req-1',
      mode: 'plan',
      prompt: 'Add tests',
      userDisplayName: 'alice'
    };

    expect(renderPromptText(message)).toBe(
      'Reply with a brief plan.\nCtx:alice@default\nAdd tests'
    );
  });

  it('uses short mode instructions', () => {
    expect(createModeInstruction('ask')).toBe('Reply briefly.');
    expect(createModeInstruction('plan')).toBe('Reply with a brief plan.');
    expect(createModeInstruction('agent')).toBe('Act and reply briefly.');
  });

  it('normalizes max retained session messages', () => {
    expect(normalizeMaxSessionMessages()).toBe(DEFAULT_MAX_SESSION_MESSAGES);
    expect(normalizeMaxSessionMessages(Number.NaN)).toBe(
      DEFAULT_MAX_SESSION_MESSAGES
    );
    expect(normalizeMaxSessionMessages(0)).toBe(1);
    expect(normalizeMaxSessionMessages(5.8)).toBe(5);
  });

  it('trims retained conversation to the newest messages', () => {
    expect(trimConversation([1, 2, 3, 4], 2)).toEqual([3, 4]);
    expect(trimConversation([1, 2], 4)).toEqual([1, 2]);
  });

  it('normalizes safe workspace-relative paths', () => {
    expect(normalizeWorkspaceRelativePath('src\\index.ts')).toBe(
      'src/index.ts'
    );
    expect(normalizeWorkspaceRelativePath('/nested/file.ts')).toBe(
      'nested/file.ts'
    );
  });

  it('rejects paths that escape the workspace', () => {
    expect(() => normalizeWorkspaceRelativePath('../secret.txt')).toThrow(
      /within the current workspace/
    );
    expect(() => normalizeWorkspaceRelativePath('   ')).toThrow(
      /File path must not be empty/
    );
  });

  it('maps command payload args', () => {
    expect(toCommandArgs(undefined)).toEqual([]);
    expect(toCommandArgs('one')).toEqual(['one']);
    expect(toCommandArgs({})).toEqual([]);
    expect(toCommandArgs({ args: ['a', 2] })).toEqual(['a', 2]);
    expect(toCommandArgs({ foo: 'bar' })).toEqual([{ foo: 'bar' }]);
  });

  it('builds tool execution plans', () => {
    expect(
      toToolExecutionPlan('run_terminal_command', {
        command: 'pnpm test'
      })
    ).toEqual({
      kind: 'run_terminal_command',
      command: 'pnpm test'
    });

    expect(
      toToolExecutionPlan('edit_file', {
        filePath: 'src/index.ts',
        content: 'console.log("hi")\n'
      })
    ).toEqual({
      kind: 'edit_file',
      filePath: 'src/index.ts',
      content: 'console.log("hi")\n'
    });

    expect(
      toToolExecutionPlan('execute_tool', {
        toolName: 'workbench.action.files.save',
        input: { args: ['a', 2] }
      })
    ).toEqual({
      kind: 'execute_tool',
      commandId: 'workbench.action.files.save',
      args: ['a', 2]
    });
  });

  it('rejects invalid tool execution plans', () => {
    expect(() =>
      toToolExecutionPlan('run_terminal_command', { command: '   ' })
    ).toThrow(/non-empty command/);
    expect(() =>
      toToolExecutionPlan('edit_file', { filePath: '', content: 'x' })
    ).toThrow(/non-empty filePath/);
    expect(() =>
      toToolExecutionPlan('edit_file', {
        filePath: 'src/index.ts',
        content: '  '
      })
    ).toThrow(/non-empty content string/);
    expect(() => toToolExecutionPlan('execute_tool', { toolName: '' })).toThrow(
      /non-empty toolName/
    );
    expect(() => toToolExecutionPlan('other', {})).toThrow(/Unsupported/);
  });
});
