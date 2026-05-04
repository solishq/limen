/**
 * Type declaration for @langchain/langgraph-checkpoint peer dependency.
 * Provides BaseCheckpointSaver and BaseStore base class types.
 */
declare module '@langchain/langgraph-checkpoint' {
  export abstract class BaseCheckpointSaver {
    constructor();
  }

  export abstract class BaseStore {
    constructor();
    abstract batch(operations: unknown[]): Promise<unknown[]>;
    get(namespace: string[], key: string): Promise<unknown | null>;
    search(namespacePrefix: string[], options?: Record<string, unknown>): Promise<unknown[]>;
    put(namespace: string[], key: string, value: Record<string, unknown>, index?: false | string[]): Promise<void>;
    delete(namespace: string[], key: string): Promise<void>;
    listNamespaces(options?: Record<string, unknown>): Promise<string[][]>;
    start(): void | Promise<void>;
    stop(): void | Promise<void>;
  }
}
