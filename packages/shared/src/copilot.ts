import path from 'node:path';

import type { CopilotMode, CopilotPromptMessage } from './protocol.ts';

export type TerminalCommandExecution = {
  command: string;
  kind: 'run_terminal_command';
};

export type FileEditExecution = {
  content: string;
  filePath: string;
  kind: 'edit_file';
};

export type VsCodeCommandExecution = {
  args: unknown[];
  commandId: string;
  kind: 'execute_tool';
};

export type ToolExecutionPlan =
  | TerminalCommandExecution
  | FileEditExecution
  | VsCodeCommandExecution;

export const DEFAULT_MAX_SESSION_MESSAGES = 24;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

export const createModeInstruction = (mode: CopilotMode) => {
  switch (mode) {
    case 'ask':
      return 'Reply briefly.';
    case 'plan':
      return 'Reply with a brief plan.';
    case 'agent':
      return 'Act and reply briefly.';
  }
};

export const renderPromptText = (message: CopilotPromptMessage) => {
  return [
    createModeInstruction(message.mode),
    `Ctx:${message.userDisplayName ?? 'unknown'}@${message.clientId}`,
    message.prompt
  ].join('\n');
};

export const normalizeMaxSessionMessages = (value?: number) => {
  if (value === undefined || Number.isNaN(value)) {
    return DEFAULT_MAX_SESSION_MESSAGES;
  }

  return Math.max(1, Math.floor(value));
};

export const trimConversation = <T>(messages: T[], maxMessages: number) => {
  if (messages.length <= maxMessages) {
    return [...messages];
  }

  return messages.slice(-maxMessages);
};

export const normalizeWorkspaceRelativePath = (filePath: string) => {
  const trimmed = filePath.trim();
  if (trimmed.length === 0) {
    throw new Error('File path must not be empty.');
  }

  const normalized = path.posix.normalize(
    trimmed.replace(/\\/g, '/').replace(/^\/+/g, '')
  );

  if (
    normalized.length === 0 ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(
      `File path must stay within the current workspace: ${filePath}`
    );
  }

  return normalized;
};

export const toCommandArgs = (input: unknown) => {
  if (!isRecord(input)) {
    return input === undefined ? [] : [input];
  }

  if (Array.isArray(input.args)) {
    return [...input.args];
  }

  return Object.keys(input).length === 0 ? [] : [input];
};

export const toToolExecutionPlan = (
  name: string,
  input: object
): ToolExecutionPlan => {
  const data = input as Record<string, unknown>;

  if (name === 'run_terminal_command') {
    if (!isNonEmptyString(data.command)) {
      throw new Error('run_terminal_command requires a non-empty command.');
    }

    return {
      kind: 'run_terminal_command',
      command: data.command.trim()
    };
  }

  if (name === 'edit_file') {
    if (!isNonEmptyString(data.filePath)) {
      throw new Error('edit_file requires a non-empty filePath.');
    }

    if (!isNonEmptyString(data.content)) {
      throw new Error('edit_file requires a non-empty content string.');
    }

    return {
      kind: 'edit_file',
      filePath: data.filePath.trim(),
      content: data.content
    };
  }

  if (name === 'execute_tool') {
    if (!isNonEmptyString(data.toolName)) {
      throw new Error('execute_tool requires a non-empty toolName.');
    }

    return {
      kind: 'execute_tool',
      commandId: data.toolName.trim(),
      args: toCommandArgs(data.input)
    };
  }

  throw new Error(`Unsupported tool call: ${name}`);
};
