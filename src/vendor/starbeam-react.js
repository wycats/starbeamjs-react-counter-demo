import {
  A as verified,
  B as verify,
  E as expected,
  U as UNINITIALIZED$1,
  C as Cell,
  G as isPresent,
  v as Stack,
  H as isEqual,
  L as LIFETIME,
  z as reactive,
  M as Marker,
  J as isObject,
  R as REACTIVE,
  K as exhaustive$1,
  F as Formula,
  T as TIMELINE,
} from './index.shared.js';
export {
  C as Cell,
  i as CellDescription,
  o as DEBUG,
  p as DEBUG_NAME,
  D as DEBUG_RENDERER,
  j as Description,
  n as DisplayStruct,
  F as Formula,
  k as FormulaDescription,
  e as FormulaFn,
  d as FormulaList,
  q as INSPECT,
  I as ImplementationDescription,
  L as LIFETIME,
  s as LOGGER,
  b as Linkable,
  y as LocalName,
  t as LogLevel,
  M as Marker,
  l as MarkerDescription,
  Q as QualifiedName,
  R as REACTIVE,
  h as Reactive,
  a as Renderable,
  c as Resource,
  f as ResourceFn,
  g as ResourceList,
  v as Stack,
  w as StackFrame,
  S as StaticDescription,
  T as TIMELINE,
  m as TimestampValidatorDescription,
  x as Tree,
  W as Wrapper,
  u as describeModule,
  r as inspector,
  z as reactive,
} from './index.shared.js';
import { useRef, useState, useEffect, useLayoutEffect } from 'react';

const REFS$1 = /* @__PURE__ */ new WeakMap();
function ElementPlaceholder(type, description = Stack.describeCaller()) {
  const ref = /* @__PURE__ */ Object.create(null);
  REFS$1.set(ref, Cell(UNINITIALIZED$1));
  return {
    initialize(value) {
      const element = verified(REFS$1.get(ref), isPresent);
      verify(
        value,
        (value2) => value2 instanceof type,
        expected(`A ref (${description})`)
          .toBe(`initialized with an instance of ${type.name}`)
          .butGot(() => `an instance of ${value.constructor.name}`)
      );
      element.current = value;
      element.freeze();
    },
    get current() {
      const current = verified(REFS$1.get(ref), isPresent).current;
      return current === UNINITIALIZED$1 ? null : current;
    },
  };
}

const REFS = /* @__PURE__ */ new WeakMap();
function getPlaceholder(ref2) {
  return verified(
    REFS.get(ref2),
    isPresent,
    expected(`a Starbeam ref's element`)
      .toBe(`present`)
      .when(`accessed from the internals of a Starbeam hook`)
  );
}
const REF = Symbol('REF');
function ClassVerifier(Class) {
  function verify2(element) {
    return element instanceof Class;
  }
  return expected.associate(
    verify2,
    expected(`element provided by React`)
      .toBe(`an instance of ${Class.name}`)
      .when(`receiving an element from React's ref={} attribute`)
      .butGot((element) => element.constructor.name)
  );
}
function ref(kind) {
  const placeholder = ElementPlaceholder(kind);
  const verifier = ClassVerifier(kind);
  const refCallback = (element) => {
    if (element !== null) {
      const el = verified(element, verifier);
      if (placeholder.current === null) {
        placeholder.initialize(el);
      } else {
        verify(
          placeholder.current,
          isEqual(el),
          expected
            .as(`an existing ref`)
            .toBe(`initialized with the same element`)
        );
      }
    }
  };
  refCallback[REF] = true;
  REFS.set(refCallback, placeholder);
  return refCallback;
}

