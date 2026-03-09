export const CLIENT_ROLES = ['discord', 'vscode'] as const;
export const COPILOT_MODES = ['ask', 'plan', 'agent'] as const;
export const RELAY_STATUS_LEVELS = ['info', 'warning', 'error'] as const;
export const PERMISSION_ACTIONS = [
  'run_terminal_command',
  'edit_file',
  'execute_tool',
  'other'
] as const;

export type ClientRole = (typeof CLIENT_ROLES)[number];
export type CopilotMode = (typeof COPILOT_MODES)[number];
export type RelayStatusLevel = (typeof RELAY_STATUS_LEVELS)[number];
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type RelayStatusCode =
  | 'client_connected'
  | 'client_disconnected'
  | 'target_not_connected'
  | 'request_cancelled'
  | 'request_failed'
  | 'malformed_message'
  | 'unsupported_message'
  | 'authorization_required';

export type RelayMessageType =
  | 'register'
  | 'register_ack'
  | 'relay_status'
  | 'copilot_prompt'
  | 'copilot_stream'
  | 'permission_request'
  | 'permission_response'
  | 'ping'
  | 'pong';

export interface RegisterMessage {
  type: 'register';
  clientRole: ClientRole;
  clientId: string;
  sharedSecret?: string;
}

export interface RegisterAckMessage {
  type: 'register_ack';
  clientRole: ClientRole;
  clientId: string;
  connectionId: string;
}

export interface RelayStatusMessage {
  type: 'relay_status';
  level: RelayStatusLevel;
  code: RelayStatusCode;
  message: string;
  requestId?: string;
  clientId?: string;
  targetClientRole?: ClientRole;
}

export interface CopilotPromptMessage {
  type: 'copilot_prompt';
  clientId: string;
  requestId: string;
  mode: CopilotMode;
  prompt: string;
  userDisplayName?: string;
  channelId?: string;
  threadId?: string;
  messageId?: string;
}

export interface CopilotStreamMessage {
  type: 'copilot_stream';
  clientId: string;
  requestId: string;
  done: boolean;
  delta?: string;
  error?: string;
  modelId?: string;
}

export interface PermissionRequestMessage {
  type: 'permission_request';
  clientId: string;
  requestId: string;
  permissionId: string;
  action: PermissionAction;
  title: string;
  details?: string;
  command?: string;
}

export interface PermissionResponseMessage {
  type: 'permission_response';
  clientId: string;
  requestId: string;
  permissionId: string;
  approved: boolean;
  reason?: string;
}

export interface PingMessage {
  type: 'ping';
  timestamp: string;
}

export interface PongMessage {
  type: 'pong';
  timestamp: string;
}

export type RelayMessage =
  | RegisterMessage
  | RegisterAckMessage
  | RelayStatusMessage
  | CopilotPromptMessage
  | CopilotStreamMessage
  | PermissionRequestMessage
  | PermissionResponseMessage
  | PingMessage
  | PongMessage;

export type ParseRelayMessageResult =
  | { ok: true; value: RelayMessage }
  | { ok: false; error: string };

