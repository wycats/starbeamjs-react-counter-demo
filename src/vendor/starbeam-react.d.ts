export function useStarbeam<T>(
  definition: ReactiveDefinition<T, void>,
  description?: string | DescriptionArgs
): T;

type ReactiveDefinition<T> =
  | ((parent: ReactiveElement) => () => T)
  | (() => () => T);

export declare class ReactiveElement {
  readonly on: OnLifecycle;

  attach(lifecycle: DebugLifecycle): void;
  use<T>(resource: Linkable<Resource<T>>): Resource<T>;
  refs<R extends RefsTypes>(refs: R): RefsRecordFor<R>;
}

interface OnLifecycle extends OnCleanup {
  readonly cleanup: (finalizer: Callback) => Unsubscribe;
  readonly ready: (ready: Callback) => void;
  readonly attached: (attached: Callback) => void;
}

export interface OnCleanup {
  cleanup(finalizer: () => void): Unsubscribe;
}

export type Unsubscribe = () => void;
type Callback<T = void> = (instance: T) => void;

export declare class Linkable<T> {
  create({ owner }: { owner: object }): T;
  map<U>(mapper: (value: T) => U): Linkable<U>;
}

export declare class ReactiveResource<T> implements Reactive<T> {
  #reactive: 'nominal';
}

declare const REACTIVE: unique symbol;
type REACTIVE = typeof REACTIVE;

export interface ReactiveProtocol {
  readonly [REACTIVE]: unknown;
}

export interface Reactive<T> extends ReactiveProtocol {
  readonly current: T;
}

export const reactive: {
  Map<K, V>(description?: string): Map<K, V>;
  array<T>(items: T[], description?: string): T[];
};

export function Cell<T>(value: T, description?: string): Cell<T>;

export interface Cell<T> extends Reactive<T> {
  current: T;
  set(value: T): void;
  update(updater: (previous: T) => T): void;
}