class Refs {
  static None() {
    return new Refs({ type: 'None' });
  }
  static FromPrevious(refs) {
    return new Refs({
      type: 'FromPrevious',
      value: refs,
    });
  }
  static FromConstructor(refs) {
    return new Refs({
      type: 'FromConstructor',
      value: refs,
    });
  }
  #enum;
  constructor(refs) {
    this.#enum = refs;
  }
  get record() {
    switch (this.#enum.type) {
      case 'None':
        return null;
      case 'FromPrevious':
      case 'FromConstructor':
        return this.#enum.value;
    }
  }
  fromPrev() {
    switch (this.#enum.type) {
      case 'None':
        return Refs.None();
      case 'FromPrevious':
        return this;
      case 'FromConstructor':
        return Refs.FromPrevious(this.#enum.value);
    }
  }
  update(refs) {
    switch (this.#enum.type) {
      case 'None': {
        const refsRecord = Object.fromEntries(
          Object.entries(refs).map(([name, type]) => [name, ref(type)])
        );
        return {
          refs: Refs.FromConstructor(refsRecord),
          record: refsRecord,
        };
      }
      case 'FromPrevious':
        return {
          refs: this,
          record: this.#enum.value,
        };
      case 'FromConstructor':
        throw Error(
          'You can only call element.refs once in a Starbeam setup block'
        );
    }
  }
  isFromConstructor() {
    return this.#enum.type === 'FromConstructor';
  }
}
class ReactiveElement {
  constructor(notify, lifecycle, renderable, refs) {
    this.notify = notify;
    this.#lifecycle = lifecycle;
    this.on = Lifecycle.on(lifecycle, this);
    this.#renderable = renderable;
    this.#refs = refs;
  }
  static create(notify) {
    return new ReactiveElement(
      notify,
      Lifecycle.create(),
      /* @__PURE__ */ new Set(),
      Refs.None()
    );
  }
  static reactivate(prev) {
    return new ReactiveElement(
      prev.notify,
      Lifecycle.create(),
      prev.#renderable,
      prev.#refs.fromPrev()
    );
  }
  static attach(element, renderable) {
    if (element.#debugLifecycle) {
      const lifecycle = element.#debugLifecycle;
      const listener = renderable.attach(() => {
        invalidate();
      });
      const invalidate = lifecycle(listener, renderable);
    }
  }
  static attached(element) {
    element.#lifecycle.attached();
  }
  static ready(elements) {
    elements.#lifecycle.ready();
  }
  #lifecycle;
  #renderable;
  #debugLifecycle = null;
  #refs;
  on;
  attach(lifecycle) {
    this.#debugLifecycle = lifecycle;
  }
  use(resource) {
    return resource.create({ owner: this });
  }
  refs(refs) {
    const { refs: newRefs, record } = this.#refs.update(refs);
    this.#refs = newRefs;
    return record;
  }
}
class Callbacks {
  static create() {
    return new Callbacks(/* @__PURE__ */ new Set());
  }
  #callbacks;
  constructor(callbacks) {
    this.#callbacks = callbacks;
  }
  add(callback) {
    this.#callbacks.add(callback);
  }
  invoke(instance) {
    for (const callback of this.#callbacks) {
      callback(instance);
    }
  }
}
class Lifecycle {
  static create() {
    return new Lifecycle(Callbacks.create(), Callbacks.create());
  }
  static on(lifecycle, instance) {
    return {
      cleanup: (finalizer) => LIFETIME.on.cleanup(instance, finalizer),
      ready: (ready) => lifecycle.#ready.add(ready),
      attached: (attached) => lifecycle.#attached.add(attached),
    };
  }
  #ready;
  #attached;
  constructor(ready, attached) {
    this.#ready = ready;
    this.#attached = attached;
  }
  ready() {
    this.#ready.invoke();
  }
  attached() {
    this.#attached.invoke();
  }
}
const SUBSCRIPTION = Symbol('SUBSCRIPTION');
const STABLE_PROPS = Symbol('STABLE_PROPS');

class ReactState {
  static rendering(instance) {
    return RenderingReactState.create(instance);
  }
  static attached(instance) {
    return AttachedReactState.create(instance);
  }
  static deactivated(prev) {
    return DeactivatedReactState.create(prev);
  }
  flush() {
    return this;
  }
}
class InstantiatedReactState extends ReactState {
  constructor(value) {
    super();
    this.value = value;
  }
  static is(state) {
    return state instanceof InstantiatedReactState;
  }
  ready(callbacks) {
    return ReadyReactState.create(this.value, callbacks);
  }
  updating() {
    return UpdatingReactState.create(this.value);
  }
}
class UpdatingReactState extends InstantiatedReactState {
  static is(state) {
    return state instanceof UpdatingReactState;
  }
  static create(instance) {
    return new UpdatingReactState(instance);
  }
  type = 'Updating';
  attached() {
    return AttachedReactState.create(this.value);
  }
}
class RenderingReactState extends InstantiatedReactState {
  static is(state) {
    return state instanceof UpdatingReactState;
  }
  static create(value) {
    return new RenderingReactState(value);
  }
  type = 'Rendering';
  rendered() {
    return RenderedReactState.create(this.value);
  }
}
class ReadyReactState extends InstantiatedReactState {
  static kind = 'Ready';
  static is(state) {
    return state instanceof ReadyReactState;
  }
  static create(instance, callbacks) {
    return new ReadyReactState(instance, callbacks ?? null);
  }
  type = 'Ready';
  #callbacks;
  constructor(value, callbacks) {
    super(value);
    this.#callbacks = callbacks;
  }
  flush() {
    const buffered = this.#callbacks;
    this.#callbacks = null;
    if (buffered) {
      const { delegate, callbacks } = buffered;
      for (const callback of callbacks) {
        delegate[callback]?.(this.value);
      }
    }
    return this;
  }
  attached() {
    return AttachedReactState.create(this.value);
  }
}
class RenderedReactState extends InstantiatedReactState {
  kind = 'Rendered';
  static is(state) {
    return state instanceof RenderedReactState;
  }
  static create(instance) {
    return new RenderedReactState(instance);
  }
  type = 'Rendered';
  attached() {
    return AttachedReactState.create(this.value);
  }
}
class AttachedReactState extends InstantiatedReactState {
  kind = 'Attached';
  static is(state) {
    return state instanceof AttachedReactState;
  }
  static create(instance) {
    return new AttachedReactState(instance);
  }
  type = 'Attached';
}
class DeactivatedReactState extends ReactState {
  kind = 'Deactivated';
  static is(state) {
    return state instanceof DeactivatedReactState;
  }
  static create(prev) {
    return new DeactivatedReactState(prev);
  }
  type = 'Deactivated';
  #prev;
  constructor(prev) {
    super();
    this.#prev = prev;
  }
  readyToReactivate() {
    return ReadyToReactivateReactState.create(this.#prev);
  }
}
class ReadyToReactivateReactState extends ReactState {
  kind = 'ReadyToReactivate';
  static is(state) {
    return state instanceof ReadyToReactivateReactState;
  }
  static create(prev) {
    return new ReadyToReactivateReactState(prev);
  }
  type = 'ReadyToReactivate';
  #prev;
  constructor(prev) {
    super();
    this.#prev = prev;
  }
  get prev() {
    return this.#prev;
  }
  reactivating(instance) {
    return ReactivatingReactState.create(instance);
  }
}
class ReactivatingReactState extends InstantiatedReactState {
  kind = 'Reactivating';
  static is(state) {
    return state instanceof ReactivatingReactState;
  }
  static create(value) {
    return new ReactivatingReactState(value);
  }
  type = 'Reactivating';
  attached() {
    return AttachedReactState.create(this.value);
  }
}

const BUG = `This is not expected by @starbeam/resource, and is either a bug or a change in React behavior. Please file a bug.`;
function isState(Type, { situation }) {
  if (Array.isArray(Type)) {
    if (Type.length === 1) {
      const type = Type[0];
      return {
        test: type.is,
        failure: (value) =>
          `${situation}, a component's state should be ${type.kind}. Instead, we got ${value.type}. ${BUG}`,
      };
    } else {
      let isOneOf = function (value) {
        return types.some((type) => type.is(value));
      };
      const types = Type;
      return {
        test: isOneOf,
        failure: (value) =>
          `${situation}, a component's state should be one of: ${types.join(
            ', '
          )}. Instead, we got ${value.type}. ${BUG}`,
      };
    }
  } else {
    return isState([Type], { situation });
  }
}
const isReadyState = (options) => isState([ReadyReactState], options);
function isAttachedState({ situation }) {
  return {
    test: (value) =>
      InstantiatedReactState.is(value) && value.type === 'Attached',
    failure: (value) =>
      `${situation}, a component's state should be Attached. Instead, we got ${value.type}. ${BUG}`,
  };
}
function isPreparedForActivationState({ situation }) {
  return {
    test: (value) =>
      RenderedReactState.is(value) || DeactivatedReactState.is(value),
    failure: (value) =>
      `${situation}, a component's state should be Rendered or Deactivated. Instead, we got ${value.type} (${value.constructor.name}). ${BUG}`,
  };
}

function check(value, ...validator) {
  checkValue(value, checker(validator));
}
function checked(value, ...validator) {
  checkValue(value, checker(validator));
  return value;
}
function checker(checker2) {
  if (checker2.length === 1) {
    return checker2[0];
  } else {
    const [test, failure] = checker2;
    return { test, failure };
  }
}
function checkValue(value, { test, failure }) {
  if (!test(value)) {
    const error = typeof failure === 'string' ? failure : failure(value);
    throw Error(error);
  }
}
function assert(condition, message) {
  if (!condition) {
    throw Error(message);
  }
}
function exhaustive(value, variable) {
  throw Error(`Exhaustive check failed for ${variable}`);
}
const UNINITIALIZED = Symbol.for('starbeam.UNINITIALIZED');

const FRAME_START = '    at ';
function callerFrame({ extraFrames = 0 } = {}) {
  try {
    throw Error('callerFrame');
  } catch (e) {
    assert(
      e instanceof Error && e.stack,
      `An Error instance thrown in the internals of callerFrame wasn't an Error instance when caught.`
    );
    const { stack } = parseStack(e.stack);
    return stack[1 + extraFrames].trimStart();
  }
}
function parseStack(stack) {
  let lines = stack.split('\n');
  let headerDone = false;
  let headerLines = [];
  let stackLines = [];
  for (let line of lines) {
    if (headerDone) {
      stackLines.push(line);
    } else {
      if (line.startsWith(FRAME_START)) {
        headerDone = true;
        stackLines.push(line);
      } else {
        headerLines.push(line);
      }
    }
  }
  return { header: headerLines, stack: stackLines };
}

function useUpdatingVariable(options) {
  return useUpdatingRef(options).current;
}
function useUpdatingRef({ initial, update }) {
  const ref = useRef(UNINITIALIZED);
  if (ref.current === UNINITIALIZED) {
    ref.current = initial();
  } else {
    const next = update(ref.current);
    if (next !== void 0) {
      ref.current = next;
    }
  }
  return ref;
}
useUpdatingRef.mutable = ({ initial, update }) => {
  const ref = useRef(UNINITIALIZED);
  let value;
  if (ref.current === UNINITIALIZED) {
    value = ref.current = initial();
  } else {
    const next = update(ref.current);
    if (next !== void 0) {
      ref.current = next;
    }
    value = ref.current;
  }
  return { ref, value };
};
function useLastRenderRef(state) {
  return useUpdatingRef({
    initial: () => state,
    update: () => state,
  });
}

class Resource {
  static create(delegate, args, options) {
    if (typeof delegate === 'function') {
      return new Resource({ create: delegate }, options ?? {}, args);
    } else {
      return new Resource(delegate, options ?? {}, args);
    }
  }
  #delegate;
  #options;
  #args;
  constructor(delegate, options, args) {
    this.#delegate = delegate;
    this.#options = options;
    this.#args = args;
  }
  options(options) {
    return new Resource(
      this.#delegate,
      { ...this.#options, ...options },
      this.#args
    );
  }
  as(description) {
    return this.options({ description });
  }
  notifier(notify) {
    return this.options({ notify });
  }
  update(updater) {
    return new Resource(
      { ...this.#delegate, update: updater },
      this.#options,
      this.#args
    );
  }
  reactivate(reactivate) {
    return new Resource(
      { ...this.#delegate, reactivate },
      this.#options,
      this.#args
    );
  }
  on(delegate) {
    this.#delegate = { ...this.#delegate, ...delegate };
    return createResource(
      { ...this.#delegate, ...delegate },
      this.#args,
      this.#options
    );
  }
}
function createResource(delegate, args, options) {
  const description = options?.description ?? callerFrame({ extraFrames: 1 });
  const perRenderState = useLastRenderRef(args);
  let notify;
  if (options?.notify) {
    notify = options.notify;
  } else {
    const [, setNotify] = useState({});
    notify = () => setNotify({});
  }
  const config = { description, notify };
  const { ref: state, value: current } = useUpdatingRef.mutable({
    initial: () => {
      const instance = delegate.create(perRenderState.current, config);
      return ReactState.rendering(instance);
    },
    update: (lifecycle) => {
      if (ReadyToReactivateReactState.is(lifecycle)) {
        if (delegate.reactivate && lifecycle.prev) {
          return lifecycle.reactivating(
            delegate.reactivate(perRenderState.current, lifecycle.prev, config)
          );
        } else {
          return lifecycle.reactivating(
            delegate.create(perRenderState.current, config)
          );
        }
      } else {
        check(
          lifecycle,
          isReadyState({
            situation: 'rerendering a component',
          })
        );
        return lifecycle.updating();
      }
    },
  });
  const rendered = (state.current = renderLifecycle(
    current,
    delegate,
    perRenderState.current
  ));
  useLayoutLifecycle(state, delegate, notify);
  useReadyLifecycle(state, delegate);
  state.current.flush();
  const result = useLastRenderRef(rendered.value);
  return result;
}
function useResource() {
  return useResource.with(void 0);
}
useResource.create = (create) => {
  return useResource.with(void 0).create(create);
};
useResource.with = (state) => {
  return {
    create: (create, options) => Resource.create(create, state, options),
  };
};
function useReadyLifecycle(state, delegate) {
  useEffect(() => {
    if (ReadyToReactivateReactState.is(state.current)) {
      return;
    }
    const current = checked(
      state.current,
      isAttachedState({ situation: 'Inside of useEffect' })
    );
    state.current = current.ready({ delegate, callbacks: ['ready'] }).flush();
  }, []);
}
function useLayoutLifecycle(state, delegate, notify) {
  useLayoutEffect(() => {
    const current = checked(
      state.current,
      isPreparedForActivationState({
        situation: 'Inside of useLayoutEffect',
      })
    );
    if (DeactivatedReactState.is(current)) {
      notify();
      state.current = current.readyToReactivate();
    } else {
      delegate.attached?.(current.value);
      state.current = current.attached();
    }
    return cleanup(state, delegate);
  }, []);
}
function cleanup(state, delegate) {
  return () => {
    const current = state.current;
    if (InstantiatedReactState.is(current)) {
      delegate.deactivate?.(current.value);
      state.current = delegate.reactivate
        ? ReactState.deactivated(current.value)
        : ReactState.deactivated(null);
    } else {
      console.warn(`TODO: Unexpectedly deactivating in state`, current);
      state.current = ReactState.deactivated(null);
    }
  };
}
function renderLifecycle(state, delegate, props) {
  switch (state.type) {
    case 'Rendering':
      return state.rendered();
    case 'Updating':
      delegate.update?.(state.value, props);
      return state.ready();
    case 'Reactivating':
      return state.ready({ delegate, callbacks: ['attached', 'ready'] });
    default:
      exhaustive(state, `state.type`);
  }
}

function useStable(variable, description) {
  const desc = Stack.description(description);
  return useUpdatingVariable({
    initial: () => reactive.object(variable, desc),
    update: (stableProps) => {
      Object.assign(stableProps, variable);
    },
  });
}
function useStableVariable(variable, description = Stack.describeCaller()) {
  return useUpdatingVariable({
    initial: () => Cell(variable, description),
    update: (cell) => {
      cell.set(variable);
    },
  });
}
function useProp(variable, description) {
  return useUpdatingVariable({
    initial: () => {
      return Cell(variable, Stack.description(description, 3));
    },
    update: (cell) => {
      cell.set(variable);
    },
  });
}
function useProps(props, description) {
  const desc = Stack.description(description);
  return useUpdatingVariable({
    initial: () => reactive.object(props, desc),
    update: (stableProps) => {
      Object.assign(stableProps, props);
    },
  });
}
useStableVariable.mutable = (value, setValue, description) => {
  const desc = Stack.description(description);
  return useUpdatingVariable({
    initial: () => ReactiveState.create(value, setValue, desc),
    update: (state) => ReactiveState.update(state, value),
  });
};
class ReactiveState {
  static create(value, setValue, description) {
    return new ReactiveState(value, setValue, Marker(description));
  }
  static update(state, value) {
    if (value !== state.#value) {
      state.#value = value;
      state.#marker.update();
    }
  }
  #value;
  #setValue;
  #marker;
  constructor(value, setValue, marker) {
    this.#value = value;
    this.#setValue = setValue;
    this.#marker = marker;
  }
  get current() {
    this.#marker.consume();
    return this.#value;
  }
  set current(value) {
    this.#value = value;
    this.#setValue(value);
    this.#marker.update();
  }
  update(updater) {
    this.current = updater(this.#value);
  }
}

class StableProps {
  static from(props) {
    let internal = Object.fromEntries(
      Object.entries(props).map(([key, value]) => initialPropEntry(key, value))
    );
    const proxy = reactive.object(props);
    return new StableProps(internal, proxy);
  }
  #reactive;
  #proxy;
  constructor(reactive, proxy) {
    this.#reactive = reactive;
    this.#proxy = proxy;
  }
  #sync(newReactProps) {
    const stableProps = this.#reactive;
    const proxy = this.#proxy;
    let changes = false;
    for (let [key, newValue] of Object.entries(newReactProps)) {
      changes = changes || updateProp(stableProps, proxy, key, newValue);
    }
    for (let key of Object.keys(stableProps)) {
      if (!(key in newReactProps)) {
        delete stableProps[key];
        delete proxy[key];
        changes = true;
      }
    }
    return changes;
  }
  update(newReactProps) {
    return this.#sync(newReactProps);
  }
  get reactive() {
    return this.#reactive;
  }
  get proxy() {
    return this.#proxy;
  }
}
function isPassthruProp(key) {
  verify(key, (value) => {
    return typeof value === 'string' || typeof value === 'symbol';
  });
  if (typeof key === 'symbol') {
    return true;
  } else if (typeof key === 'string') {
    return key.startsWith('$') || key === 'children';
  } else {
    exhaustive$1();
  }
}
function initialPropEntry(key, value) {
  if (isPassthruProp(key)) {
    return [key, value];
  } else if (isObject(value) && REACTIVE in value) {
    return [key, value];
  } else {
    return [key, Cell(value)];
  }
}
function updateProp(props, proxy, key, newValue) {
  let changes = false;
  if (proxy[key] !== newValue) {
    proxy[key] = newValue;
  }
  if (isPassthruProp(key)) {
    if (props[key] !== newValue) {
      props[key] = newValue;
      changes = true;
    }
  } else if (key in props) {
    const existing = props[key];
    if (isObject(newValue) && REACTIVE in newValue) {
      verify(
        existing,
        isEqual(newValue),
        expected('a reactive value passed to a Starbeam component').toBe(
          'the same value every time'
        )
      );
      return false;
    }
    verify(
      existing,
      Cell.is,
      expected
        .as(`an existing reactive prop`)
        .when(`a prop isn't 'children', prefixed with '$' or a symbol`)
    );
    const existingValue = existing.current;
    if (existingValue !== newValue) {
      existing.current = newValue;
      changes = true;
    }
  } else {
    props[key] = Cell(newValue);
    changes = true;
  }
  return changes;
}

function useReactiveElement(...args) {
  const [, setNotify] = useState({});
  const { props, definition, description } = useReactiveElementArgs(args);
  const stableProps = props
    ? useUpdatingRef({
        initial: () => StableProps.from(props),
        update: (stableProps2) => {
          stableProps2.update(props);
          return stableProps2;
        },
      })
    : void 0;
  const { current: resource } = useResource
    .create((_args, { notify }) => {
      return createReactiveElement({ prev: null, notify });
    })
    .reactivate((_args, { element: prev }, { notify }) => {
      return createReactiveElement({ prev, notify });
    })
    .update(() => {})
    .as(description)
    .notifier(() => setNotify({}))
    .on({
      attached: ({ element }) => {
        ReactiveElement.attached(element);
      },
      ready: ({ element }) => {
        ReactiveElement.ready(element);
      },
      deactivate: ({ element }) => {
        LIFETIME.finalize(element);
      },
    });
  const memo = resource.value;
  return memo.poll();
  function createReactiveElement({ prev, notify }) {
    let element;
    if (prev) {
      element = ReactiveElement.reactivate(prev);
    } else {
      element = ReactiveElement.create(notify);
    }
    let formula;
    if (stableProps) {
      formula = Formula(definition(stableProps.current.reactive, element));
    } else {
      formula = Formula(definition(element));
    }
    const renderable = TIMELINE.on.change(
      formula,
      () => {
        TIMELINE.enqueue(notify);
      },
      description
    );
    LIFETIME.on.cleanup(renderable, () => {
      console.log('tearing down renderable', description);
    });
    LIFETIME.link(element, renderable);
    ReactiveElement.attach(element, renderable);
    return { element, value: renderable };
  }
}
function isCompleteArgs(args) {
  return args.length === 3;
}
function useReactiveElementArgs(args) {
  if (isCompleteArgs(args)) {
    const [props, definition, description2] = args;
    return { props, definition, description: description2 };
  }
  if (args.length === 2 && typeof args[1] === 'string') {
    return {
      props: void 0,
      definition: args[0],
      description: args[1],
    };
  }
  const description = Stack.describeCaller(1);
  if (args.length === 2) {
    return {
      props: args[0],
      definition: args[1],
      description,
    };
  } else {
    const description2 = Stack.describeCaller(1);
    return {
      props: void 0,
      definition: args[0],
      description: description2,
    };
  }
}

function useStarbeam(definition, description) {
  const [, setNotify] = useState({});
  const desc = Stack.description(description);
  const { current: resource } = useResource
    .create((_args, { notify }) => {
      return createReactiveElement({ prev: null, notify });
    })
    .reactivate((_args, { element: prev }, { notify }) => {
      return createReactiveElement({ prev, notify });
    })
    .update(() => {})
    .as('useStarbeam')
    .notifier(() => setNotify({}))
    .on({
      attached: ({ element }) => {
        ReactiveElement.attached(element);
      },
      ready: ({ element }) => {
        ReactiveElement.ready(element);
      },
      deactivate: ({ element }) => {
        LIFETIME.finalize(element);
      },
    });
  const renderable = resource.value;
  const polled = renderable.poll();
  return polled;
  function createReactiveElement({ prev, notify }) {
    let element;
    if (prev) {
      element = ReactiveElement.reactivate(prev);
    } else {
      element = ReactiveElement.create(notify);
    }
    const formula = Formula(definition(element), desc);
    const renderable2 = TIMELINE.on.change(
      formula,
      () => {
        TIMELINE.enqueue(notify);
      },
      desc
    );
    LIFETIME.on.cleanup(renderable2, () => {
      console.log('tearing down renderable', description);
    });
    LIFETIME.link(element, renderable2);
    ReactiveElement.attach(element, renderable2);
    return { element, value: renderable2 };
  }
}

export {
  ReactiveElement,
  STABLE_PROPS,
  SUBSCRIPTION,
  getPlaceholder,
  ref,
  useProp,
  useProps,
  useReactiveElement,
  useStable,
  useStableVariable,
  useStarbeam,
};