const hasOwn = <K extends string>(
  value: object,
  key: K
): value is object & Record<K, unknown> => {
  return Object.prototype.hasOwnProperty.call(value, key);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const isString = (value: unknown): value is string => {
  return typeof value === 'string';
};

const isNonEmptyString = (value: unknown): value is string => {
  return isString(value) && value.trim().length > 0;
};

const isBoolean = (value: unknown): value is boolean => {
  return typeof value === 'boolean';
};

const isClientRole = (value: unknown): value is ClientRole => {
  return isString(value) && CLIENT_ROLES.includes(value as ClientRole);
};

const isCopilotMode = (value: unknown): value is CopilotMode => {
  return isString(value) && COPILOT_MODES.includes(value as CopilotMode);
};

const isRelayStatusLevel = (value: unknown): value is RelayStatusLevel => {
  return (
    isString(value) && RELAY_STATUS_LEVELS.includes(value as RelayStatusLevel)
  );
};

const isPermissionAction = (value: unknown): value is PermissionAction => {
  return (
    isString(value) && PERMISSION_ACTIONS.includes(value as PermissionAction)
  );
};

const isRelayStatusCode = (value: unknown): value is RelayStatusCode => {
  return (
    value === 'client_connected' ||
    value === 'client_disconnected' ||
    value === 'target_not_connected' ||
    value === 'request_cancelled' ||
    value === 'request_failed' ||
    value === 'malformed_message' ||
    value === 'unsupported_message' ||
    value === 'authorization_required'
  );
};

export const isRelayMessage = (value: unknown): value is RelayMessage => {
  return parseRelayMessage(value).ok;
};

export const parseRelayMessage = (value: unknown): ParseRelayMessageResult => {
  const payload = (() => {
    if (!isString(value)) {
      return value;
    }

    try {
      return JSON.parse(value) as unknown;
    } catch {
      return Symbol.for('remote-copilot.invalid-json');
    }
  })();

  if (payload === Symbol.for('remote-copilot.invalid-json')) {
    return { ok: false, error: 'Message is not valid JSON.' };
  }

  if (
    !isRecord(payload) ||
    !hasOwn(payload, 'type') ||
    !isString(payload.type)
  ) {
    return {
      ok: false,
      error: 'Message must be an object with a string type.'
    };
  }

  const message = payload as Record<string, unknown> & { type: string };

  switch (message.type) {
    case 'register':
      if (
        !isClientRole(message.clientRole) ||
        !isNonEmptyString(message.clientId) ||
        (hasOwn(message, 'sharedSecret') &&
          message.sharedSecret !== undefined &&
          !isNonEmptyString(message.sharedSecret))
      ) {
        return {
          ok: false,
          error:
            'Register messages require clientRole, clientId, and an optional non-empty sharedSecret.'
        };
      }

      return {
        ok: true,
        value: {
          type: 'register',
          clientRole: message.clientRole,
          clientId: message.clientId,
          ...(isNonEmptyString(message.sharedSecret)
            ? { sharedSecret: message.sharedSecret }
            : {})
        }
      };

    case 'register_ack':
      if (
        !isClientRole(message.clientRole) ||
        !isNonEmptyString(message.clientId) ||
        !isNonEmptyString(message.connectionId)
      ) {
        return {
          ok: false,
          error:
            'Register acknowledgement messages require clientRole, clientId, and connectionId.'
        };
      }

      return {
        ok: true,
        value: {
          type: 'register_ack',
          clientRole: message.clientRole,
          clientId: message.clientId,
          connectionId: message.connectionId
        }
      };

    case 'relay_status':
      if (
        !isRelayStatusLevel(message.level) ||
        !isRelayStatusCode(message.code) ||
        !isNonEmptyString(message.message)
      ) {
        return {
          ok: false,
          error: 'Relay status messages require level, code, and message.'
        };
      }

      if (
        hasOwn(message, 'requestId') &&
        message.requestId !== undefined &&
        !isNonEmptyString(message.requestId)
      ) {
        return {
          ok: false,
          error: 'Relay status requestId must be a non-empty string.'
        };
      }

      if (
        hasOwn(message, 'clientId') &&
        message.clientId !== undefined &&
        !isNonEmptyString(message.clientId)
      ) {
        return {
          ok: false,
          error: 'Relay status clientId must be a non-empty string.'
        };
      }

      if (
        hasOwn(message, 'targetClientRole') &&
        message.targetClientRole !== undefined &&
        !isClientRole(message.targetClientRole)
      ) {
        return {
          ok: false,
          error: 'Relay status targetClientRole must be a valid client role.'
        };
      }

      return {
        ok: true,
        value: {
          type: 'relay_status',
          level: message.level,
          code: message.code,
          message: message.message,
          requestId: isString(message.requestId)
            ? message.requestId
            : undefined,
          clientId: isString(message.clientId) ? message.clientId : undefined,
          targetClientRole: isClientRole(message.targetClientRole)
            ? message.targetClientRole
            : undefined
        }
      };

    case 'copilot_prompt':
      if (
        !isNonEmptyString(message.clientId) ||
        !isNonEmptyString(message.requestId) ||
        !isCopilotMode(message.mode) ||
        !isNonEmptyString(message.prompt)
      ) {
        return {
          ok: false,
          error:
            'Copilot prompt messages require clientId, requestId, mode, and prompt.'
        };
      }

      return {
        ok: true,
        value: {
          type: 'copilot_prompt',
          clientId: message.clientId,
          requestId: message.requestId,
          mode: message.mode,
          prompt: message.prompt,
          userDisplayName: isString(message.userDisplayName)
            ? message.userDisplayName
            : undefined,
          channelId: isString(message.channelId)
            ? message.channelId
            : undefined,
          threadId: isString(message.threadId) ? message.threadId : undefined,
          messageId: isString(message.messageId) ? message.messageId : undefined
        }
      };

    case 'copilot_stream':
      if (
        !isNonEmptyString(message.clientId) ||
        !isNonEmptyString(message.requestId) ||
        !isBoolean(message.done)
      ) {
        return {
          ok: false,
          error:
            'Copilot stream messages require clientId, requestId, and done.'
        };
      }

      if (
        hasOwn(message, 'delta') &&
        message.delta !== undefined &&
        !isString(message.delta)
      ) {
        return { ok: false, error: 'Copilot stream delta must be a string.' };
      }

      if (
        hasOwn(message, 'error') &&
        message.error !== undefined &&
        !isString(message.error)
      ) {
        return { ok: false, error: 'Copilot stream error must be a string.' };
      }

      if (
        hasOwn(message, 'modelId') &&
        message.modelId !== undefined &&
        !isString(message.modelId)
      ) {
        return { ok: false, error: 'Copilot stream modelId must be a string.' };
      }

      return {
        ok: true,
        value: {
          type: 'copilot_stream',
          clientId: message.clientId,
          requestId: message.requestId,
          done: message.done,
          delta: isString(message.delta) ? message.delta : undefined,
          error: isString(message.error) ? message.error : undefined,
          modelId: isString(message.modelId) ? message.modelId : undefined
        }
      };

    case 'permission_request':
      if (
        !isNonEmptyString(message.clientId) ||
        !isNonEmptyString(message.requestId) ||
        !isNonEmptyString(message.permissionId) ||
        !isPermissionAction(message.action) ||
        !isNonEmptyString(message.title)
      ) {
        return {
          ok: false,
          error:
            'Permission request messages require clientId, requestId, permissionId, action, and title.'
        };
      }

      if (
        hasOwn(message, 'details') &&
        message.details !== undefined &&
        !isString(message.details)
      ) {
        return {
          ok: false,
          error: 'Permission request details must be a string.'
        };
      }

      if (
        hasOwn(message, 'command') &&
        message.command !== undefined &&
        !isString(message.command)
      ) {
        return {
          ok: false,
          error: 'Permission request command must be a string.'
        };
      }

      return {
        ok: true,
        value: {
          type: 'permission_request',
          clientId: message.clientId,
          requestId: message.requestId,
          permissionId: message.permissionId,
          action: message.action,
          title: message.title,
          details: isString(message.details) ? message.details : undefined,
          command: isString(message.command) ? message.command : undefined
        }
      };

    case 'permission_response':
      if (
        !isNonEmptyString(message.clientId) ||
        !isNonEmptyString(message.requestId) ||
        !isNonEmptyString(message.permissionId) ||
        !isBoolean(message.approved)
      ) {
        return {
          ok: false,
          error:
            'Permission response messages require clientId, requestId, permissionId, and approved.'
        };
      }

      if (
        hasOwn(message, 'reason') &&
        message.reason !== undefined &&
        !isString(message.reason)
      ) {
        return {
          ok: false,
          error: 'Permission response reason must be a string.'
        };
      }

      return {
        ok: true,
        value: {
          type: 'permission_response',
          clientId: message.clientId,
          requestId: message.requestId,
          permissionId: message.permissionId,
          approved: message.approved,
          reason: isString(message.reason) ? message.reason : undefined
        }
      };

    case 'ping':
    case 'pong':
      if (!isNonEmptyString(message.timestamp)) {
        return {
          ok: false,
          error: `${message.type} messages require a timestamp.`
        };
      }

      return {
        ok: true,
        value: {
          type: message.type,
          timestamp: message.timestamp
        }
      };

    default:
      return {
        ok: false,
        error: `Unsupported relay message type: ${message.type}`
      };
  }
};

export const serializeRelayMessage = (message: RelayMessage) => {
  return JSON.stringify(message);
};

export const createRequestId = () => {
  return `req_${crypto.randomUUID()}`;
};

export const createPermissionId = () => {
  return `perm_${crypto.randomUUID()}`;
};

export const createPingMessage = (): PingMessage => {
  return {
    type: 'ping',
    timestamp: new Date().toISOString()
  };
};

export const createPongMessage = (): PongMessage => {
  return {
    type: 'pong',
    timestamp: new Date().toISOString()
  };
};
