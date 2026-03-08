declare module 'vscode' {
  export namespace lm {
    function selectChatModels(selector: {
      vendor?: string;
      family?: string;
    }): Thenable<LanguageModelChat[]>;
  }

  export interface LanguageModelAccessInformation {
    canSendRequest(chat: LanguageModelChat): boolean | undefined;
  }

  export interface ExtensionContext {
    readonly languageModelAccessInformation: LanguageModelAccessInformation;
  }

  export interface LanguageModelChat {
    readonly id?: string;
    sendRequest(
      messages: LanguageModelChatMessage[],
      options?: LanguageModelChatRequestOptions,
      token?: CancellationToken
    ): Thenable<LanguageModelChatResponse>;
  }

  export interface LanguageModelChatRequestOptions {
    tools?: LanguageModelChatTool[];
  }

  export interface LanguageModelChatTool {
    name: string;
    description: string;
    inputSchema?: object;
  }

  export interface LanguageModelChatResponse {
    stream: AsyncIterable<
      LanguageModelTextPart | LanguageModelToolCallPart | unknown
    >;
    text: AsyncIterable<string>;
  }

  export class LanguageModelChatMessage {
    static User(
      content:
        | string
        | Array<LanguageModelTextPart | LanguageModelToolResultPart | unknown>,
      name?: string
    ): LanguageModelChatMessage;
    static Assistant(
      content: Array<
        LanguageModelTextPart | LanguageModelToolCallPart | unknown
      >,
      name?: string
    ): LanguageModelChatMessage;
  }

  export class LanguageModelTextPart {
    constructor(value: string);
    value: string;
  }

  export class LanguageModelToolCallPart {
    constructor(callId: string, name: string, input: object);
    callId: string;
    name: string;
    input: object;
  }

  export class LanguageModelToolResultPart {
    constructor(
      callId: string,
      content: Array<LanguageModelTextPart | unknown>
    );
    callId: string;
    content: Array<LanguageModelTextPart | unknown>;
  }

  export class LanguageModelError extends Error {
    code?: string;
    cause?: unknown;
  }
}
