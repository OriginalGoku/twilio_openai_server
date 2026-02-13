declare module "@openai/agents" {
  export function tool(config: {
    name: string;
    description: string;
    parameters: unknown;
    execute: (input: any) => Promise<any> | any;
  }): any;
}

declare module "@openai/agents/realtime" {
  export class RealtimeAgent {
    constructor(config: any);
  }

  export class RealtimeSession {
    constructor(agent: RealtimeAgent, options?: any);
    connect(options?: any): Promise<void>;
    close(): Promise<void>;
    on(event: string, listener: (event: any) => void): void;
    sendMessage(message: any, otherEventData?: Record<string, any>): void;
  }
}

declare module "@openai/agents-extensions" {
  export class TwilioRealtimeTransportLayer {
    constructor(options: any);
  }
}
