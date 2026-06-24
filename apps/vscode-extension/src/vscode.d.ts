declare module "vscode" {
  export interface Disposable {
    dispose(): void;
  }

  export interface Event<T> {
    (listener: (event: T) => unknown): Disposable;
  }

  export class EventEmitter<T> implements Disposable {
    public readonly event: Event<T>;
    public fire(data: T): void;
    public dispose(): void;
  }

  export interface Command {
    command: string;
    title: string;
    arguments?: unknown[];
  }

  export interface TreeDataProvider<T> {
    getTreeItem(element: T): TreeItem | Thenable<TreeItem>;
    getChildren(element?: T): ProviderResult<T[]>;
  }

  export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;

  export class ThemeIcon {
    public constructor(id: string);
  }

  export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2
  }

  export class TreeItem {
    public label?: string;
    public description?: string;
    public tooltip?: string;
    public iconPath?: ThemeIcon;
    public contextValue?: string;
    public command?: Command;
    public constructor(label: string, collapsibleState?: TreeItemCollapsibleState);
  }

  export interface Uri {
    readonly fsPath: string;
  }

  export interface TextDocument {
    readonly uri: Uri;
  }

  export interface TextEditor {
    readonly document: TextDocument;
  }

  export interface WorkspaceFolder {
    readonly uri: Uri;
  }

  export interface CancellationToken {
    readonly isCancellationRequested: boolean;
    onCancellationRequested(listener: () => unknown): Disposable;
  }

  export interface Progress<T> {
    report(value: T): void;
  }

  export enum ProgressLocation {
    Notification = 15
  }

  export enum ViewColumn {
    One = 1,
    Beside = -2
  }

  export interface ExtensionContext {
    readonly subscriptions: Disposable[];
  }

  export namespace window {
    const activeTextEditor: TextEditor | undefined;
    function registerTreeDataProvider<T>(viewId: string, provider: TreeDataProvider<T>): Disposable;
    function showWarningMessage(
      message: string,
      optionsOrItem?: { modal?: boolean; detail?: string } | string,
      ...items: string[]
    ): Thenable<string | undefined>;
    function showInformationMessage(
      message: string,
      optionsOrItem?: { modal?: boolean; detail?: string } | string,
      ...items: string[]
    ): Thenable<string | undefined>;
    function showInputBox(options?: {
      readonly title?: string;
      readonly prompt?: string;
      readonly ignoreFocusOut?: boolean;
    }): Thenable<string | undefined>;
    function showTextDocument(
      document: TextDocument,
      options?: { readonly preview?: boolean; readonly viewColumn?: ViewColumn }
    ): Thenable<unknown>;
    function withProgress<R>(
      options: { readonly location: ProgressLocation; readonly title: string; readonly cancellable?: boolean },
      task: (progress: Progress<{ readonly message?: string }>, token: CancellationToken) => Thenable<R>
    ): Thenable<R>;
    function createWebviewPanel(
      viewType: string,
      title: string,
      showOptions: ViewColumn,
      options?: { readonly enableScripts?: boolean }
    ): { webview: { html: string } };
  }

  export namespace workspace {
    const isTrusted: boolean;
    const workspaceFolders: readonly WorkspaceFolder[] | undefined;
    function openTextDocument(options: { readonly language?: string; readonly content: string }): Thenable<TextDocument>;
  }

  export namespace commands {
    function registerCommand(command: string, callback: (...args: any[]) => unknown): Disposable;
    function executeCommand<T = unknown>(command: string, ...rest: unknown[]): Thenable<T>;
  }
}
