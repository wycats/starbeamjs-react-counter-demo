class ObjectLifetime {
  static create() {
    return new ObjectLifetime();
  }
  static finalize(lifetime, finalizing) {
    lifetime.#finalizeIn(finalizing);
  }
  #finalizers = /* @__PURE__ */ new Set();
  #children = /* @__PURE__ */ new Set();
  #finalized = false;
  on = {
    finalize: (finalizer) => {
      this.#finalizers.add(finalizer);
      return () => this.#finalizers.delete(finalizer);
    },
  };
  link(child) {
    this.#children.add(child);
    return () => this.#children.delete(child);
  }
  #finalizeIn(finalizing) {
    if (this.#finalized) {
      return;
    }
    this.#finalized = true;
    if (finalizing) {
      finalizing(() => {
        this.#finalize();
      });
    } else {
      this.#finalize();
    }
  }
  #finalize() {
    for (const finalizer of this.#finalizers) {
      finalizer();
    }
    for (const child of this.#children) {
      child.#finalize();
    }
  }
}

class LifetimeAPI {
  #associations = /* @__PURE__ */ new WeakMap();
  on = {
    cleanup: (object, handler) => {
      let lifetime = this.#associations.get(object);
      if (!lifetime) {
        lifetime = ObjectLifetime.create();
        this.#associations.set(object, lifetime);
      }
      return lifetime.on.finalize(handler);
    },
  };
  link(parent, child) {
    let parentLifetime = this.#initialize(parent);
    let childLifetime = this.#initialize(child);
    return parentLifetime.link(childLifetime);
  }
  #initialize(object) {
    let lifetime = this.#associations.get(object);
    if (!lifetime) {
      lifetime = ObjectLifetime.create();
      this.#associations.set(object, lifetime);
    }
    return lifetime;
  }
  finalize(object, finalizing) {
    const lifetime = this.#associations.get(object);
    if (lifetime) {
      ObjectLifetime.finalize(lifetime, finalizing);
    }
  }
}
const LIFETIME = new LifetimeAPI();

class VerificationError extends Error {
  constructor(message, expectation) {
    super(message);
    this.expectation = expectation;
  }
}
function verify(value, check, error) {
  if (!check(value)) {
    const associated = ASSOCIATED.get(check);
    const expectation = Expectation.merge(associated, error);
    if (expectation === void 0) {
      const name = check.name;
      throw new VerificationError(
        `Assumption was incorrect: ${name}`,
        expected()
      );
    } else {
      throw new VerificationError(expectation.message(value), expectation);
    }
  }
}
function verified(value, check, error) {
  verify(value, check, error);
  return value;
}
class Expectation {
  static create(description) {
    return new Expectation(description, void 0, void 0, void 0);
  }
  static merge(associated, specified) {
    if (!associated && !specified) {
      return void 0;
    }
    if (!associated) {
      return specified;
    }
    if (!specified) {
      return associated;
    }
    return new Expectation(
      specified.#description,
      specified.#to ?? associated.#to,
      specified.#actual ?? associated.#actual,
      specified.#when ?? associated.#when
    );
  }
  #description;
  #to;
  #actual;
  #when;
  constructor(description, to, got, when) {
    this.#description = description;
    this.#to = to;
    this.#actual = got;
    this.#when = when;
  }
  as(description) {
    return new Expectation(description, this.#to, this.#actual, this.#when);
  }
  update(updater) {
    const description = updater.description
      ? updater.description(this.#description)
      : this.#description;
    const updatedTo = updater.to ? updater.to(this.#to) : this.#to;
    const to =
      typeof updatedTo === 'string'
        ? [this.#to?.[0] ?? 'to be', updatedTo]
        : updatedTo;
    const actual = updater.actual ? updater.actual(this.#actual) : this.#actual;
    return new Expectation(
      description,
      to,
      actual,
      updater.when ? updater.when(this.#when) : this.#when
    );
  }
  toBe(kind) {
    return new Expectation(
      this.#description,
      ['to be', kind],
      this.#actual,
      this.#when
    );
  }
  toHave(items) {
    return new Expectation(
      this.#description,
      ['to have', items],
      this.#actual,
      this.#when
    );
  }
  butGot(kind) {
    return new Expectation(
      this.#description,
      this.#to,
      typeof kind === 'string' ? () => kind : kind,
      this.#when
    );
  }
  when(situation) {
    return new Expectation(
      this.#description,
      this.#to,
      this.#actual,
      situation
    );
  }
  message(input) {
    let message = ``;
    if (this.#when) {
      message += `When ${this.#when}: `;
    }
    message += `Expected ${this.#description ?? 'value'}`;
    if (this.#to) {
      message += ` ${this.#to[0]} ${this.#to[1]}`;
    }
    if (this.#actual) {
      message += `, but got ${String(this.#actual(input))}`;
    }
    return message;
  }
}
function expected(description) {
  return Expectation.create(description);
}
expected.as = expected;
expected.toBe = (kind) => expected().toBe(kind);
expected.toHave = (items) => expected().toHave(items);
expected.when = (situation) => expected().when(situation);
expected.butGot = (kind) => expected().butGot(kind);
const ASSOCIATED = /* @__PURE__ */ new WeakMap();
expected.associate = (check, expected2) => {
  ASSOCIATED.set(check, expected2);
  return check;
};
expected.updated = (check, updater) => {
  const expectation = ASSOCIATED.get(check) ?? expected();
  return expectation.update(updater);
};

function format(value) {
  if (value === null) {
    return `null`;
  }
  switch (typeof value) {
    case 'boolean':
    case 'number':
    case 'undefined':
    case 'symbol':
      return String(value);
    case 'bigint':
      return `${value}n`;
    case 'string':
      return JSON.stringify(value);
    case 'function': {
      const fn = String(value);
      if (fn.startsWith('class')) {
        return `{class ${value.name}}`;
      } else if (fn.match(/^function\s*[*]/)) {
        return `{function* ${value.name}}`;
      } else if (fn.match(/^async\s+function/)) {
        return `{async function ${value.name}}`;
      } else if (value.name) {
        return `{${value.name}`;
      } else {
        return `{anonymous function}`;
      }
    }
    case 'object': {
      const proto = Object.getPrototypeOf(value);
      if (proto === null || proto === Object.prototype) {
        const entries = Object.entries(value)
          .map(([key, value2]) => `${key}: ${format(value2)}`)
          .join(', ');
        return `{ ${entries} }`;
      } else if (value.constructor.name) {
        return `{${value.constructor.name} instance}`;
      } else {
        return `{anonymous instance}`;
      }
    }
  }
}

function isPresent(value) {
  return value !== null && value !== void 0;
}
expected.associate(isPresent, expected.toBe('present'));
function exhaustive(_value, type) {
  if (type) {
    throw Error(`unexpected types left in ${type}`);
  } else {
    throw Error(`unexpected types left`);
  }
}
function isEqual(value) {
  function verify(input) {
    return Object.is(input, value);
  }
  return expected.associate(
    verify,
    expected.toBe(String(value)).butGot(format)
  );
}
function isNotEqual(value) {
  function verify(input) {
    return !Object.is(input, value);
  }
  return expected.associate(
    verify,
    expected.toBe(`not ${String(value)}`).butGot(format)
  );
}
function isObject$1(value) {
  return typeof value === 'object' && value !== null;
}
expected.associate(
  isObject$1,
  expected
    .toBe('an object')
    .butGot((value) => (value === null ? 'null' : typeof value))
);
function hasItems(value) {
  return value.length > 0;
}
expected.associate(hasItems, expected.toHave(`at least one item`));

function define(object, property, value) {
  Object.defineProperty(object, property, {
    writable: true,
    enumerable: true,
    configurable: true,
    value,
  });
  return object;
}
define.builtin = (object, property, value) => {
  Object.defineProperty(object, property, {
    writable: false,
    enumerable: false,
    configurable: true,
    value,
  });
  return object;
};

function hasType(type) {
  return IS_TYPEOF[type];
}
const IS_TYPEOF = {
  object: isObject$1,
  null: isEqual(null),
  undefined: isTypeof('undefined'),
  function: isTypeof('function'),
  string: isTypeof('string'),
  number: isTypeof('number'),
  boolean: isTypeof('boolean'),
  symbol: isTypeof('symbol'),
  bigint: isTypeof('bigint'),
};
function isTypeof(type) {
  if (type === 'object') {
    return isObject$1;
  }
  const verify = define.builtin(
    function verify2(value) {
      return typeof value === type;
    },
    'name',
    `is${type}`
  );
  define.builtin(verify, Symbol.toStringTag, `Verifier`);
  return expected.associate(verify, expected.toBe(type).butGot(typeName));
}
function typeName(value) {
  return value === null ? 'null' : typeof value;
}

const REACTIVE = Symbol('REACTIVE');

class AbstractDebugOperation {
  #at;
  constructor(at) {
    this.#at = at;
  }
}
class InternalsOperation extends AbstractDebugOperation {
  for;
  constructor(at, internals) {
    super(at);
    this.for = internals;
  }
}
class ConsumeCell extends InternalsOperation {
  type = 'cell:consume';
}
class ConsumeFrame extends InternalsOperation {
  type = 'frame:consume';
}
class UpdateCell extends InternalsOperation {
  type = 'cell:update';
}
class Mutation extends AbstractDebugOperation {
  type = 'mutation';
  #description;
  #children = /* @__PURE__ */ new Set();
  #parent;
  for = void 0;
  constructor(at, description, parent) {
    super(at);
    this.#description = description;
    this.#parent = parent;
  }
  add(child) {
    this.#children.add(child);
  }
}
function filterToPredicate(filter) {
  switch (filter.type) {
    case 'by-reactive': {
      const dependencies = filter.reactive[REACTIVE].children().dependencies;
      return (operation) => {
        if (operation.for === void 0) {
          return false;
        } else {
          if (operation.for === filter.reactive) {
            return true;
          }
          if (operation.for.type === 'mutable') {
            return dependencies.has(operation.for);
          }
          return false;
        }
      };
    }
    case 'all':
      return;
    case 'none':
      return () => false;
    default:
      exhaustive();
  }
}
class DebugTimeline {
  static create(updatedAt) {
    return new DebugTimeline(updatedAt);
  }
  static Flush = class Flush {
    constructor(history) {
      this.history = history;
    }
    for(reactive) {
      const internals = reactive[REACTIVE];
      return this.history.filter((item) => item.for === internals);
    }
  };
  static DebugListener = class DebugListener {
    static offset(listener) {
      return listener.#offset;
    }
    static notify(listener) {
      listener.#notify();
    }
    #timeline;
    #offset = 0;
    #filter;
    #notify;
    constructor(timeline, notify, filter) {
      this.#timeline = timeline;
      this.#notify = notify;
      this.#filter = filter;
      LIFETIME.on.cleanup(this, () => this.detach());
    }
    update(filter) {
      this.#filter = filter;
    }
    flush() {
      const flush = this.#timeline.#flush(
        this.#offset,
        filterToPredicate(this.#filter)
      );
      this.#offset = this.#timeline.#end;
      this.#timeline.#prune();
      return flush.history;
    }
    detach() {
      this.#timeline.#listeners.delete(this);
    }
  };
  #lastUpdate;
  #trimOffset = 0;
  #operationList = [];
  #currentMutation = null;
  #listeners = /* @__PURE__ */ new Set();
  constructor(lastUpdate) {
    this.#lastUpdate = lastUpdate;
  }
  notify() {
    this.#listeners.forEach(DebugTimeline.DebugListener.notify);
  }
  get #end() {
    return this.#trimOffset + this.#operationList.length;
  }
  attach(notify, options) {
    const listener = new DebugTimeline.DebugListener(
      this,
      notify,
      options.filter
    );
    this.#listeners.add(listener);
    return listener;
  }
  #flush(offset, filter) {
    let list = this.#operationList.slice(offset - this.#trimOffset);
    if (filter) {
      list = list.filter(filter);
    }
    return new DebugTimeline.Flush(list);
  }
  #prune() {
    const minOffset = Math.min(
      ...[...this.#listeners].map(DebugTimeline.DebugListener.offset)
    );
    const trim = minOffset - this.#trimOffset;
    this.#operationList = this.#operationList.slice(trim);
    this.#trimOffset = minOffset;
  }
  #add(operation) {
    if (this.#currentMutation) {
      this.#currentMutation.add(operation);
    } else {
      this.#operationList.push(operation);
    }
  }
  consume(reactive) {
    const internals = reactive[REACTIVE];
    if (internals.type === 'mutable') {
      this.#consumeCell(internals);
    } else if (internals.type === 'composite') {
      this.#consumeFrame(internals);
    }
  }
  #consumeCell(cell) {
    this.#add(new ConsumeCell(this.#lastUpdate, cell));
  }
  updateCell(cell) {
    this.#add(new UpdateCell(this.#lastUpdate, cell));
  }
  #consumeFrame(frame) {
    this.#add(new ConsumeFrame(this.#lastUpdate, frame));
  }
  mutation(description, callback) {
    const prev = this.#currentMutation;
    const operation = new Mutation(this.#lastUpdate, description, prev);
    try {
      this.#currentMutation = operation;
      const ret = callback();
      this.#currentMutation = prev;
      this.#add(operation);
      return ret;
    } catch (e) {
      this.#currentMutation = prev;
      throw e;
    }
  }
}

class StaticValidatorDescription {
  type = 'static';
  isValid() {
    return true;
  }
}
class TimestampValidatorDescription {
  static from(internals) {
    return new TimestampValidatorDescription(internals);
  }
  type = 'timestamp';
  #internals;
  constructor(internals) {
    this.#internals = internals;
  }
  get lastUpdated() {
    return this.#internals.debug.lastUpdated;
  }
  isValid(since) {
    return this.#internals.isUpdatedSince(since);
  }
}

const Description = {
  is: (value) => {
    return value instanceof AbstractDescription;
  },
  from: (type, args, validator) => {
    if (args.description) {
      return args.description;
    }
    const description = type.from({ ...args, validator });
    if (args.transform) {
      return args.transform(description);
    } else {
      return description;
    }
  },
};
class AbstractDescription {
  #name;
  #stack;
  #validator;
  constructor({ name, stack, validator }) {
    this.#name = name;
    this.#stack = stack;
    this.#validator = validator;
  }
  implementation(details) {
    return ImplementationDescription.from({
      ...details,
      validator: this.#validator,
      userFacing: this.userFacing(),
      stack: this.#stack,
    });
  }
  get validator() {
    return this.#validator;
  }
  get fullName() {
    if (this.#name !== void 0) {
      if (typeof this.#name === 'string') {
        return this.#name;
      } else {
        return `${this.#name.parent.fullName}${this.name}`;
      }
    } else {
      return `{anonymous ${this.type}}`;
    }
  }
  get name() {
    if (this.#name) {
      if (typeof this.#name === 'string') {
        return this.#name;
      } else {
        switch (this.#name.type) {
          case 'member':
            return `->${this.#name.name}`;
          case 'method':
            return `.${this.#name.name}()`;
        }
      }
    } else {
      return `{anonymous ${this.type}}`;
    }
  }
  method(name) {
    return FormulaDescription.from({
      name: {
        type: 'method',
        parent: this,
        name,
      },
      validator: this.#validator,
      stack: this.#stack,
    });
  }
  member(name) {
    return FormulaDescription.from({
      name: {
        type: 'member',
        parent: this,
        name,
      },
      validator: this.#validator,
      stack: this.#stack,
    });
  }
  memberArgs(name) {
    return {
      name: {
        type: 'member',
        parent: this,
        name,
      },
      stack: this.#stack,
    };
  }
  describe({ source = false } = {}) {
    if (this.#name === void 0) {
      return `${this.fullName} @ ${this.#caller}`;
    } else if (source) {
      return `${this.fullName} @ ${this.#caller}`;
    } else {
      return this.fullName;
    }
  }
  get #caller() {
    const caller = this.#stack?.caller;
    if (caller !== void 0) {
      return caller.display;
    } else {
      return '<unknown>';
    }
  }
  get frame() {
    return this.#stack?.caller;
  }
}
class AbstractUserFacingDescription extends AbstractDescription {
  userFacing() {
    return this;
  }
}
class ImplementationDescription extends AbstractDescription {
  static from(create) {
    return new ImplementationDescription(create, create);
  }
  type = 'implementation';
  #implementation;
  constructor(create, implementation) {
    super(create);
    this.#implementation = implementation;
  }
  userFacing() {
    return this.#implementation.userFacing;
  }
}
class StaticDescription extends AbstractUserFacingDescription {
  static from(options) {
    if (Description.is(options)) {
      return options;
    }
    return new StaticDescription({
      ...options,
      validator: new StaticValidatorDescription(),
    });
  }
  type = 'static';
}
class CellDescription extends AbstractUserFacingDescription {
  static from(options) {
    if (Description.is(options)) {
      return options;
    }
    return new CellDescription(options);
  }
  type = 'cell';
}
class MarkerDescription extends AbstractUserFacingDescription {
  constructor(options, type) {
    super(options);
    this.type = type;
  }
  static type(type) {
    return {
      from: (options) => MarkerDescription.from(type, options),
    };
  }
  static from(type, options) {
    if (Description.is(options)) {
      return options;
    }
    return new MarkerDescription(options, type);
  }
}
class FormulaDescription extends AbstractUserFacingDescription {
  static from(options) {
    if (Description.is(options)) {
      return options;
    }
    return new FormulaDescription(options);
  }
  type = 'formula';
}

function DisplayStruct(name, fields, options) {
  let displayName = name;
  if (options?.description) {
    displayName = `${displayName} [${
      typeof options.description === 'string'
        ? options.description
        : JSON.stringify(options.description)
    }]`;
  }
  let constructor = class {};
  Object.defineProperty(constructor, 'name', { value: displayName });
  let object = new constructor();
  for (let [key, value] of entries(fields)) {
    Object.defineProperty(object, key, {
      value,
      enumerable: true,
    });
  }
  return object;
}
function entries(object) {
  return Object.entries(object);
}

const INSPECT$1 = Symbol.for('nodejs.util.inspect.custom');
const DEBUG = Symbol('STARBEAM_DEBUG');
const DEBUG_NAME = Symbol('STARBEAM_DEBUG_NAME');
class Debug {
  static create(name, options) {
    return new Debug(name, options);
  }
  #name;
  #options;
  constructor(name, options) {
    this.#name = name;
    this.#options = options;
  }
  stylize(text, styleType) {
    return this.#options.stylize(text, styleType);
  }
  struct(fields, options) {
    return DisplayStruct(this.#name, fields, options);
  }
}
function inspector(Class, name = Class.name) {
  return {
    define: (inspector2) => {
      Class.prototype[INSPECT$1] = function (_depth, options) {
        return inspector2(this, Debug.create(name, options));
      };
    },
  };
}

var LogLevel = /* @__PURE__ */ ((LogLevel2) => {
  LogLevel2[(LogLevel2['Trace'] = 0)] = 'Trace';
  LogLevel2[(LogLevel2['Debug'] = 1)] = 'Debug';
  LogLevel2[(LogLevel2['Info'] = 2)] = 'Info';
  LogLevel2[(LogLevel2['Warn'] = 3)] = 'Warn';
  LogLevel2[(LogLevel2['Error'] = 4)] = 'Error';
  LogLevel2[(LogLevel2['Fatal'] = 5)] = 'Fatal';
  return LogLevel2;
})(LogLevel || {});
class LoggerAsLevel {
  #logger;
  #level;
  #config;
  constructor(logger, level, config) {
    this.#logger = logger;
    this.#level = level;
    this.#config = config;
  }
  log(arg, ...args) {
    if (this.#level >= this.#config.minimum) {
      this.#logger.send(this.#level, { args: [arg, ...args] });
    }
  }
  get withStack() {
    return new LoggerWithStack(this.#logger, this.#level, this.#config);
  }
}
class LoggerWithStack {
  #logger;
  #level;
  #config;
  constructor(logger, level, config) {
    this.#logger = logger;
    this.#level = level;
    this.#config = config;
  }
  log(arg, ...args) {
    if (this.#level >= this.#config.minimum) {
      this.#logger.send(this.#level, { args: [arg, ...args], stack: true });
    }
  }
}
class Logger {
  #console;
  #config;
  trace;
  debug;
  info;
  warn;
  error;
  fatal;
  constructor(console, config) {
    this.#console = console;
    this.#config = config;
    this.trace = new LoggerAsLevel(this, 0 /* Trace */, config);
    this.debug = new LoggerAsLevel(this, 1 /* Debug */, config);
    this.info = new LoggerAsLevel(this, 2 /* Info */, config);
    this.warn = new LoggerAsLevel(this, 3 /* Warn */, config);
    this.error = new LoggerAsLevel(this, 4 /* Error */, config);
    this.fatal = new LoggerAsLevel(this, 5 /* Fatal */, config);
  }
  set level(level) {
    this.#config = { ...this.#config, minimum: level };
  }
  get isVerbose() {
    return this.#config.minimum === 0 /* Trace */;
  }
  get isDebug() {
    return this.#config.minimum <= 1 /* Debug */;
  }
  configure(config) {
    Object.assign(this.#config, config);
  }
  send(level, { args, stack }) {
    if (level === 0 /* Trace */) {
      if (stack) {
        this.#console.trace(...args);
      } else {
        this.#console.debug(...args);
      }
    }
    this.#console.groupCollapsed('stack trace');
    this.#console.trace();
    this.#console.groupEnd();
    switch (level) {
      case 0 /* Trace */:
        if (stack) {
          this.#console.trace(...args);
        } else {
          this.#console.debug(...args);
        }
        break;
      case 1 /* Debug */:
        this.#console.debug(...args);
        break;
      case 2 /* Info */:
        this.#console.log(...args);
        break;
      case 3 /* Warn */:
        this.#console.warn(...args);
        break;
      case 4 /* Error */:
        this.#console.error(...args);
        break;
      case 5 /* Fatal */:
        this.#console.error(...args);
        break;
    }
  }
}
const LOGGER = new Logger(globalThis.console, {
  minimum: 3 /* Warn */,
});

function describeModule(module) {
  return new DescribedModule(parse(module));
}
class DescribedModule {
  #module;
  constructor(module) {
    this.#module = module;
  }
  get #simple() {
    return `${this.#module.path}`;
  }
  display(location) {
    if (location === void 0) {
      return this.#simple;
    }
    const { loc, action } = location;
    const hasLoc = loc !== void 0;
    const hasAction = action !== void 0 && action.trim().length !== 0;
    if (hasLoc && hasAction) {
      return `${action} (${this.#module.path}:${formatLoc(loc)})`;
    } else if (hasLoc) {
      return `${this.#module.path}:${formatLoc(loc)}`;
    } else if (hasAction) {
      return `${action} (${this.#module.path})`;
    } else {
      return this.#simple;
    }
  }
}
function formatLoc(loc) {
  if (loc.column === void 0) {
    return `${loc.line}`;
  } else {
    return `${loc.line}:${loc.column}`;
  }
}
class DescribedModulePath {
  type = 'relative';
  #path;
  constructor(path) {
    this.#path = path;
  }
  get pkg() {
    return null;
  }
  get path() {
    return this.localPath;
  }
  get localPath() {
    return join(this.#path);
  }
}
class DescribedPackage {
  type = 'package';
  #scope;
  #name;
  #path;
  constructor(scope, name, path) {
    this.#scope = scope;
    this.#name = name;
    this.#path = path;
  }
  get pkg() {
    return join(this.#scope, this.#name);
  }
  get path() {
    return join(this.#scope, this.#name, this.#path);
  }
  get localPath() {
    return this.#path;
  }
}
const SOURCE_PARTS =
  /^(?:(?<scope>@[^/\\]+)[/])?(?<name>[^/\\]+)(?:[/\\](?<path>.*))?$/;
function parse(module) {
  if (module.startsWith('.') || module.startsWith('/')) {
    return new DescribedModulePath(module);
  }
  const groups = SOURCE_PARTS.exec(module)?.groups;
  if (groups === void 0) {
    return new DescribedModulePath(module);
  }
  const { scope, name, path } = groups;
  return new DescribedPackage(scope, name, path);
}
function join(...pathParts) {
  return pathParts
    .filter(hasType('string'))
    .map((p) => p.replaceAll(/[\\]/g, '/'))
    .join('/');
}

function commonjsRequire(path) {
  throw new Error(
    'Could not dynamically require "' +
      path +
      '". Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of @rollup/plugin-commonjs appropriately for this require call to work.'
  );
}

var getSource$1 = { exports: {} };

var sourceMap = {};

var sourceMapGenerator = {};

var base64Vlq = {};

var base64$1 = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

var intToCharMap =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('');

/**
 * Encode an integer in the range of 0 to 63 to a single base 64 digit.
 */
base64$1.encode = function (number) {
  if (0 <= number && number < intToCharMap.length) {
    return intToCharMap[number];
  }
  throw new TypeError('Must be between 0 and 63: ' + number);
};

/**
 * Decode a single base 64 character code digit to an integer. Returns -1 on
 * failure.
 */
base64$1.decode = function (charCode) {
  var bigA = 65; // 'A'
  var bigZ = 90; // 'Z'

  var littleA = 97; // 'a'
  var littleZ = 122; // 'z'

  var zero = 48; // '0'
  var nine = 57; // '9'

  var plus = 43; // '+'
  var slash = 47; // '/'

  var littleOffset = 26;
  var numberOffset = 52;

  // 0 - 25: ABCDEFGHIJKLMNOPQRSTUVWXYZ
  if (bigA <= charCode && charCode <= bigZ) {
    return charCode - bigA;
  }

  // 26 - 51: abcdefghijklmnopqrstuvwxyz
  if (littleA <= charCode && charCode <= littleZ) {
    return charCode - littleA + littleOffset;
  }

  // 52 - 61: 0123456789
  if (zero <= charCode && charCode <= nine) {
    return charCode - zero + numberOffset;
  }

  // 62: +
  if (charCode == plus) {
    return 62;
  }

  // 63: /
  if (charCode == slash) {
    return 63;
  }

  // Invalid base64 digit.
  return -1;
};

/* -*- Mode: js; js-indent-level: 2; -*- */

/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 *
 * Based on the Base 64 VLQ implementation in Closure Compiler:
 * https://code.google.com/p/closure-compiler/source/browse/trunk/src/com/google/debugging/sourcemap/Base64VLQ.java
 *
 * Copyright 2011 The Closure Compiler Authors. All rights reserved.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *  * Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above
 *    copyright notice, this list of conditions and the following
 *    disclaimer in the documentation and/or other materials provided
 *    with the distribution.
 *  * Neither the name of Google Inc. nor the names of its
 *    contributors may be used to endorse or promote products derived
 *    from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

var base64 = base64$1;

// A single base 64 digit can contain 6 bits of data. For the base 64 variable
// length quantities we use in the source map spec, the first bit is the sign,
// the next four bits are the actual value, and the 6th bit is the
// continuation bit. The continuation bit tells us whether there are more
// digits in this value following this digit.
//
//   Continuation
//   |    Sign
//   |    |
//   V    V
//   101011

var VLQ_BASE_SHIFT = 5;

// binary: 100000
var VLQ_BASE = 1 << VLQ_BASE_SHIFT;

// binary: 011111
var VLQ_BASE_MASK = VLQ_BASE - 1;

// binary: 100000
var VLQ_CONTINUATION_BIT = VLQ_BASE;

/**
 * Converts from a two-complement value to a value where the sign bit is
 * placed in the least significant bit.  For example, as decimals:
 *   1 becomes 2 (10 binary), -1 becomes 3 (11 binary)
 *   2 becomes 4 (100 binary), -2 becomes 5 (101 binary)
 */
function toVLQSigned(aValue) {
  return aValue < 0 ? (-aValue << 1) + 1 : (aValue << 1) + 0;
}

/**
 * Converts to a two-complement value from a value where the sign bit is
 * placed in the least significant bit.  For example, as decimals:
 *   2 (10 binary) becomes 1, 3 (11 binary) becomes -1
 *   4 (100 binary) becomes 2, 5 (101 binary) becomes -2
 */
function fromVLQSigned(aValue) {
  var isNegative = (aValue & 1) === 1;
  var shifted = aValue >> 1;
  return isNegative ? -shifted : shifted;
}

/**
 * Returns the base 64 VLQ encoded value.
 */
base64Vlq.encode = function base64VLQ_encode(aValue) {
  var encoded = '';
  var digit;

  var vlq = toVLQSigned(aValue);

  do {
    digit = vlq & VLQ_BASE_MASK;
    vlq >>>= VLQ_BASE_SHIFT;
    if (vlq > 0) {
      // There are still more digits in this value, so we must make sure the
      // continuation bit is marked.
      digit |= VLQ_CONTINUATION_BIT;
    }
    encoded += base64.encode(digit);
  } while (vlq > 0);

  return encoded;
};

/**
 * Decodes the next base 64 VLQ value from the given string and returns the
 * value and the rest of the string via the out parameter.
 */
base64Vlq.decode = function base64VLQ_decode(aStr, aIndex, aOutParam) {
  var strLen = aStr.length;
  var result = 0;
  var shift = 0;
  var continuation, digit;

  do {
    if (aIndex >= strLen) {
      throw new Error('Expected more digits in base 64 VLQ value.');
    }

    digit = base64.decode(aStr.charCodeAt(aIndex++));
    if (digit === -1) {
      throw new Error('Invalid base64 digit: ' + aStr.charAt(aIndex - 1));
    }

    continuation = !!(digit & VLQ_CONTINUATION_BIT);
    digit &= VLQ_BASE_MASK;
    result = result + (digit << shift);
    shift += VLQ_BASE_SHIFT;
  } while (continuation);

  aOutParam.value = fromVLQSigned(result);
  aOutParam.rest = aIndex;
};

var util$5 = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

(function (exports) {
  /*
   * Copyright 2011 Mozilla Foundation and contributors
   * Licensed under the New BSD license. See LICENSE or:
   * http://opensource.org/licenses/BSD-3-Clause
   */

  /**
   * This is a helper function for getting values from parameter/options
   * objects.
   *
   * @param args The object we are extracting values from
   * @param name The name of the property we are getting.
   * @param defaultValue An optional value to return if the property is missing
   * from the object. If this is not specified and the property is missing, an
   * error will be thrown.
   */
  function getArg(aArgs, aName, aDefaultValue) {
    if (aName in aArgs) {
      return aArgs[aName];
    } else if (arguments.length === 3) {
      return aDefaultValue;
    } else {
      throw new Error('"' + aName + '" is a required argument.');
    }
  }
  exports.getArg = getArg;

  var urlRegexp =
    /^(?:([\w+\-.]+):)?\/\/(?:(\w+:\w+)@)?([\w.-]*)(?::(\d+))?(.*)$/;
  var dataUrlRegexp = /^data:.+\,.+$/;

  function urlParse(aUrl) {
    var match = aUrl.match(urlRegexp);
    if (!match) {
      return null;
    }
    return {
      scheme: match[1],
      auth: match[2],
      host: match[3],
      port: match[4],
      path: match[5],
    };
  }
  exports.urlParse = urlParse;

  function urlGenerate(aParsedUrl) {
    var url = '';
    if (aParsedUrl.scheme) {
      url += aParsedUrl.scheme + ':';
    }
    url += '//';
    if (aParsedUrl.auth) {
      url += aParsedUrl.auth + '@';
    }
    if (aParsedUrl.host) {
      url += aParsedUrl.host;
    }
    if (aParsedUrl.port) {
      url += ':' + aParsedUrl.port;
    }
    if (aParsedUrl.path) {
      url += aParsedUrl.path;
    }
    return url;
  }
  exports.urlGenerate = urlGenerate;

  /**
   * Normalizes a path, or the path portion of a URL:
   *
   * - Replaces consecutive slashes with one slash.
   * - Removes unnecessary '.' parts.
   * - Removes unnecessary '<dir>/..' parts.
   *
   * Based on code in the Node.js 'path' core module.
   *
   * @param aPath The path or url to normalize.
   */
  function normalize(aPath) {
    var path = aPath;
    var url = urlParse(aPath);
    if (url) {
      if (!url.path) {
        return aPath;
      }
      path = url.path;
    }
    var isAbsolute = exports.isAbsolute(path);

    var parts = path.split(/\/+/);
    for (var part, up = 0, i = parts.length - 1; i >= 0; i--) {
      part = parts[i];
      if (part === '.') {
        parts.splice(i, 1);
      } else if (part === '..') {
        up++;
      } else if (up > 0) {
        if (part === '') {
          // The first part is blank if the path is absolute. Trying to go
          // above the root is a no-op. Therefore we can remove all '..' parts
          // directly after the root.
          parts.splice(i + 1, up);
          up = 0;
        } else {
          parts.splice(i, 2);
          up--;
        }
      }
    }
    path = parts.join('/');

    if (path === '') {
      path = isAbsolute ? '/' : '.';
    }

    if (url) {
      url.path = path;
      return urlGenerate(url);
    }
    return path;
  }
  exports.normalize = normalize;

  /**
   * Joins two paths/URLs.
   *
   * @param aRoot The root path or URL.
   * @param aPath The path or URL to be joined with the root.
   *
   * - If aPath is a URL or a data URI, aPath is returned, unless aPath is a
   *   scheme-relative URL: Then the scheme of aRoot, if any, is prepended
   *   first.
   * - Otherwise aPath is a path. If aRoot is a URL, then its path portion
   *   is updated with the result and aRoot is returned. Otherwise the result
   *   is returned.
   *   - If aPath is absolute, the result is aPath.
   *   - Otherwise the two paths are joined with a slash.
   * - Joining for example 'http://' and 'www.example.com' is also supported.
   */
  function join(aRoot, aPath) {
    if (aRoot === '') {
      aRoot = '.';
    }
    if (aPath === '') {
      aPath = '.';
    }
    var aPathUrl = urlParse(aPath);
    var aRootUrl = urlParse(aRoot);
    if (aRootUrl) {
      aRoot = aRootUrl.path || '/';
    }

    // `join(foo, '//www.example.org')`
    if (aPathUrl && !aPathUrl.scheme) {
      if (aRootUrl) {
        aPathUrl.scheme = aRootUrl.scheme;
      }
      return urlGenerate(aPathUrl);
    }

    if (aPathUrl || aPath.match(dataUrlRegexp)) {
      return aPath;
    }

    // `join('http://', 'www.example.com')`
    if (aRootUrl && !aRootUrl.host && !aRootUrl.path) {
      aRootUrl.host = aPath;
      return urlGenerate(aRootUrl);
    }

    var joined =
      aPath.charAt(0) === '/'
        ? aPath
        : normalize(aRoot.replace(/\/+$/, '') + '/' + aPath);

    if (aRootUrl) {
      aRootUrl.path = joined;
      return urlGenerate(aRootUrl);
    }
    return joined;
  }
  exports.join = join;

  exports.isAbsolute = function (aPath) {
    return aPath.charAt(0) === '/' || urlRegexp.test(aPath);
  };

  /**
   * Make a path relative to a URL or another path.
   *
   * @param aRoot The root path or URL.
   * @param aPath The path or URL to be made relative to aRoot.
   */
  function relative(aRoot, aPath) {
    if (aRoot === '') {
      aRoot = '.';
    }

    aRoot = aRoot.replace(/\/$/, '');

    // It is possible for the path to be above the root. In this case, simply
    // checking whether the root is a prefix of the path won't work. Instead, we
    // need to remove components from the root one by one, until either we find
    // a prefix that fits, or we run out of components to remove.
    var level = 0;
    while (aPath.indexOf(aRoot + '/') !== 0) {
      var index = aRoot.lastIndexOf('/');
      if (index < 0) {
        return aPath;
      }

      // If the only part of the root that is left is the scheme (i.e. http://,
      // file:///, etc.), one or more slashes (/), or simply nothing at all, we
      // have exhausted all components, so the path is not relative to the root.
      aRoot = aRoot.slice(0, index);
      if (aRoot.match(/^([^\/]+:\/)?\/*$/)) {
        return aPath;
      }

      ++level;
    }

    // Make sure we add a "../" for each component we removed from the root.
    return Array(level + 1).join('../') + aPath.substr(aRoot.length + 1);
  }
  exports.relative = relative;

  var supportsNullProto = (function () {
    var obj = Object.create(null);
    return !('__proto__' in obj);
  })();

  function identity(s) {
    return s;
  }

  /**
   * Because behavior goes wacky when you set `__proto__` on objects, we
   * have to prefix all the strings in our set with an arbitrary character.
   *
   * See https://github.com/mozilla/source-map/pull/31 and
   * https://github.com/mozilla/source-map/issues/30
   *
   * @param String aStr
   */
  function toSetString(aStr) {
    if (isProtoString(aStr)) {
      return '$' + aStr;
    }

    return aStr;
  }
  exports.toSetString = supportsNullProto ? identity : toSetString;

  function fromSetString(aStr) {
    if (isProtoString(aStr)) {
      return aStr.slice(1);
    }

    return aStr;
  }
  exports.fromSetString = supportsNullProto ? identity : fromSetString;

  function isProtoString(s) {
    if (!s) {
      return false;
    }

    var length = s.length;

    if (length < 9 /* "__proto__".length */) {
      return false;
    }

    if (
      s.charCodeAt(length - 1) !== 95 /* '_' */ ||
      s.charCodeAt(length - 2) !== 95 /* '_' */ ||
      s.charCodeAt(length - 3) !== 111 /* 'o' */ ||
      s.charCodeAt(length - 4) !== 116 /* 't' */ ||
      s.charCodeAt(length - 5) !== 111 /* 'o' */ ||
      s.charCodeAt(length - 6) !== 114 /* 'r' */ ||
      s.charCodeAt(length - 7) !== 112 /* 'p' */ ||
      s.charCodeAt(length - 8) !== 95 /* '_' */ ||
      s.charCodeAt(length - 9) !== 95 /* '_' */
    ) {
      return false;
    }

    for (var i = length - 10; i >= 0; i--) {
      if (s.charCodeAt(i) !== 36 /* '$' */) {
        return false;
      }
    }

    return true;
  }

  /**
   * Comparator between two mappings where the original positions are compared.
   *
   * Optionally pass in `true` as `onlyCompareGenerated` to consider two
   * mappings with the same original source/line/column, but different generated
   * line and column the same. Useful when searching for a mapping with a
   * stubbed out mapping.
   */
  function compareByOriginalPositions(mappingA, mappingB, onlyCompareOriginal) {
    var cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp !== 0 || onlyCompareOriginal) {
      return cmp;
    }

    cmp = mappingA.generatedColumn - mappingB.generatedColumn;
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp !== 0) {
      return cmp;
    }

    return strcmp(mappingA.name, mappingB.name);
  }
  exports.compareByOriginalPositions = compareByOriginalPositions;

  /**
   * Comparator between two mappings with deflated source and name indices where
   * the generated positions are compared.
   *
   * Optionally pass in `true` as `onlyCompareGenerated` to consider two
   * mappings with the same generated line and column, but different
   * source/name/original line and column the same. Useful when searching for a
   * mapping with a stubbed out mapping.
   */
  function compareByGeneratedPositionsDeflated(
    mappingA,
    mappingB,
    onlyCompareGenerated
  ) {
    var cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.generatedColumn - mappingB.generatedColumn;
    if (cmp !== 0 || onlyCompareGenerated) {
      return cmp;
    }

    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp !== 0) {
      return cmp;
    }

    return strcmp(mappingA.name, mappingB.name);
  }
  exports.compareByGeneratedPositionsDeflated =
    compareByGeneratedPositionsDeflated;

  function strcmp(aStr1, aStr2) {
    if (aStr1 === aStr2) {
      return 0;
    }

    if (aStr1 === null) {
      return 1; // aStr2 !== null
    }

    if (aStr2 === null) {
      return -1; // aStr1 !== null
    }

    if (aStr1 > aStr2) {
      return 1;
    }

    return -1;
  }

  /**
   * Comparator between two mappings with inflated source and name strings where
   * the generated positions are compared.
   */
  function compareByGeneratedPositionsInflated(mappingA, mappingB) {
    var cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.generatedColumn - mappingB.generatedColumn;
    if (cmp !== 0) {
      return cmp;
    }

    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp !== 0) {
      return cmp;
    }

    return strcmp(mappingA.name, mappingB.name);
  }
  exports.compareByGeneratedPositionsInflated =
    compareByGeneratedPositionsInflated;

  /**
   * Strip any JSON XSSI avoidance prefix from the string (as documented
   * in the source maps specification), and then parse the string as
   * JSON.
   */
  function parseSourceMapInput(str) {
    return JSON.parse(str.replace(/^\)]}'[^\n]*\n/, ''));
  }
  exports.parseSourceMapInput = parseSourceMapInput;

  /**
   * Compute the URL of a source given the the source root, the source's
   * URL, and the source map's URL.
   */
  function computeSourceURL(sourceRoot, sourceURL, sourceMapURL) {
    sourceURL = sourceURL || '';

    if (sourceRoot) {
      // This follows what Chrome does.
      if (sourceRoot[sourceRoot.length - 1] !== '/' && sourceURL[0] !== '/') {
        sourceRoot += '/';
      }
      // The spec says:
      //   Line 4: An optional source root, useful for relocating source
      //   files on a server or removing repeated values in the
      //   “sources” entry.  This value is prepended to the individual
      //   entries in the “source” field.
      sourceURL = sourceRoot + sourceURL;
    }

    // Historically, SourceMapConsumer did not take the sourceMapURL as
    // a parameter.  This mode is still somewhat supported, which is why
    // this code block is conditional.  However, it's preferable to pass
    // the source map URL to SourceMapConsumer, so that this function
    // can implement the source URL resolution algorithm as outlined in
    // the spec.  This block is basically the equivalent of:
    //    new URL(sourceURL, sourceMapURL).toString()
    // ... except it avoids using URL, which wasn't available in the
    // older releases of node still supported by this library.
    //
    // The spec says:
    //   If the sources are not absolute URLs after prepending of the
    //   “sourceRoot”, the sources are resolved relative to the
    //   SourceMap (like resolving script src in a html document).
    if (sourceMapURL) {
      var parsed = urlParse(sourceMapURL);
      if (!parsed) {
        throw new Error('sourceMapURL could not be parsed');
      }
      if (parsed.path) {
        // Strip the last path component, but keep the "/".
        var index = parsed.path.lastIndexOf('/');
        if (index >= 0) {
          parsed.path = parsed.path.substring(0, index + 1);
        }
      }
      sourceURL = join(urlGenerate(parsed), sourceURL);
    }

    return normalize(sourceURL);
  }
  exports.computeSourceURL = computeSourceURL;
})(util$5);

var arraySet = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

var util$4 = util$5;
var has = Object.prototype.hasOwnProperty;
var hasNativeMap = typeof Map !== 'undefined';

/**
 * A data structure which is a combination of an array and a set. Adding a new
 * member is O(1), testing for membership is O(1), and finding the index of an
 * element is O(1). Removing elements from the set is not supported. Only
 * strings are supported for membership.
 */
function ArraySet$2() {
  this._array = [];
  this._set = hasNativeMap ? new Map() : Object.create(null);
}

/**
 * Static method for creating ArraySet instances from an existing array.
 */
ArraySet$2.fromArray = function ArraySet_fromArray(aArray, aAllowDuplicates) {
  var set = new ArraySet$2();
  for (var i = 0, len = aArray.length; i < len; i++) {
    set.add(aArray[i], aAllowDuplicates);
  }
  return set;
};

/**
 * Return how many unique items are in this ArraySet. If duplicates have been
 * added, than those do not count towards the size.
 *
 * @returns Number
 */
ArraySet$2.prototype.size = function ArraySet_size() {
  return hasNativeMap
    ? this._set.size
    : Object.getOwnPropertyNames(this._set).length;
};

/**
 * Add the given string to this set.
 *
 * @param String aStr
 */
ArraySet$2.prototype.add = function ArraySet_add(aStr, aAllowDuplicates) {
  var sStr = hasNativeMap ? aStr : util$4.toSetString(aStr);
  var isDuplicate = hasNativeMap ? this.has(aStr) : has.call(this._set, sStr);
  var idx = this._array.length;
  if (!isDuplicate || aAllowDuplicates) {
    this._array.push(aStr);
  }
  if (!isDuplicate) {
    if (hasNativeMap) {
      this._set.set(aStr, idx);
    } else {
      this._set[sStr] = idx;
    }
  }
};

/**
 * Is the given string a member of this set?
 *
 * @param String aStr
 */
ArraySet$2.prototype.has = function ArraySet_has(aStr) {
  if (hasNativeMap) {
    return this._set.has(aStr);
  } else {
    var sStr = util$4.toSetString(aStr);
    return has.call(this._set, sStr);
  }
};

/**
 * What is the index of the given string in the array?
 *
 * @param String aStr
 */
ArraySet$2.prototype.indexOf = function ArraySet_indexOf(aStr) {
  if (hasNativeMap) {
    var idx = this._set.get(aStr);
    if (idx >= 0) {
      return idx;
    }
  } else {
    var sStr = util$4.toSetString(aStr);
    if (has.call(this._set, sStr)) {
      return this._set[sStr];
    }
  }

  throw new Error('"' + aStr + '" is not in the set.');
};

/**
 * What is the element at the given index?
 *
 * @param Number aIdx
 */
ArraySet$2.prototype.at = function ArraySet_at(aIdx) {
  if (aIdx >= 0 && aIdx < this._array.length) {
    return this._array[aIdx];
  }
  throw new Error('No element indexed by ' + aIdx);
};

/**
 * Returns the array representation of this set (which has the proper indices
 * indicated by indexOf). Note that this is a copy of the internal array used
 * for storing the members so that no one can mess with internal state.
 */
ArraySet$2.prototype.toArray = function ArraySet_toArray() {
  return this._array.slice();
};

arraySet.ArraySet = ArraySet$2;

var mappingList = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

/*
 * Copyright 2014 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

var util$3 = util$5;

/**
 * Determine whether mappingB is after mappingA with respect to generated
 * position.
 */
function generatedPositionAfter(mappingA, mappingB) {
  // Optimized for most common case
  var lineA = mappingA.generatedLine;
  var lineB = mappingB.generatedLine;
  var columnA = mappingA.generatedColumn;
  var columnB = mappingB.generatedColumn;
  return (
    lineB > lineA ||
    (lineB == lineA && columnB >= columnA) ||
    util$3.compareByGeneratedPositionsInflated(mappingA, mappingB) <= 0
  );
}

/**
 * A data structure to provide a sorted view of accumulated mappings in a
 * performance conscious manner. It trades a neglibable overhead in general
 * case for a large speedup in case of mappings being added in order.
 */
function MappingList$1() {
  this._array = [];
  this._sorted = true;
  // Serves as infimum
  this._last = { generatedLine: -1, generatedColumn: 0 };
}

/**
 * Iterate through internal items. This method takes the same arguments that
 * `Array.prototype.forEach` takes.
 *
 * NOTE: The order of the mappings is NOT guaranteed.
 */
MappingList$1.prototype.unsortedForEach = function MappingList_forEach(
  aCallback,
  aThisArg
) {
  this._array.forEach(aCallback, aThisArg);
};

/**
 * Add the given source mapping.
 *
 * @param Object aMapping
 */
MappingList$1.prototype.add = function MappingList_add(aMapping) {
  if (generatedPositionAfter(this._last, aMapping)) {
    this._last = aMapping;
    this._array.push(aMapping);
  } else {
    this._sorted = false;
    this._array.push(aMapping);
  }
};

/**
 * Returns the flat, sorted array of mappings. The mappings are sorted by
 * generated position.
 *
 * WARNING: This method returns internal data without copying, for
 * performance. The return value must NOT be mutated, and should be treated as
 * an immutable borrow. If you want to take ownership, you must make your own
 * copy.
 */
MappingList$1.prototype.toArray = function MappingList_toArray() {
  if (!this._sorted) {
    this._array.sort(util$3.compareByGeneratedPositionsInflated);
    this._sorted = true;
  }
  return this._array;
};

mappingList.MappingList = MappingList$1;

/* -*- Mode: js; js-indent-level: 2; -*- */

/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

var base64VLQ$1 = base64Vlq;
var util$2 = util$5;
var ArraySet$1 = arraySet.ArraySet;
var MappingList = mappingList.MappingList;

/**
 * An instance of the SourceMapGenerator represents a source map which is
 * being built incrementally. You may pass an object with the following
 * properties:
 *
 *   - file: The filename of the generated source.
 *   - sourceRoot: A root for all relative URLs in this source map.
 */
function SourceMapGenerator$1(aArgs) {
  if (!aArgs) {
    aArgs = {};
  }
  this._file = util$2.getArg(aArgs, 'file', null);
  this._sourceRoot = util$2.getArg(aArgs, 'sourceRoot', null);
  this._skipValidation = util$2.getArg(aArgs, 'skipValidation', false);
  this._sources = new ArraySet$1();
  this._names = new ArraySet$1();
  this._mappings = new MappingList();
  this._sourcesContents = null;
}

SourceMapGenerator$1.prototype._version = 3;

/**
 * Creates a new SourceMapGenerator based on a SourceMapConsumer
 *
 * @param aSourceMapConsumer The SourceMap.
 */
SourceMapGenerator$1.fromSourceMap = function SourceMapGenerator_fromSourceMap(
  aSourceMapConsumer
) {
  var sourceRoot = aSourceMapConsumer.sourceRoot;
  var generator = new SourceMapGenerator$1({
    file: aSourceMapConsumer.file,
    sourceRoot: sourceRoot,
  });
  aSourceMapConsumer.eachMapping(function (mapping) {
    var newMapping = {
      generated: {
        line: mapping.generatedLine,
        column: mapping.generatedColumn,
      },
    };

    if (mapping.source != null) {
      newMapping.source = mapping.source;
      if (sourceRoot != null) {
        newMapping.source = util$2.relative(sourceRoot, newMapping.source);
      }

      newMapping.original = {
        line: mapping.originalLine,
        column: mapping.originalColumn,
      };

      if (mapping.name != null) {
        newMapping.name = mapping.name;
      }
    }

    generator.addMapping(newMapping);
  });
  aSourceMapConsumer.sources.forEach(function (sourceFile) {
    var sourceRelative = sourceFile;
    if (sourceRoot !== null) {
      sourceRelative = util$2.relative(sourceRoot, sourceFile);
    }

    if (!generator._sources.has(sourceRelative)) {
      generator._sources.add(sourceRelative);
    }

    var content = aSourceMapConsumer.sourceContentFor(sourceFile);
    if (content != null) {
      generator.setSourceContent(sourceFile, content);
    }
  });
  return generator;
};

/**
 * Add a single mapping from original source line and column to the generated
 * source's line and column for this source map being created. The mapping
 * object should have the following properties:
 *
 *   - generated: An object with the generated line and column positions.
 *   - original: An object with the original line and column positions.
 *   - source: The original source file (relative to the sourceRoot).
 *   - name: An optional original token name for this mapping.
 */
SourceMapGenerator$1.prototype.addMapping =
  function SourceMapGenerator_addMapping(aArgs) {
    var generated = util$2.getArg(aArgs, 'generated');
    var original = util$2.getArg(aArgs, 'original', null);
    var source = util$2.getArg(aArgs, 'source', null);
    var name = util$2.getArg(aArgs, 'name', null);

    if (!this._skipValidation) {
      this._validateMapping(generated, original, source, name);
    }

    if (source != null) {
      source = String(source);
      if (!this._sources.has(source)) {
        this._sources.add(source);
      }
    }

    if (name != null) {
      name = String(name);
      if (!this._names.has(name)) {
        this._names.add(name);
      }
    }

    this._mappings.add({
      generatedLine: generated.line,
      generatedColumn: generated.column,
      originalLine: original != null && original.line,
      originalColumn: original != null && original.column,
      source: source,
      name: name,
    });
  };

/**
 * Set the source content for a source file.
 */
SourceMapGenerator$1.prototype.setSourceContent =
  function SourceMapGenerator_setSourceContent(aSourceFile, aSourceContent) {
    var source = aSourceFile;
    if (this._sourceRoot != null) {
      source = util$2.relative(this._sourceRoot, source);
    }

    if (aSourceContent != null) {
      // Add the source content to the _sourcesContents map.
      // Create a new _sourcesContents map if the property is null.
      if (!this._sourcesContents) {
        this._sourcesContents = Object.create(null);
      }
      this._sourcesContents[util$2.toSetString(source)] = aSourceContent;
    } else if (this._sourcesContents) {
      // Remove the source file from the _sourcesContents map.
      // If the _sourcesContents map is empty, set the property to null.
      delete this._sourcesContents[util$2.toSetString(source)];
      if (Object.keys(this._sourcesContents).length === 0) {
        this._sourcesContents = null;
      }
    }
  };

/**
 * Applies the mappings of a sub-source-map for a specific source file to the
 * source map being generated. Each mapping to the supplied source file is
 * rewritten using the supplied source map. Note: The resolution for the
 * resulting mappings is the minimium of this map and the supplied map.
 *
 * @param aSourceMapConsumer The source map to be applied.
 * @param aSourceFile Optional. The filename of the source file.
 *        If omitted, SourceMapConsumer's file property will be used.
 * @param aSourceMapPath Optional. The dirname of the path to the source map
 *        to be applied. If relative, it is relative to the SourceMapConsumer.
 *        This parameter is needed when the two source maps aren't in the same
 *        directory, and the source map to be applied contains relative source
 *        paths. If so, those relative source paths need to be rewritten
 *        relative to the SourceMapGenerator.
 */
SourceMapGenerator$1.prototype.applySourceMap =
  function SourceMapGenerator_applySourceMap(
    aSourceMapConsumer,
    aSourceFile,
    aSourceMapPath
  ) {
    var sourceFile = aSourceFile;
    // If aSourceFile is omitted, we will use the file property of the SourceMap
    if (aSourceFile == null) {
      if (aSourceMapConsumer.file == null) {
        throw new Error(
          'SourceMapGenerator.prototype.applySourceMap requires either an explicit source file, ' +
            'or the source map\'s "file" property. Both were omitted.'
        );
      }
      sourceFile = aSourceMapConsumer.file;
    }
    var sourceRoot = this._sourceRoot;
    // Make "sourceFile" relative if an absolute Url is passed.
    if (sourceRoot != null) {
      sourceFile = util$2.relative(sourceRoot, sourceFile);
    }
    // Applying the SourceMap can add and remove items from the sources and
    // the names array.
    var newSources = new ArraySet$1();
    var newNames = new ArraySet$1();

    // Find mappings for the "sourceFile"
    this._mappings.unsortedForEach(function (mapping) {
      if (mapping.source === sourceFile && mapping.originalLine != null) {
        // Check if it can be mapped by the source map, then update the mapping.
        var original = aSourceMapConsumer.originalPositionFor({
          line: mapping.originalLine,
          column: mapping.originalColumn,
        });
        if (original.source != null) {
          // Copy mapping
          mapping.source = original.source;
          if (aSourceMapPath != null) {
            mapping.source = util$2.join(aSourceMapPath, mapping.source);
          }
          if (sourceRoot != null) {
            mapping.source = util$2.relative(sourceRoot, mapping.source);
          }
          mapping.originalLine = original.line;
          mapping.originalColumn = original.column;
          if (original.name != null) {
            mapping.name = original.name;
          }
        }
      }

      var source = mapping.source;
      if (source != null && !newSources.has(source)) {
        newSources.add(source);
      }

      var name = mapping.name;
      if (name != null && !newNames.has(name)) {
        newNames.add(name);
      }
    }, this);
    this._sources = newSources;
    this._names = newNames;

    // Copy sourcesContents of applied map.
    aSourceMapConsumer.sources.forEach(function (sourceFile) {
      var content = aSourceMapConsumer.sourceContentFor(sourceFile);
      if (content != null) {
        if (aSourceMapPath != null) {
          sourceFile = util$2.join(aSourceMapPath, sourceFile);
        }
        if (sourceRoot != null) {
          sourceFile = util$2.relative(sourceRoot, sourceFile);
        }
        this.setSourceContent(sourceFile, content);
      }
    }, this);
  };

/**
 * A mapping can have one of the three levels of data:
 *
 *   1. Just the generated position.
 *   2. The Generated position, original position, and original source.
 *   3. Generated and original position, original source, as well as a name
 *      token.
 *
 * To maintain consistency, we validate that any new mapping being added falls
 * in to one of these categories.
 */
SourceMapGenerator$1.prototype._validateMapping =
  function SourceMapGenerator_validateMapping(
    aGenerated,
    aOriginal,
    aSource,
    aName
  ) {
    // When aOriginal is truthy but has empty values for .line and .column,
    // it is most likely a programmer error. In this case we throw a very
    // specific error message to try to guide them the right way.
    // For example: https://github.com/Polymer/polymer-bundler/pull/519
    if (
      aOriginal &&
      typeof aOriginal.line !== 'number' &&
      typeof aOriginal.column !== 'number'
    ) {
      throw new Error(
        'original.line and original.column are not numbers -- you probably meant to omit ' +
          'the original mapping entirely and only map the generated position. If so, pass ' +
          'null for the original mapping instead of an object with empty or null values.'
      );
    }

    if (
      aGenerated &&
      'line' in aGenerated &&
      'column' in aGenerated &&
      aGenerated.line > 0 &&
      aGenerated.column >= 0 &&
      !aOriginal &&
      !aSource &&
      !aName
    ) {
      // Case 1.
      return;
    } else if (
      aGenerated &&
      'line' in aGenerated &&
      'column' in aGenerated &&
      aOriginal &&
      'line' in aOriginal &&
      'column' in aOriginal &&
      aGenerated.line > 0 &&
      aGenerated.column >= 0 &&
      aOriginal.line > 0 &&
      aOriginal.column >= 0 &&
      aSource
    ) {
      // Cases 2 and 3.
      return;
    } else {
      throw new Error(
        'Invalid mapping: ' +
          JSON.stringify({
            generated: aGenerated,
            source: aSource,
            original: aOriginal,
            name: aName,
          })
      );
    }
  };

/**
 * Serialize the accumulated mappings in to the stream of base 64 VLQs
 * specified by the source map format.
 */
SourceMapGenerator$1.prototype._serializeMappings =
  function SourceMapGenerator_serializeMappings() {
    var previousGeneratedColumn = 0;
    var previousGeneratedLine = 1;
    var previousOriginalColumn = 0;
    var previousOriginalLine = 0;
    var previousName = 0;
    var previousSource = 0;
    var result = '';
    var next;
    var mapping;
    var nameIdx;
    var sourceIdx;

    var mappings = this._mappings.toArray();
    for (var i = 0, len = mappings.length; i < len; i++) {
      mapping = mappings[i];
      next = '';

      if (mapping.generatedLine !== previousGeneratedLine) {
        previousGeneratedColumn = 0;
        while (mapping.generatedLine !== previousGeneratedLine) {
          next += ';';
          previousGeneratedLine++;
        }
      } else {
        if (i > 0) {
          if (
            !util$2.compareByGeneratedPositionsInflated(
              mapping,
              mappings[i - 1]
            )
          ) {
            continue;
          }
          next += ',';
        }
      }

      next += base64VLQ$1.encode(
        mapping.generatedColumn - previousGeneratedColumn
      );
      previousGeneratedColumn = mapping.generatedColumn;

      if (mapping.source != null) {
        sourceIdx = this._sources.indexOf(mapping.source);
        next += base64VLQ$1.encode(sourceIdx - previousSource);
        previousSource = sourceIdx;

        // lines are stored 0-based in SourceMap spec version 3
        next += base64VLQ$1.encode(
          mapping.originalLine - 1 - previousOriginalLine
        );
        previousOriginalLine = mapping.originalLine - 1;

        next += base64VLQ$1.encode(
          mapping.originalColumn - previousOriginalColumn
        );
        previousOriginalColumn = mapping.originalColumn;

        if (mapping.name != null) {
          nameIdx = this._names.indexOf(mapping.name);
          next += base64VLQ$1.encode(nameIdx - previousName);
          previousName = nameIdx;
        }
      }

      result += next;
    }

    return result;
  };

SourceMapGenerator$1.prototype._generateSourcesContent =
  function SourceMapGenerator_generateSourcesContent(aSources, aSourceRoot) {
    return aSources.map(function (source) {
      if (!this._sourcesContents) {
        return null;
      }
      if (aSourceRoot != null) {
        source = util$2.relative(aSourceRoot, source);
      }
      var key = util$2.toSetString(source);
      return Object.prototype.hasOwnProperty.call(this._sourcesContents, key)
        ? this._sourcesContents[key]
        : null;
    }, this);
  };

/**
 * Externalize the source map.
 */
SourceMapGenerator$1.prototype.toJSON = function SourceMapGenerator_toJSON() {
  var map = {
    version: this._version,
    sources: this._sources.toArray(),
    names: this._names.toArray(),
    mappings: this._serializeMappings(),
  };
  if (this._file != null) {
    map.file = this._file;
  }
  if (this._sourceRoot != null) {
    map.sourceRoot = this._sourceRoot;
  }
  if (this._sourcesContents) {
    map.sourcesContent = this._generateSourcesContent(
      map.sources,
      map.sourceRoot
    );
  }

  return map;
};

/**
 * Render the source map being generated to a string.
 */
SourceMapGenerator$1.prototype.toString =
  function SourceMapGenerator_toString() {
    return JSON.stringify(this.toJSON());
  };

sourceMapGenerator.SourceMapGenerator = SourceMapGenerator$1;

var sourceMapConsumer = {};

var binarySearch$1 = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

(function (exports) {
  /*
   * Copyright 2011 Mozilla Foundation and contributors
   * Licensed under the New BSD license. See LICENSE or:
   * http://opensource.org/licenses/BSD-3-Clause
   */

  exports.GREATEST_LOWER_BOUND = 1;
  exports.LEAST_UPPER_BOUND = 2;

  /**
   * Recursive implementation of binary search.
   *
   * @param aLow Indices here and lower do not contain the needle.
   * @param aHigh Indices here and higher do not contain the needle.
   * @param aNeedle The element being searched for.
   * @param aHaystack The non-empty array being searched.
   * @param aCompare Function which takes two elements and returns -1, 0, or 1.
   * @param aBias Either 'binarySearch.GREATEST_LOWER_BOUND' or
   *     'binarySearch.LEAST_UPPER_BOUND'. Specifies whether to return the
   *     closest element that is smaller than or greater than the one we are
   *     searching for, respectively, if the exact element cannot be found.
   */
  function recursiveSearch(aLow, aHigh, aNeedle, aHaystack, aCompare, aBias) {
    // This function terminates when one of the following is true:
    //
    //   1. We find the exact element we are looking for.
    //
    //   2. We did not find the exact element, but we can return the index of
    //      the next-closest element.
    //
    //   3. We did not find the exact element, and there is no next-closest
    //      element than the one we are searching for, so we return -1.
    var mid = Math.floor((aHigh - aLow) / 2) + aLow;
    var cmp = aCompare(aNeedle, aHaystack[mid], true);
    if (cmp === 0) {
      // Found the element we are looking for.
      return mid;
    } else if (cmp > 0) {
      // Our needle is greater than aHaystack[mid].
      if (aHigh - mid > 1) {
        // The element is in the upper half.
        return recursiveSearch(mid, aHigh, aNeedle, aHaystack, aCompare, aBias);
      }

      // The exact needle element was not found in this haystack. Determine if
      // we are in termination case (3) or (2) and return the appropriate thing.
      if (aBias == exports.LEAST_UPPER_BOUND) {
        return aHigh < aHaystack.length ? aHigh : -1;
      } else {
        return mid;
      }
    } else {
      // Our needle is less than aHaystack[mid].
      if (mid - aLow > 1) {
        // The element is in the lower half.
        return recursiveSearch(aLow, mid, aNeedle, aHaystack, aCompare, aBias);
      }

      // we are in termination case (3) or (2) and return the appropriate thing.
      if (aBias == exports.LEAST_UPPER_BOUND) {
        return mid;
      } else {
        return aLow < 0 ? -1 : aLow;
      }
    }
  }

  /**
   * This is an implementation of binary search which will always try and return
   * the index of the closest element if there is no exact hit. This is because
   * mappings between original and generated line/col pairs are single points,
   * and there is an implicit region between each of them, so a miss just means
   * that you aren't on the very start of a region.
   *
   * @param aNeedle The element you are looking for.
   * @param aHaystack The array that is being searched.
   * @param aCompare A function which takes the needle and an element in the
   *     array and returns -1, 0, or 1 depending on whether the needle is less
   *     than, equal to, or greater than the element, respectively.
   * @param aBias Either 'binarySearch.GREATEST_LOWER_BOUND' or
   *     'binarySearch.LEAST_UPPER_BOUND'. Specifies whether to return the
   *     closest element that is smaller than or greater than the one we are
   *     searching for, respectively, if the exact element cannot be found.
   *     Defaults to 'binarySearch.GREATEST_LOWER_BOUND'.
   */
  exports.search = function search(aNeedle, aHaystack, aCompare, aBias) {
    if (aHaystack.length === 0) {
      return -1;
    }

    var index = recursiveSearch(
      -1,
      aHaystack.length,
      aNeedle,
      aHaystack,
      aCompare,
      aBias || exports.GREATEST_LOWER_BOUND
    );
    if (index < 0) {
      return -1;
    }

    // We have found either the exact element, or the next-closest element than
    // the one we are searching for. However, there may be more than one such
    // element. Make sure we always return the smallest of these.
    while (index - 1 >= 0) {
      if (aCompare(aHaystack[index], aHaystack[index - 1], true) !== 0) {
        break;
      }
      --index;
    }

    return index;
  };
})(binarySearch$1);

var quickSort$1 = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

// It turns out that some (most?) JavaScript engines don't self-host
// `Array.prototype.sort`. This makes sense because C++ will likely remain
// faster than JS when doing raw CPU-intensive sorting. However, when using a
// custom comparator function, calling back and forth between the VM's C++ and
// JIT'd JS is rather slow *and* loses JIT type information, resulting in
// worse generated code for the comparator function than would be optimal. In
// fact, when sorting with a comparator, these costs outweigh the benefits of
// sorting in C++. By using our own JS-implemented Quick Sort (below), we get
// a ~3500ms mean speed-up in `bench/bench.html`.

/**
 * Swap the elements indexed by `x` and `y` in the array `ary`.
 *
 * @param {Array} ary
 *        The array.
 * @param {Number} x
 *        The index of the first item.
 * @param {Number} y
 *        The index of the second item.
 */
function swap(ary, x, y) {
  var temp = ary[x];
  ary[x] = ary[y];
  ary[y] = temp;
}

/**
 * Returns a random integer within the range `low .. high` inclusive.
 *
 * @param {Number} low
 *        The lower bound on the range.
 * @param {Number} high
 *        The upper bound on the range.
 */
function randomIntInRange(low, high) {
  return Math.round(low + Math.random() * (high - low));
}

/**
 * The Quick Sort algorithm.
 *
 * @param {Array} ary
 *        An array to sort.
 * @param {function} comparator
 *        Function to use to compare two items.
 * @param {Number} p
 *        Start index of the array
 * @param {Number} r
 *        End index of the array
 */
function doQuickSort(ary, comparator, p, r) {
  // If our lower bound is less than our upper bound, we (1) partition the
  // array into two pieces and (2) recurse on each half. If it is not, this is
  // the empty array and our base case.

  if (p < r) {
    // (1) Partitioning.
    //
    // The partitioning chooses a pivot between `p` and `r` and moves all
    // elements that are less than or equal to the pivot to the before it, and
    // all the elements that are greater than it after it. The effect is that
    // once partition is done, the pivot is in the exact place it will be when
    // the array is put in sorted order, and it will not need to be moved
    // again. This runs in O(n) time.

    // Always choose a random pivot so that an input array which is reverse
    // sorted does not cause O(n^2) running time.
    var pivotIndex = randomIntInRange(p, r);
    var i = p - 1;

    swap(ary, pivotIndex, r);
    var pivot = ary[r];

    // Immediately after `j` is incremented in this loop, the following hold
    // true:
    //
    //   * Every element in `ary[p .. i]` is less than or equal to the pivot.
    //
    //   * Every element in `ary[i+1 .. j-1]` is greater than the pivot.
    for (var j = p; j < r; j++) {
      if (comparator(ary[j], pivot) <= 0) {
        i += 1;
        swap(ary, i, j);
      }
    }

    swap(ary, i + 1, j);
    var q = i + 1;

    // (2) Recurse on each half.

    doQuickSort(ary, comparator, p, q - 1);
    doQuickSort(ary, comparator, q + 1, r);
  }
}

/**
 * Sort the given array in-place with the given comparator function.
 *
 * @param {Array} ary
 *        An array to sort.
 * @param {function} comparator
 *        Function to use to compare two items.
 */
quickSort$1.quickSort = function (ary, comparator) {
  doQuickSort(ary, comparator, 0, ary.length - 1);
};

/* -*- Mode: js; js-indent-level: 2; -*- */

/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

var util$1 = util$5;
var binarySearch = binarySearch$1;
var ArraySet = arraySet.ArraySet;
var base64VLQ = base64Vlq;
var quickSort = quickSort$1.quickSort;

function SourceMapConsumer$1(aSourceMap, aSourceMapURL) {
  var sourceMap = aSourceMap;
  if (typeof aSourceMap === 'string') {
    sourceMap = util$1.parseSourceMapInput(aSourceMap);
  }

  return sourceMap.sections != null
    ? new IndexedSourceMapConsumer(sourceMap, aSourceMapURL)
    : new BasicSourceMapConsumer(sourceMap, aSourceMapURL);
}

SourceMapConsumer$1.fromSourceMap = function (aSourceMap, aSourceMapURL) {
  return BasicSourceMapConsumer.fromSourceMap(aSourceMap, aSourceMapURL);
};

/**
 * The version of the source mapping spec that we are consuming.
 */
SourceMapConsumer$1.prototype._version = 3;

// `__generatedMappings` and `__originalMappings` are arrays that hold the
// parsed mapping coordinates from the source map's "mappings" attribute. They
// are lazily instantiated, accessed via the `_generatedMappings` and
// `_originalMappings` getters respectively, and we only parse the mappings
// and create these arrays once queried for a source location. We jump through
// these hoops because there can be many thousands of mappings, and parsing
// them is expensive, so we only want to do it if we must.
//
// Each object in the arrays is of the form:
//
//     {
//       generatedLine: The line number in the generated code,
//       generatedColumn: The column number in the generated code,
//       source: The path to the original source file that generated this
//               chunk of code,
//       originalLine: The line number in the original source that
//                     corresponds to this chunk of generated code,
//       originalColumn: The column number in the original source that
//                       corresponds to this chunk of generated code,
//       name: The name of the original symbol which generated this chunk of
//             code.
//     }
//
// All properties except for `generatedLine` and `generatedColumn` can be
// `null`.
//
// `_generatedMappings` is ordered by the generated positions.
//
// `_originalMappings` is ordered by the original positions.

SourceMapConsumer$1.prototype.__generatedMappings = null;
Object.defineProperty(SourceMapConsumer$1.prototype, '_generatedMappings', {
  configurable: true,
  enumerable: true,
  get: function () {
    if (!this.__generatedMappings) {
      this._parseMappings(this._mappings, this.sourceRoot);
    }

    return this.__generatedMappings;
  },
});

SourceMapConsumer$1.prototype.__originalMappings = null;
Object.defineProperty(SourceMapConsumer$1.prototype, '_originalMappings', {
  configurable: true,
  enumerable: true,
  get: function () {
    if (!this.__originalMappings) {
      this._parseMappings(this._mappings, this.sourceRoot);
    }

    return this.__originalMappings;
  },
});

SourceMapConsumer$1.prototype._charIsMappingSeparator =
  function SourceMapConsumer_charIsMappingSeparator(aStr, index) {
    var c = aStr.charAt(index);
    return c === ';' || c === ',';
  };

/**
 * Parse the mappings in a string in to a data structure which we can easily
 * query (the ordered arrays in the `this.__generatedMappings` and
 * `this.__originalMappings` properties).
 */
SourceMapConsumer$1.prototype._parseMappings =
  function SourceMapConsumer_parseMappings(aStr, aSourceRoot) {
    throw new Error('Subclasses must implement _parseMappings');
  };

SourceMapConsumer$1.GENERATED_ORDER = 1;
SourceMapConsumer$1.ORIGINAL_ORDER = 2;

SourceMapConsumer$1.GREATEST_LOWER_BOUND = 1;
SourceMapConsumer$1.LEAST_UPPER_BOUND = 2;

/**
 * Iterate over each mapping between an original source/line/column and a
 * generated line/column in this source map.
 *
 * @param Function aCallback
 *        The function that is called with each mapping.
 * @param Object aContext
 *        Optional. If specified, this object will be the value of `this` every
 *        time that `aCallback` is called.
 * @param aOrder
 *        Either `SourceMapConsumer.GENERATED_ORDER` or
 *        `SourceMapConsumer.ORIGINAL_ORDER`. Specifies whether you want to
 *        iterate over the mappings sorted by the generated file's line/column
 *        order or the original's source/line/column order, respectively. Defaults to
 *        `SourceMapConsumer.GENERATED_ORDER`.
 */
SourceMapConsumer$1.prototype.eachMapping =
  function SourceMapConsumer_eachMapping(aCallback, aContext, aOrder) {
    var context = aContext || null;
    var order = aOrder || SourceMapConsumer$1.GENERATED_ORDER;

    var mappings;
    switch (order) {
      case SourceMapConsumer$1.GENERATED_ORDER:
        mappings = this._generatedMappings;
        break;
      case SourceMapConsumer$1.ORIGINAL_ORDER:
        mappings = this._originalMappings;
        break;
      default:
        throw new Error('Unknown order of iteration.');
    }

    var sourceRoot = this.sourceRoot;
    mappings
      .map(function (mapping) {
        var source =
          mapping.source === null ? null : this._sources.at(mapping.source);
        source = util$1.computeSourceURL(
          sourceRoot,
          source,
          this._sourceMapURL
        );
        return {
          source: source,
          generatedLine: mapping.generatedLine,
          generatedColumn: mapping.generatedColumn,
          originalLine: mapping.originalLine,
          originalColumn: mapping.originalColumn,
          name: mapping.name === null ? null : this._names.at(mapping.name),
        };
      }, this)
      .forEach(aCallback, context);
  };

/**
 * Returns all generated line and column information for the original source,
 * line, and column provided. If no column is provided, returns all mappings
 * corresponding to a either the line we are searching for or the next
 * closest line that has any mappings. Otherwise, returns all mappings
 * corresponding to the given line and either the column we are searching for
 * or the next closest column that has any offsets.
 *
 * The only argument is an object with the following properties:
 *
 *   - source: The filename of the original source.
 *   - line: The line number in the original source.  The line number is 1-based.
 *   - column: Optional. the column number in the original source.
 *    The column number is 0-based.
 *
 * and an array of objects is returned, each with the following properties:
 *
 *   - line: The line number in the generated source, or null.  The
 *    line number is 1-based.
 *   - column: The column number in the generated source, or null.
 *    The column number is 0-based.
 */
SourceMapConsumer$1.prototype.allGeneratedPositionsFor =
  function SourceMapConsumer_allGeneratedPositionsFor(aArgs) {
    var line = util$1.getArg(aArgs, 'line');

    // When there is no exact match, BasicSourceMapConsumer.prototype._findMapping
    // returns the index of the closest mapping less than the needle. By
    // setting needle.originalColumn to 0, we thus find the last mapping for
    // the given line, provided such a mapping exists.
    var needle = {
      source: util$1.getArg(aArgs, 'source'),
      originalLine: line,
      originalColumn: util$1.getArg(aArgs, 'column', 0),
    };

    needle.source = this._findSourceIndex(needle.source);
    if (needle.source < 0) {
      return [];
    }

    var mappings = [];

    var index = this._findMapping(
      needle,
      this._originalMappings,
      'originalLine',
      'originalColumn',
      util$1.compareByOriginalPositions,
      binarySearch.LEAST_UPPER_BOUND
    );
    if (index >= 0) {
      var mapping = this._originalMappings[index];

      if (aArgs.column === undefined) {
        var originalLine = mapping.originalLine;

        // Iterate until either we run out of mappings, or we run into
        // a mapping for a different line than the one we found. Since
        // mappings are sorted, this is guaranteed to find all mappings for
        // the line we found.
        while (mapping && mapping.originalLine === originalLine) {
          mappings.push({
            line: util$1.getArg(mapping, 'generatedLine', null),
            column: util$1.getArg(mapping, 'generatedColumn', null),
            lastColumn: util$1.getArg(mapping, 'lastGeneratedColumn', null),
          });

          mapping = this._originalMappings[++index];
        }
      } else {
        var originalColumn = mapping.originalColumn;

        // Iterate until either we run out of mappings, or we run into
        // a mapping for a different line than the one we were searching for.
        // Since mappings are sorted, this is guaranteed to find all mappings for
        // the line we are searching for.
        while (
          mapping &&
          mapping.originalLine === line &&
          mapping.originalColumn == originalColumn
        ) {
          mappings.push({
            line: util$1.getArg(mapping, 'generatedLine', null),
            column: util$1.getArg(mapping, 'generatedColumn', null),
            lastColumn: util$1.getArg(mapping, 'lastGeneratedColumn', null),
          });

          mapping = this._originalMappings[++index];
        }
      }
    }

    return mappings;
  };

sourceMapConsumer.SourceMapConsumer = SourceMapConsumer$1;

/**
 * A BasicSourceMapConsumer instance represents a parsed source map which we can
 * query for information about the original file positions by giving it a file
 * position in the generated source.
 *
 * The first parameter is the raw source map (either as a JSON string, or
 * already parsed to an object). According to the spec, source maps have the
 * following attributes:
 *
 *   - version: Which version of the source map spec this map is following.
 *   - sources: An array of URLs to the original source files.
 *   - names: An array of identifiers which can be referrenced by individual mappings.
 *   - sourceRoot: Optional. The URL root from which all sources are relative.
 *   - sourcesContent: Optional. An array of contents of the original source files.
 *   - mappings: A string of base64 VLQs which contain the actual mappings.
 *   - file: Optional. The generated file this source map is associated with.
 *
 * Here is an example source map, taken from the source map spec[0]:
 *
 *     {
 *       version : 3,
 *       file: "out.js",
 *       sourceRoot : "",
 *       sources: ["foo.js", "bar.js"],
 *       names: ["src", "maps", "are", "fun"],
 *       mappings: "AA,AB;;ABCDE;"
 *     }
 *
 * The second parameter, if given, is a string whose value is the URL
 * at which the source map was found.  This URL is used to compute the
 * sources array.
 *
 * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit?pli=1#
 */
function BasicSourceMapConsumer(aSourceMap, aSourceMapURL) {
  var sourceMap = aSourceMap;
  if (typeof aSourceMap === 'string') {
    sourceMap = util$1.parseSourceMapInput(aSourceMap);
  }

  var version = util$1.getArg(sourceMap, 'version');
  var sources = util$1.getArg(sourceMap, 'sources');
  // Sass 3.3 leaves out the 'names' array, so we deviate from the spec (which
  // requires the array) to play nice here.
  var names = util$1.getArg(sourceMap, 'names', []);
  var sourceRoot = util$1.getArg(sourceMap, 'sourceRoot', null);
  var sourcesContent = util$1.getArg(sourceMap, 'sourcesContent', null);
  var mappings = util$1.getArg(sourceMap, 'mappings');
  var file = util$1.getArg(sourceMap, 'file', null);

  // Once again, Sass deviates from the spec and supplies the version as a
  // string rather than a number, so we use loose equality checking here.
  if (version != this._version) {
    throw new Error('Unsupported version: ' + version);
  }

  if (sourceRoot) {
    sourceRoot = util$1.normalize(sourceRoot);
  }

  sources = sources
    .map(String)
    // Some source maps produce relative source paths like "./foo.js" instead of
    // "foo.js".  Normalize these first so that future comparisons will succeed.
    // See bugzil.la/1090768.
    .map(util$1.normalize)
    // Always ensure that absolute sources are internally stored relative to
    // the source root, if the source root is absolute. Not doing this would
    // be particularly problematic when the source root is a prefix of the
    // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
    .map(function (source) {
      return sourceRoot &&
        util$1.isAbsolute(sourceRoot) &&
        util$1.isAbsolute(source)
        ? util$1.relative(sourceRoot, source)
        : source;
    });

  // Pass `true` below to allow duplicate names and sources. While source maps
  // are intended to be compressed and deduplicated, the TypeScript compiler
  // sometimes generates source maps with duplicates in them. See Github issue
  // #72 and bugzil.la/889492.
  this._names = ArraySet.fromArray(names.map(String), true);
  this._sources = ArraySet.fromArray(sources, true);

  this._absoluteSources = this._sources.toArray().map(function (s) {
    return util$1.computeSourceURL(sourceRoot, s, aSourceMapURL);
  });

  this.sourceRoot = sourceRoot;
  this.sourcesContent = sourcesContent;
  this._mappings = mappings;
  this._sourceMapURL = aSourceMapURL;
  this.file = file;
}

BasicSourceMapConsumer.prototype = Object.create(SourceMapConsumer$1.prototype);
BasicSourceMapConsumer.prototype.consumer = SourceMapConsumer$1;

/**
 * Utility function to find the index of a source.  Returns -1 if not
 * found.
 */
BasicSourceMapConsumer.prototype._findSourceIndex = function (aSource) {
  var relativeSource = aSource;
  if (this.sourceRoot != null) {
    relativeSource = util$1.relative(this.sourceRoot, relativeSource);
  }

  if (this._sources.has(relativeSource)) {
    return this._sources.indexOf(relativeSource);
  }

  // Maybe aSource is an absolute URL as returned by |sources|.  In
  // this case we can't simply undo the transform.
  var i;
  for (i = 0; i < this._absoluteSources.length; ++i) {
    if (this._absoluteSources[i] == aSource) {
      return i;
    }
  }

  return -1;
};

/**
 * Create a BasicSourceMapConsumer from a SourceMapGenerator.
 *
 * @param SourceMapGenerator aSourceMap
 *        The source map that will be consumed.
 * @param String aSourceMapURL
 *        The URL at which the source map can be found (optional)
 * @returns BasicSourceMapConsumer
 */
BasicSourceMapConsumer.fromSourceMap = function SourceMapConsumer_fromSourceMap(
  aSourceMap,
  aSourceMapURL
) {
  var smc = Object.create(BasicSourceMapConsumer.prototype);

  var names = (smc._names = ArraySet.fromArray(
    aSourceMap._names.toArray(),
    true
  ));
  var sources = (smc._sources = ArraySet.fromArray(
    aSourceMap._sources.toArray(),
    true
  ));
  smc.sourceRoot = aSourceMap._sourceRoot;
  smc.sourcesContent = aSourceMap._generateSourcesContent(
    smc._sources.toArray(),
    smc.sourceRoot
  );
  smc.file = aSourceMap._file;
  smc._sourceMapURL = aSourceMapURL;
  smc._absoluteSources = smc._sources.toArray().map(function (s) {
    return util$1.computeSourceURL(smc.sourceRoot, s, aSourceMapURL);
  });

  // Because we are modifying the entries (by converting string sources and
  // names to indices into the sources and names ArraySets), we have to make
  // a copy of the entry or else bad things happen. Shared mutable state
  // strikes again! See github issue #191.

  var generatedMappings = aSourceMap._mappings.toArray().slice();
  var destGeneratedMappings = (smc.__generatedMappings = []);
  var destOriginalMappings = (smc.__originalMappings = []);

  for (var i = 0, length = generatedMappings.length; i < length; i++) {
    var srcMapping = generatedMappings[i];
    var destMapping = new Mapping();
    destMapping.generatedLine = srcMapping.generatedLine;
    destMapping.generatedColumn = srcMapping.generatedColumn;

    if (srcMapping.source) {
      destMapping.source = sources.indexOf(srcMapping.source);
      destMapping.originalLine = srcMapping.originalLine;
      destMapping.originalColumn = srcMapping.originalColumn;

      if (srcMapping.name) {
        destMapping.name = names.indexOf(srcMapping.name);
      }

      destOriginalMappings.push(destMapping);
    }

    destGeneratedMappings.push(destMapping);
  }

  quickSort(smc.__originalMappings, util$1.compareByOriginalPositions);

  return smc;
};

/**
 * The version of the source mapping spec that we are consuming.
 */
BasicSourceMapConsumer.prototype._version = 3;

/**
 * The list of original sources.
 */
Object.defineProperty(BasicSourceMapConsumer.prototype, 'sources', {
  get: function () {
    return this._absoluteSources.slice();
  },
});

/**
 * Provide the JIT with a nice shape / hidden class.
 */
function Mapping() {
  this.generatedLine = 0;
  this.generatedColumn = 0;
  this.source = null;
  this.originalLine = null;
  this.originalColumn = null;
  this.name = null;
}

/**
 * Parse the mappings in a string in to a data structure which we can easily
 * query (the ordered arrays in the `this.__generatedMappings` and
 * `this.__originalMappings` properties).
 */
BasicSourceMapConsumer.prototype._parseMappings =
  function SourceMapConsumer_parseMappings(aStr, aSourceRoot) {
    var generatedLine = 1;
    var previousGeneratedColumn = 0;
    var previousOriginalLine = 0;
    var previousOriginalColumn = 0;
    var previousSource = 0;
    var previousName = 0;
    var length = aStr.length;
    var index = 0;
    var cachedSegments = {};
    var temp = {};
    var originalMappings = [];
    var generatedMappings = [];
    var mapping, str, segment, end, value;

    while (index < length) {
      if (aStr.charAt(index) === ';') {
        generatedLine++;
        index++;
        previousGeneratedColumn = 0;
      } else if (aStr.charAt(index) === ',') {
        index++;
      } else {
        mapping = new Mapping();
        mapping.generatedLine = generatedLine;

        // Because each offset is encoded relative to the previous one,
        // many segments often have the same encoding. We can exploit this
        // fact by caching the parsed variable length fields of each segment,
        // allowing us to avoid a second parse if we encounter the same
        // segment again.
        for (end = index; end < length; end++) {
          if (this._charIsMappingSeparator(aStr, end)) {
            break;
          }
        }
        str = aStr.slice(index, end);

        segment = cachedSegments[str];
        if (segment) {
          index += str.length;
        } else {
          segment = [];
          while (index < end) {
            base64VLQ.decode(aStr, index, temp);
            value = temp.value;
            index = temp.rest;
            segment.push(value);
          }

          if (segment.length === 2) {
            throw new Error('Found a source, but no line and column');
          }

          if (segment.length === 3) {
            throw new Error('Found a source and line, but no column');
          }

          cachedSegments[str] = segment;
        }

        // Generated column.
        mapping.generatedColumn = previousGeneratedColumn + segment[0];
        previousGeneratedColumn = mapping.generatedColumn;

        if (segment.length > 1) {
          // Original source.
          mapping.source = previousSource + segment[1];
          previousSource += segment[1];

          // Original line.
          mapping.originalLine = previousOriginalLine + segment[2];
          previousOriginalLine = mapping.originalLine;
          // Lines are stored 0-based
          mapping.originalLine += 1;

          // Original column.
          mapping.originalColumn = previousOriginalColumn + segment[3];
          previousOriginalColumn = mapping.originalColumn;

          if (segment.length > 4) {
            // Original name.
            mapping.name = previousName + segment[4];
            previousName += segment[4];
          }
        }

        generatedMappings.push(mapping);
        if (typeof mapping.originalLine === 'number') {
          originalMappings.push(mapping);
        }
      }
    }

    quickSort(generatedMappings, util$1.compareByGeneratedPositionsDeflated);
    this.__generatedMappings = generatedMappings;

    quickSort(originalMappings, util$1.compareByOriginalPositions);
    this.__originalMappings = originalMappings;
  };

/**
 * Find the mapping that best matches the hypothetical "needle" mapping that
 * we are searching for in the given "haystack" of mappings.
 */
BasicSourceMapConsumer.prototype._findMapping =
  function SourceMapConsumer_findMapping(
    aNeedle,
    aMappings,
    aLineName,
    aColumnName,
    aComparator,
    aBias
  ) {
    // To return the position we are searching for, we must first find the
    // mapping for the given position and then return the opposite position it
    // points to. Because the mappings are sorted, we can use binary search to
    // find the best mapping.

    if (aNeedle[aLineName] <= 0) {
      throw new TypeError(
        'Line must be greater than or equal to 1, got ' + aNeedle[aLineName]
      );
    }
    if (aNeedle[aColumnName] < 0) {
      throw new TypeError(
        'Column must be greater than or equal to 0, got ' + aNeedle[aColumnName]
      );
    }

    return binarySearch.search(aNeedle, aMappings, aComparator, aBias);
  };

/**
 * Compute the last column for each generated mapping. The last column is
 * inclusive.
 */
BasicSourceMapConsumer.prototype.computeColumnSpans =
  function SourceMapConsumer_computeColumnSpans() {
    for (var index = 0; index < this._generatedMappings.length; ++index) {
      var mapping = this._generatedMappings[index];

      // Mappings do not contain a field for the last generated columnt. We
      // can come up with an optimistic estimate, however, by assuming that
      // mappings are contiguous (i.e. given two consecutive mappings, the
      // first mapping ends where the second one starts).
      if (index + 1 < this._generatedMappings.length) {
        var nextMapping = this._generatedMappings[index + 1];

        if (mapping.generatedLine === nextMapping.generatedLine) {
          mapping.lastGeneratedColumn = nextMapping.generatedColumn - 1;
          continue;
        }
      }

      // The last mapping for each line spans the entire line.
      mapping.lastGeneratedColumn = Infinity;
    }
  };

/**
 * Returns the original source, line, and column information for the generated
 * source's line and column positions provided. The only argument is an object
 * with the following properties:
 *
 *   - line: The line number in the generated source.  The line number
 *     is 1-based.
 *   - column: The column number in the generated source.  The column
 *     number is 0-based.
 *   - bias: Either 'SourceMapConsumer.GREATEST_LOWER_BOUND' or
 *     'SourceMapConsumer.LEAST_UPPER_BOUND'. Specifies whether to return the
 *     closest element that is smaller than or greater than the one we are
 *     searching for, respectively, if the exact element cannot be found.
 *     Defaults to 'SourceMapConsumer.GREATEST_LOWER_BOUND'.
 *
 * and an object is returned with the following properties:
 *
 *   - source: The original source file, or null.
 *   - line: The line number in the original source, or null.  The
 *     line number is 1-based.
 *   - column: The column number in the original source, or null.  The
 *     column number is 0-based.
 *   - name: The original identifier, or null.
 */
BasicSourceMapConsumer.prototype.originalPositionFor =
  function SourceMapConsumer_originalPositionFor(aArgs) {
    var needle = {
      generatedLine: util$1.getArg(aArgs, 'line'),
      generatedColumn: util$1.getArg(aArgs, 'column'),
    };

    var index = this._findMapping(
      needle,
      this._generatedMappings,
      'generatedLine',
      'generatedColumn',
      util$1.compareByGeneratedPositionsDeflated,
      util$1.getArg(aArgs, 'bias', SourceMapConsumer$1.GREATEST_LOWER_BOUND)
    );

    if (index >= 0) {
      var mapping = this._generatedMappings[index];

      if (mapping.generatedLine === needle.generatedLine) {
        var source = util$1.getArg(mapping, 'source', null);
        if (source !== null) {
          source = this._sources.at(source);
          source = util$1.computeSourceURL(
            this.sourceRoot,
            source,
            this._sourceMapURL
          );
        }
        var name = util$1.getArg(mapping, 'name', null);
        if (name !== null) {
          name = this._names.at(name);
        }
        return {
          source: source,
          line: util$1.getArg(mapping, 'originalLine', null),
          column: util$1.getArg(mapping, 'originalColumn', null),
          name: name,
        };
      }
    }

    return {
      source: null,
      line: null,
      column: null,
      name: null,
    };
  };

/**
 * Return true if we have the source content for every source in the source
 * map, false otherwise.
 */
BasicSourceMapConsumer.prototype.hasContentsOfAllSources =
  function BasicSourceMapConsumer_hasContentsOfAllSources() {
    if (!this.sourcesContent) {
      return false;
    }
    return (
      this.sourcesContent.length >= this._sources.size() &&
      !this.sourcesContent.some(function (sc) {
        return sc == null;
      })
    );
  };

/**
 * Returns the original source content. The only argument is the url of the
 * original source file. Returns null if no original source content is
 * available.
 */
BasicSourceMapConsumer.prototype.sourceContentFor =
  function SourceMapConsumer_sourceContentFor(aSource, nullOnMissing) {
    if (!this.sourcesContent) {
      return null;
    }

    var index = this._findSourceIndex(aSource);
    if (index >= 0) {
      return this.sourcesContent[index];
    }

    var relativeSource = aSource;
    if (this.sourceRoot != null) {
      relativeSource = util$1.relative(this.sourceRoot, relativeSource);
    }

    var url;
    if (this.sourceRoot != null && (url = util$1.urlParse(this.sourceRoot))) {
      // XXX: file:// URIs and absolute paths lead to unexpected behavior for
      // many users. We can help them out when they expect file:// URIs to
      // behave like it would if they were running a local HTTP server. See
      // https://bugzilla.mozilla.org/show_bug.cgi?id=885597.
      var fileUriAbsPath = relativeSource.replace(/^file:\/\//, '');
      if (url.scheme == 'file' && this._sources.has(fileUriAbsPath)) {
        return this.sourcesContent[this._sources.indexOf(fileUriAbsPath)];
      }

      if (
        (!url.path || url.path == '/') &&
        this._sources.has('/' + relativeSource)
      ) {
        return this.sourcesContent[this._sources.indexOf('/' + relativeSource)];
      }
    }

    // This function is used recursively from
    // IndexedSourceMapConsumer.prototype.sourceContentFor. In that case, we
    // don't want to throw if we can't find the source - we just want to
    // return null, so we provide a flag to exit gracefully.
    if (nullOnMissing) {
      return null;
    } else {
      throw new Error('"' + relativeSource + '" is not in the SourceMap.');
    }
  };

/**
 * Returns the generated line and column information for the original source,
 * line, and column positions provided. The only argument is an object with
 * the following properties:
 *
 *   - source: The filename of the original source.
 *   - line: The line number in the original source.  The line number
 *     is 1-based.
 *   - column: The column number in the original source.  The column
 *     number is 0-based.
 *   - bias: Either 'SourceMapConsumer.GREATEST_LOWER_BOUND' or
 *     'SourceMapConsumer.LEAST_UPPER_BOUND'. Specifies whether to return the
 *     closest element that is smaller than or greater than the one we are
 *     searching for, respectively, if the exact element cannot be found.
 *     Defaults to 'SourceMapConsumer.GREATEST_LOWER_BOUND'.
 *
 * and an object is returned with the following properties:
 *
 *   - line: The line number in the generated source, or null.  The
 *     line number is 1-based.
 *   - column: The column number in the generated source, or null.
 *     The column number is 0-based.
 */
BasicSourceMapConsumer.prototype.generatedPositionFor =
  function SourceMapConsumer_generatedPositionFor(aArgs) {
    var source = util$1.getArg(aArgs, 'source');
    source = this._findSourceIndex(source);
    if (source < 0) {
      return {
        line: null,
        column: null,
        lastColumn: null,
      };
    }

    var needle = {
      source: source,
      originalLine: util$1.getArg(aArgs, 'line'),
      originalColumn: util$1.getArg(aArgs, 'column'),
    };

    var index = this._findMapping(
      needle,
      this._originalMappings,
      'originalLine',
      'originalColumn',
      util$1.compareByOriginalPositions,
      util$1.getArg(aArgs, 'bias', SourceMapConsumer$1.GREATEST_LOWER_BOUND)
    );

    if (index >= 0) {
      var mapping = this._originalMappings[index];

      if (mapping.source === needle.source) {
        return {
          line: util$1.getArg(mapping, 'generatedLine', null),
          column: util$1.getArg(mapping, 'generatedColumn', null),
          lastColumn: util$1.getArg(mapping, 'lastGeneratedColumn', null),
        };
      }
    }

    return {
      line: null,
      column: null,
      lastColumn: null,
    };
  };

sourceMapConsumer.BasicSourceMapConsumer = BasicSourceMapConsumer;

/**
 * An IndexedSourceMapConsumer instance represents a parsed source map which
 * we can query for information. It differs from BasicSourceMapConsumer in
 * that it takes "indexed" source maps (i.e. ones with a "sections" field) as
 * input.
 *
 * The first parameter is a raw source map (either as a JSON string, or already
 * parsed to an object). According to the spec for indexed source maps, they
 * have the following attributes:
 *
 *   - version: Which version of the source map spec this map is following.
 *   - file: Optional. The generated file this source map is associated with.
 *   - sections: A list of section definitions.
 *
 * Each value under the "sections" field has two fields:
 *   - offset: The offset into the original specified at which this section
 *       begins to apply, defined as an object with a "line" and "column"
 *       field.
 *   - map: A source map definition. This source map could also be indexed,
 *       but doesn't have to be.
 *
 * Instead of the "map" field, it's also possible to have a "url" field
 * specifying a URL to retrieve a source map from, but that's currently
 * unsupported.
 *
 * Here's an example source map, taken from the source map spec[0], but
 * modified to omit a section which uses the "url" field.
 *
 *  {
 *    version : 3,
 *    file: "app.js",
 *    sections: [{
 *      offset: {line:100, column:10},
 *      map: {
 *        version : 3,
 *        file: "section.js",
 *        sources: ["foo.js", "bar.js"],
 *        names: ["src", "maps", "are", "fun"],
 *        mappings: "AAAA,E;;ABCDE;"
 *      }
 *    }],
 *  }
 *
 * The second parameter, if given, is a string whose value is the URL
 * at which the source map was found.  This URL is used to compute the
 * sources array.
 *
 * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit#heading=h.535es3xeprgt
 */
function IndexedSourceMapConsumer(aSourceMap, aSourceMapURL) {
  var sourceMap = aSourceMap;
  if (typeof aSourceMap === 'string') {
    sourceMap = util$1.parseSourceMapInput(aSourceMap);
  }

  var version = util$1.getArg(sourceMap, 'version');
  var sections = util$1.getArg(sourceMap, 'sections');

  if (version != this._version) {
    throw new Error('Unsupported version: ' + version);
  }

  this._sources = new ArraySet();
  this._names = new ArraySet();

  var lastOffset = {
    line: -1,
    column: 0,
  };
  this._sections = sections.map(function (s) {
    if (s.url) {
      // The url field will require support for asynchronicity.
      // See https://github.com/mozilla/source-map/issues/16
      throw new Error('Support for url field in sections not implemented.');
    }
    var offset = util$1.getArg(s, 'offset');
    var offsetLine = util$1.getArg(offset, 'line');
    var offsetColumn = util$1.getArg(offset, 'column');

    if (
      offsetLine < lastOffset.line ||
      (offsetLine === lastOffset.line && offsetColumn < lastOffset.column)
    ) {
      throw new Error('Section offsets must be ordered and non-overlapping.');
    }
    lastOffset = offset;

    return {
      generatedOffset: {
        // The offset fields are 0-based, but we use 1-based indices when
        // encoding/decoding from VLQ.
        generatedLine: offsetLine + 1,
        generatedColumn: offsetColumn + 1,
      },
      consumer: new SourceMapConsumer$1(util$1.getArg(s, 'map'), aSourceMapURL),
    };
  });
}

IndexedSourceMapConsumer.prototype = Object.create(
  SourceMapConsumer$1.prototype
);
IndexedSourceMapConsumer.prototype.constructor = SourceMapConsumer$1;

/**
 * The version of the source mapping spec that we are consuming.
 */
IndexedSourceMapConsumer.prototype._version = 3;

/**
 * The list of original sources.
 */
Object.defineProperty(IndexedSourceMapConsumer.prototype, 'sources', {
  get: function () {
    var sources = [];
    for (var i = 0; i < this._sections.length; i++) {
      for (var j = 0; j < this._sections[i].consumer.sources.length; j++) {
        sources.push(this._sections[i].consumer.sources[j]);
      }
    }
    return sources;
  },
});

/**
 * Returns the original source, line, and column information for the generated
 * source's line and column positions provided. The only argument is an object
 * with the following properties:
 *
 *   - line: The line number in the generated source.  The line number
 *     is 1-based.
 *   - column: The column number in the generated source.  The column
 *     number is 0-based.
 *
 * and an object is returned with the following properties:
 *
 *   - source: The original source file, or null.
 *   - line: The line number in the original source, or null.  The
 *     line number is 1-based.
 *   - column: The column number in the original source, or null.  The
 *     column number is 0-based.
 *   - name: The original identifier, or null.
 */
IndexedSourceMapConsumer.prototype.originalPositionFor =
  function IndexedSourceMapConsumer_originalPositionFor(aArgs) {
    var needle = {
      generatedLine: util$1.getArg(aArgs, 'line'),
      generatedColumn: util$1.getArg(aArgs, 'column'),
    };

    // Find the section containing the generated position we're trying to map
    // to an original position.
    var sectionIndex = binarySearch.search(
      needle,
      this._sections,
      function (needle, section) {
        var cmp = needle.generatedLine - section.generatedOffset.generatedLine;
        if (cmp) {
          return cmp;
        }

        return needle.generatedColumn - section.generatedOffset.generatedColumn;
      }
    );
    var section = this._sections[sectionIndex];

    if (!section) {
      return {
        source: null,
        line: null,
        column: null,
        name: null,
      };
    }

    return section.consumer.originalPositionFor({
      line: needle.generatedLine - (section.generatedOffset.generatedLine - 1),
      column:
        needle.generatedColumn -
        (section.generatedOffset.generatedLine === needle.generatedLine
          ? section.generatedOffset.generatedColumn - 1
          : 0),
      bias: aArgs.bias,
    });
  };

/**
 * Return true if we have the source content for every source in the source
 * map, false otherwise.
 */
IndexedSourceMapConsumer.prototype.hasContentsOfAllSources =
  function IndexedSourceMapConsumer_hasContentsOfAllSources() {
    return this._sections.every(function (s) {
      return s.consumer.hasContentsOfAllSources();
    });
  };

/**
 * Returns the original source content. The only argument is the url of the
 * original source file. Returns null if no original source content is
 * available.
 */
IndexedSourceMapConsumer.prototype.sourceContentFor =
  function IndexedSourceMapConsumer_sourceContentFor(aSource, nullOnMissing) {
    for (var i = 0; i < this._sections.length; i++) {
      var section = this._sections[i];

      var content = section.consumer.sourceContentFor(aSource, true);
      if (content) {
        return content;
      }
    }
    if (nullOnMissing) {
      return null;
    } else {
      throw new Error('"' + aSource + '" is not in the SourceMap.');
    }
  };

/**
 * Returns the generated line and column information for the original source,
 * line, and column positions provided. The only argument is an object with
 * the following properties:
 *
 *   - source: The filename of the original source.
 *   - line: The line number in the original source.  The line number
 *     is 1-based.
 *   - column: The column number in the original source.  The column
 *     number is 0-based.
 *
 * and an object is returned with the following properties:
 *
 *   - line: The line number in the generated source, or null.  The
 *     line number is 1-based.
 *   - column: The column number in the generated source, or null.
 *     The column number is 0-based.
 */
IndexedSourceMapConsumer.prototype.generatedPositionFor =
  function IndexedSourceMapConsumer_generatedPositionFor(aArgs) {
    for (var i = 0; i < this._sections.length; i++) {
      var section = this._sections[i];

      // Only consider this section if the requested source is in the list of
      // sources of the consumer.
      if (
        section.consumer._findSourceIndex(util$1.getArg(aArgs, 'source')) === -1
      ) {
        continue;
      }
      var generatedPosition = section.consumer.generatedPositionFor(aArgs);
      if (generatedPosition) {
        var ret = {
          line:
            generatedPosition.line +
            (section.generatedOffset.generatedLine - 1),
          column:
            generatedPosition.column +
            (section.generatedOffset.generatedLine === generatedPosition.line
              ? section.generatedOffset.generatedColumn - 1
              : 0),
        };
        return ret;
      }
    }

    return {
      line: null,
      column: null,
    };
  };

/**
 * Parse the mappings in a string in to a data structure which we can easily
 * query (the ordered arrays in the `this.__generatedMappings` and
 * `this.__originalMappings` properties).
 */
IndexedSourceMapConsumer.prototype._parseMappings =
  function IndexedSourceMapConsumer_parseMappings(aStr, aSourceRoot) {
    this.__generatedMappings = [];
    this.__originalMappings = [];
    for (var i = 0; i < this._sections.length; i++) {
      var section = this._sections[i];
      var sectionMappings = section.consumer._generatedMappings;
      for (var j = 0; j < sectionMappings.length; j++) {
        var mapping = sectionMappings[j];

        var source = section.consumer._sources.at(mapping.source);
        source = util$1.computeSourceURL(
          section.consumer.sourceRoot,
          source,
          this._sourceMapURL
        );
        this._sources.add(source);
        source = this._sources.indexOf(source);

        var name = null;
        if (mapping.name) {
          name = section.consumer._names.at(mapping.name);
          this._names.add(name);
          name = this._names.indexOf(name);
        }

        // The mappings coming from the consumer for the section have
        // generated positions relative to the start of the section, so we
        // need to offset them to be relative to the start of the concatenated
        // generated file.
        var adjustedMapping = {
          source: source,
          generatedLine:
            mapping.generatedLine + (section.generatedOffset.generatedLine - 1),
          generatedColumn:
            mapping.generatedColumn +
            (section.generatedOffset.generatedLine === mapping.generatedLine
              ? section.generatedOffset.generatedColumn - 1
              : 0),
          originalLine: mapping.originalLine,
          originalColumn: mapping.originalColumn,
          name: name,
        };

        this.__generatedMappings.push(adjustedMapping);
        if (typeof adjustedMapping.originalLine === 'number') {
          this.__originalMappings.push(adjustedMapping);
        }
      }
    }

    quickSort(
      this.__generatedMappings,
      util$1.compareByGeneratedPositionsDeflated
    );
    quickSort(this.__originalMappings, util$1.compareByOriginalPositions);
  };

sourceMapConsumer.IndexedSourceMapConsumer = IndexedSourceMapConsumer;

var sourceNode = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

var SourceMapGenerator = sourceMapGenerator.SourceMapGenerator;
var util = util$5;

// Matches a Windows-style `\r\n` newline or a `\n` newline used by all other
// operating systems these days (capturing the result).
var REGEX_NEWLINE = /(\r?\n)/;

// Newline character code for charCodeAt() comparisons
var NEWLINE_CODE = 10;

// Private symbol for identifying `SourceNode`s when multiple versions of
// the source-map library are loaded. This MUST NOT CHANGE across
// versions!
var isSourceNode = '$$$isSourceNode$$$';

/**
 * SourceNodes provide a way to abstract over interpolating/concatenating
 * snippets of generated JavaScript source code while maintaining the line and
 * column information associated with the original source code.
 *
 * @param aLine The original line number.
 * @param aColumn The original column number.
 * @param aSource The original source's filename.
 * @param aChunks Optional. An array of strings which are snippets of
 *        generated JS, or other SourceNodes.
 * @param aName The original identifier.
 */
function SourceNode(aLine, aColumn, aSource, aChunks, aName) {
  this.children = [];
  this.sourceContents = {};
  this.line = aLine == null ? null : aLine;
  this.column = aColumn == null ? null : aColumn;
  this.source = aSource == null ? null : aSource;
  this.name = aName == null ? null : aName;
  this[isSourceNode] = true;
  if (aChunks != null) this.add(aChunks);
}

/**
 * Creates a SourceNode from generated code and a SourceMapConsumer.
 *
 * @param aGeneratedCode The generated code
 * @param aSourceMapConsumer The SourceMap for the generated code
 * @param aRelativePath Optional. The path that relative sources in the
 *        SourceMapConsumer should be relative to.
 */
SourceNode.fromStringWithSourceMap =
  function SourceNode_fromStringWithSourceMap(
    aGeneratedCode,
    aSourceMapConsumer,
    aRelativePath
  ) {
    // The SourceNode we want to fill with the generated code
    // and the SourceMap
    var node = new SourceNode();

    // All even indices of this array are one line of the generated code,
    // while all odd indices are the newlines between two adjacent lines
    // (since `REGEX_NEWLINE` captures its match).
    // Processed fragments are accessed by calling `shiftNextLine`.
    var remainingLines = aGeneratedCode.split(REGEX_NEWLINE);
    var remainingLinesIndex = 0;
    var shiftNextLine = function () {
      var lineContents = getNextLine();
      // The last line of a file might not have a newline.
      var newLine = getNextLine() || '';
      return lineContents + newLine;

      function getNextLine() {
        return remainingLinesIndex < remainingLines.length
          ? remainingLines[remainingLinesIndex++]
          : undefined;
      }
    };

    // We need to remember the position of "remainingLines"
    var lastGeneratedLine = 1,
      lastGeneratedColumn = 0;

    // The generate SourceNodes we need a code range.
    // To extract it current and last mapping is used.
    // Here we store the last mapping.
    var lastMapping = null;

    aSourceMapConsumer.eachMapping(function (mapping) {
      if (lastMapping !== null) {
        // We add the code from "lastMapping" to "mapping":
        // First check if there is a new line in between.
        if (lastGeneratedLine < mapping.generatedLine) {
          // Associate first line with "lastMapping"
          addMappingWithCode(lastMapping, shiftNextLine());
          lastGeneratedLine++;
          lastGeneratedColumn = 0;
          // The remaining code is added without mapping
        } else {
          // There is no new line in between.
          // Associate the code between "lastGeneratedColumn" and
          // "mapping.generatedColumn" with "lastMapping"
          var nextLine = remainingLines[remainingLinesIndex] || '';
          var code = nextLine.substr(
            0,
            mapping.generatedColumn - lastGeneratedColumn
          );
          remainingLines[remainingLinesIndex] = nextLine.substr(
            mapping.generatedColumn - lastGeneratedColumn
          );
          lastGeneratedColumn = mapping.generatedColumn;
          addMappingWithCode(lastMapping, code);
          // No more remaining code, continue
          lastMapping = mapping;
          return;
        }
      }
      // We add the generated code until the first mapping
      // to the SourceNode without any mapping.
      // Each line is added as separate string.
      while (lastGeneratedLine < mapping.generatedLine) {
        node.add(shiftNextLine());
        lastGeneratedLine++;
      }
      if (lastGeneratedColumn < mapping.generatedColumn) {
        var nextLine = remainingLines[remainingLinesIndex] || '';
        node.add(nextLine.substr(0, mapping.generatedColumn));
        remainingLines[remainingLinesIndex] = nextLine.substr(
          mapping.generatedColumn
        );
        lastGeneratedColumn = mapping.generatedColumn;
      }
      lastMapping = mapping;
    }, this);
    // We have processed all mappings.
    if (remainingLinesIndex < remainingLines.length) {
      if (lastMapping) {
        // Associate the remaining code in the current line with "lastMapping"
        addMappingWithCode(lastMapping, shiftNextLine());
      }
      // and add the remaining lines without any mapping
      node.add(remainingLines.splice(remainingLinesIndex).join(''));
    }

    // Copy sourcesContent into SourceNode
    aSourceMapConsumer.sources.forEach(function (sourceFile) {
      var content = aSourceMapConsumer.sourceContentFor(sourceFile);
      if (content != null) {
        if (aRelativePath != null) {
          sourceFile = util.join(aRelativePath, sourceFile);
        }
        node.setSourceContent(sourceFile, content);
      }
    });

    return node;

    function addMappingWithCode(mapping, code) {
      if (mapping === null || mapping.source === undefined) {
        node.add(code);
      } else {
        var source = aRelativePath
          ? util.join(aRelativePath, mapping.source)
          : mapping.source;
        node.add(
          new SourceNode(
            mapping.originalLine,
            mapping.originalColumn,
            source,
            code,
            mapping.name
          )
        );
      }
    }
  };

/**
 * Add a chunk of generated JS to this source node.
 *
 * @param aChunk A string snippet of generated JS code, another instance of
 *        SourceNode, or an array where each member is one of those things.
 */
SourceNode.prototype.add = function SourceNode_add(aChunk) {
  if (Array.isArray(aChunk)) {
    aChunk.forEach(function (chunk) {
      this.add(chunk);
    }, this);
  } else if (aChunk[isSourceNode] || typeof aChunk === 'string') {
    if (aChunk) {
      this.children.push(aChunk);
    }
  } else {
    throw new TypeError(
      'Expected a SourceNode, string, or an array of SourceNodes and strings. Got ' +
        aChunk
    );
  }
  return this;
};

/**
 * Add a chunk of generated JS to the beginning of this source node.
 *
 * @param aChunk A string snippet of generated JS code, another instance of
 *        SourceNode, or an array where each member is one of those things.
 */
SourceNode.prototype.prepend = function SourceNode_prepend(aChunk) {
  if (Array.isArray(aChunk)) {
    for (var i = aChunk.length - 1; i >= 0; i--) {
      this.prepend(aChunk[i]);
    }
  } else if (aChunk[isSourceNode] || typeof aChunk === 'string') {
    this.children.unshift(aChunk);
  } else {
    throw new TypeError(
      'Expected a SourceNode, string, or an array of SourceNodes and strings. Got ' +
        aChunk
    );
  }
  return this;
};

/**
 * Walk over the tree of JS snippets in this node and its children. The
 * walking function is called once for each snippet of JS and is passed that
 * snippet and the its original associated source's line/column location.
 *
 * @param aFn The traversal function.
 */
SourceNode.prototype.walk = function SourceNode_walk(aFn) {
  var chunk;
  for (var i = 0, len = this.children.length; i < len; i++) {
    chunk = this.children[i];
    if (chunk[isSourceNode]) {
      chunk.walk(aFn);
    } else {
      if (chunk !== '') {
        aFn(chunk, {
          source: this.source,
          line: this.line,
          column: this.column,
          name: this.name,
        });
      }
    }
  }
};

/**
 * Like `String.prototype.join` except for SourceNodes. Inserts `aStr` between
 * each of `this.children`.
 *
 * @param aSep The separator.
 */
SourceNode.prototype.join = function SourceNode_join(aSep) {
  var newChildren;
  var i;
  var len = this.children.length;
  if (len > 0) {
    newChildren = [];
    for (i = 0; i < len - 1; i++) {
      newChildren.push(this.children[i]);
      newChildren.push(aSep);
    }
    newChildren.push(this.children[i]);
    this.children = newChildren;
  }
  return this;
};

/**
 * Call String.prototype.replace on the very right-most source snippet. Useful
 * for trimming whitespace from the end of a source node, etc.
 *
 * @param aPattern The pattern to replace.
 * @param aReplacement The thing to replace the pattern with.
 */
SourceNode.prototype.replaceRight = function SourceNode_replaceRight(
  aPattern,
  aReplacement
) {
  var lastChild = this.children[this.children.length - 1];
  if (lastChild[isSourceNode]) {
    lastChild.replaceRight(aPattern, aReplacement);
  } else if (typeof lastChild === 'string') {
    this.children[this.children.length - 1] = lastChild.replace(
      aPattern,
      aReplacement
    );
  } else {
    this.children.push(''.replace(aPattern, aReplacement));
  }
  return this;
};

/**
 * Set the source content for a source file. This will be added to the SourceMapGenerator
 * in the sourcesContent field.
 *
 * @param aSourceFile The filename of the source file
 * @param aSourceContent The content of the source file
 */
SourceNode.prototype.setSourceContent = function SourceNode_setSourceContent(
  aSourceFile,
  aSourceContent
) {
  this.sourceContents[util.toSetString(aSourceFile)] = aSourceContent;
};

/**
 * Walk over the tree of SourceNodes. The walking function is called for each
 * source file content and is passed the filename and source content.
 *
 * @param aFn The traversal function.
 */
SourceNode.prototype.walkSourceContents =
  function SourceNode_walkSourceContents(aFn) {
    for (var i = 0, len = this.children.length; i < len; i++) {
      if (this.children[i][isSourceNode]) {
        this.children[i].walkSourceContents(aFn);
      }
    }

    var sources = Object.keys(this.sourceContents);
    for (var i = 0, len = sources.length; i < len; i++) {
      aFn(util.fromSetString(sources[i]), this.sourceContents[sources[i]]);
    }
  };

/**
 * Return the string representation of this source node. Walks over the tree
 * and concatenates all the various snippets together to one string.
 */
SourceNode.prototype.toString = function SourceNode_toString() {
  var str = '';
  this.walk(function (chunk) {
    str += chunk;
  });
  return str;
};

/**
 * Returns the string representation of this source node along with a source
 * map.
 */
SourceNode.prototype.toStringWithSourceMap =
  function SourceNode_toStringWithSourceMap(aArgs) {
    var generated = {
      code: '',
      line: 1,
      column: 0,
    };
    var map = new SourceMapGenerator(aArgs);
    var sourceMappingActive = false;
    var lastOriginalSource = null;
    var lastOriginalLine = null;
    var lastOriginalColumn = null;
    var lastOriginalName = null;
    this.walk(function (chunk, original) {
      generated.code += chunk;
      if (
        original.source !== null &&
        original.line !== null &&
        original.column !== null
      ) {
        if (
          lastOriginalSource !== original.source ||
          lastOriginalLine !== original.line ||
          lastOriginalColumn !== original.column ||
          lastOriginalName !== original.name
        ) {
          map.addMapping({
            source: original.source,
            original: {
              line: original.line,
              column: original.column,
            },
            generated: {
              line: generated.line,
              column: generated.column,
            },
            name: original.name,
          });
        }
        lastOriginalSource = original.source;
        lastOriginalLine = original.line;
        lastOriginalColumn = original.column;
        lastOriginalName = original.name;
        sourceMappingActive = true;
      } else if (sourceMappingActive) {
        map.addMapping({
          generated: {
            line: generated.line,
            column: generated.column,
          },
        });
        lastOriginalSource = null;
        sourceMappingActive = false;
      }
      for (var idx = 0, length = chunk.length; idx < length; idx++) {
        if (chunk.charCodeAt(idx) === NEWLINE_CODE) {
          generated.line++;
          generated.column = 0;
          // Mappings end at eol
          if (idx + 1 === length) {
            lastOriginalSource = null;
            sourceMappingActive = false;
          } else if (sourceMappingActive) {
            map.addMapping({
              source: original.source,
              original: {
                line: original.line,
                column: original.column,
              },
              generated: {
                line: generated.line,
                column: generated.column,
              },
              name: original.name,
            });
          }
        } else {
          generated.column++;
        }
      }
    });
    this.walkSourceContents(function (sourceFile, sourceContent) {
      map.setSourceContent(sourceFile, sourceContent);
    });

    return { code: generated.code, map: map };
  };

sourceNode.SourceNode = SourceNode;

/*
 * Copyright 2009-2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE.txt or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

sourceMap.SourceMapGenerator = sourceMapGenerator.SourceMapGenerator;
sourceMap.SourceMapConsumer = sourceMapConsumer.SourceMapConsumer;
sourceMap.SourceNode = sourceNode.SourceNode;

/*  ------------------------------------------------------------------------ */

var SyncPromise_1 = class SyncPromise {
  constructor(fn) {
    try {
      fn(
        (x) => {
          this.setValue(x, false);
        }, // resolve
        (x) => {
          this.setValue(x, true);
        } // reject
      );
    } catch (e) {
      this.setValue(e, true);
    }
  }

  setValue(x, rejected) {
    this.val = x instanceof SyncPromise ? x.val : x;
    this.rejected = rejected || (x instanceof SyncPromise ? x.rejected : false);
  }

  static valueFrom(x) {
    if (x instanceof SyncPromise) {
      if (x.rejected) throw x.val;
      else return x.val;
    } else {
      return x;
    }
  }

  then(fn) {
    try {
      if (!this.rejected) return SyncPromise.resolve(fn(this.val));
    } catch (e) {
      return SyncPromise.reject(e);
    }
    return this;
  }

  catch(fn) {
    try {
      if (this.rejected) return SyncPromise.resolve(fn(this.val));
    } catch (e) {
      return SyncPromise.reject(e);
    }
    return this;
  }

  static resolve(x) {
    return new SyncPromise((resolve) => {
      resolve(x);
    });
  }

  static reject(x) {
    return new SyncPromise((_, reject) => {
      reject(x);
    });
  }
};

var path$2 = { exports: {} };

/*  ------------------------------------------------------------------------ */

const isBrowser$2 =
  typeof window !== 'undefined' && window.window === window && window.navigator;
const cwd = isBrowser$2 ? window.location.href : process.cwd();

const urlRegexp = new RegExp(
  '^((https|http)://)?[a-z0-9A-Z]{3}.[a-z0-9A-Z][a-z0-9A-Z]{0,61}?[a-z0-9A-Z].com|net|cn|cc (:s[0-9]{1-4})?/$'
);

/*  ------------------------------------------------------------------------ */

const path$1 = (path$2.exports = {
  concat(a, b) {
    const a_endsWithSlash = a[a.length - 1] === '/',
      b_startsWithSlash = b[0] === '/';

    return (
      a +
      (a_endsWithSlash || b_startsWithSlash ? '' : '/') +
      (a_endsWithSlash && b_startsWithSlash ? b.substring(1) : b)
    );
  },

  resolve(x) {
    if (path$1.isAbsolute(x)) {
      return path$1.normalize(x);
    }

    return path$1.normalize(path$1.concat(cwd, x));
  },

  normalize(x) {
    let output = [],
      skip = 0;

    x.split('/')
      .reverse()
      .filter((x) => x !== '.')
      .forEach((x) => {
        if (x === '..') {
          skip++;
        } else if (skip === 0) {
          output.push(x);
        } else {
          skip--;
        }
      });

    const result = output.reverse().join('/');

    return (
      (isBrowser$2 && result[0] === '/'
        ? result[1] === '/'
          ? window.location.protocol
          : window.location.origin
        : '') + result
    );
  },

  isData: (x) => x.indexOf('data:') === 0,

  isURL: (x) => urlRegexp.test(x),

  isAbsolute: (x) => x[0] === '/' || /^[^\/]*:/.test(x),

  relativeToFile(a, b) {
    return path$1.isData(a) || path$1.isAbsolute(b)
      ? path$1.normalize(b)
      : path$1.normalize(path$1.concat(a.split('/').slice(0, -1).join('/'), b));
  },
});

/**
 * Module exports.
 */

var dataUriToBuffer_1 = dataUriToBuffer;

/**
 * Returns a `Buffer` instance from the given data URI `uri`.
 *
 * @param {String} uri Data URI to turn into a Buffer instance
 * @return {Buffer} Buffer instance from Data URI
 * @api public
 */

function dataUriToBuffer(uri) {
  if (!/^data\:/i.test(uri)) {
    throw new TypeError(
      '`uri` does not appear to be a Data URI (must begin with "data:")'
    );
  }

  // strip newlines
  uri = uri.replace(/\r?\n/g, '');

  // split the URI up into the "metadata" and the "data" portions
  var firstComma = uri.indexOf(',');
  if (-1 === firstComma || firstComma <= 4) {
    throw new TypeError('malformed data: URI');
  }

  // remove the "data:" scheme and parse the metadata
  var meta = uri.substring(5, firstComma).split(';');

  var type = meta[0] || 'text/plain';
  var typeFull = type;
  var base64 = false;
  var charset = '';
  for (var i = 1; i < meta.length; i++) {
    if ('base64' == meta[i]) {
      base64 = true;
    } else {
      typeFull += ';' + meta[i];
      if (0 == meta[i].indexOf('charset=')) {
        charset = meta[i].substring(8);
      }
    }
  }
  // defaults to US-ASCII only if type is not provided
  if (!meta[0] && !charset.length) {
    typeFull += ';charset=US-ASCII';
    charset = 'US-ASCII';
  }

  // get the encoded data portion and decode URI-encoded chars
  var data = unescape(uri.substring(firstComma + 1));

  var encoding = base64 ? 'base64' : 'ascii';
  var buffer = Buffer.from
    ? Buffer.from(data, encoding)
    : new Buffer(data, encoding);

  // set `.type` and `.typeFull` properties to MIME type
  buffer.type = type;
  buffer.typeFull = typeFull;

  // set the `.charset` property
  buffer.charset = charset;

  return buffer;
}

/*  ------------------------------------------------------------------------ */

const { assign } = Object,
  isBrowser$1 =
    typeof window !== 'undefined' &&
    window.window === window &&
    window.navigator,
  SourceMapConsumer = sourceMap.SourceMapConsumer,
  SyncPromise = SyncPromise_1,
  path = path$2.exports,
  dataURIToBuffer = dataUriToBuffer_1,
  nodeRequire$1 = isBrowser$1 ? null : commonjsRequire;

/*  ------------------------------------------------------------------------ */

const memoize = (f) => {
  const m = (x) => (x in m.cache ? m.cache[x] : (m.cache[x] = f(x)));
  m.forgetEverything = () => {
    m.cache = Object.create(null);
  };
  m.cache = Object.create(null);

  return m;
};

function impl(fetchFile, sync) {
  const PromiseImpl = sync ? SyncPromise : Promise;
  const SourceFileMemoized = memoize((path) =>
    SourceFile(path, fetchFile(path))
  );

  function SourceFile(srcPath, text) {
    if (text === undefined) return SourceFileMemoized(path.resolve(srcPath));

    return PromiseImpl.resolve(text).then((text) => {
      let file;
      let lines;
      let resolver;
      let _resolve = (loc) =>
        (resolver = resolver || SourceMapResolverFromFetchedFile(file))(loc);

      return (file = {
        path: srcPath,
        text,
        get lines() {
          return (lines = lines || text.split('\n'));
        },
        resolve(loc) {
          const result = _resolve(loc);
          if (sync) {
            try {
              return SyncPromise.valueFrom(result);
            } catch (e) {
              return assign({}, loc, { error: e });
            }
          } else {
            return Promise.resolve(result);
          }
        },
        _resolve,
      });
    });
  }

  function SourceMapResolverFromFetchedFile(file) {
    /*  Extract the last sourceMap occurence (TODO: support multiple sourcemaps)   */

    const re = /\u0023 sourceMappingURL=(.+)\n?/g;
    let lastMatch = undefined;

    while (true) {
      const match = re.exec(file.text);
      if (match) lastMatch = match;
      else break;
    }

    const url = lastMatch && lastMatch[1];

    const defaultResolver = (loc) =>
      assign({}, loc, {
        sourceFile: file,
        sourceLine: file.lines[loc.line - 1] || '',
      });

    return url
      ? SourceMapResolver(file.path, url, defaultResolver)
      : defaultResolver;
  }

  function SourceMapResolver(originalFilePath, sourceMapPath, fallbackResolve) {
    const srcFile = sourceMapPath.startsWith('data:')
      ? SourceFile(originalFilePath, dataURIToBuffer(sourceMapPath).toString())
      : SourceFile(path.relativeToFile(originalFilePath, sourceMapPath));

    const parsedMap = srcFile.then((f) =>
      SourceMapConsumer(JSON.parse(f.text))
    );

    const sourceFor = memoize(function sourceFor(filePath) {
      return srcFile.then((f) => {
        const fullPath = path.relativeToFile(f.path, filePath);
        return parsedMap.then((x) =>
          SourceFile(
            fullPath,
            x.sourceContentFor(filePath, true /* return null on missing */) ||
              undefined
          )
        );
      });
    });

    return (loc) =>
      parsedMap
        .then((x) => {
          const originalLoc = x.originalPositionFor(loc);
          return originalLoc.source
            ? sourceFor(originalLoc.source).then((x) =>
                x._resolve(
                  assign({}, loc, {
                    line: originalLoc.line,
                    column: originalLoc.column + 1,
                    name: originalLoc.name,
                  })
                )
              )
            : fallbackResolve(loc);
        })
        .catch((e) => assign(fallbackResolve(loc), { sourceMapError: e }));
  }

  return assign(
    function getSource(path) {
      const file = SourceFile(path);
      if (sync) {
        try {
          return SyncPromise.valueFrom(file);
        } catch (e) {
          const noFile = {
            path,
            text: '',
            lines: [],
            error: e,
            resolve(loc) {
              return assign({}, loc, {
                error: e,
                sourceLine: '',
                sourceFile: noFile,
              });
            },
          };
          return noFile;
        }
      }
      return file;
    },
    {
      resetCache: () => SourceFileMemoized.forgetEverything(),
      getCache: () => SourceFileMemoized.cache,
    }
  );
}

/*  ------------------------------------------------------------------------ */

getSource$1.exports = impl(function fetchFileSync(path) {
  return new SyncPromise((resolve) => {
    if (isBrowser$1) {
      let xhr = new XMLHttpRequest();
      xhr.open('GET', path, false /* SYNCHRONOUS XHR FTW :) */);
      xhr.send(null);
      resolve(xhr.responseText);
    } else {
      resolve(nodeRequire$1('fs').readFileSync(path, { encoding: 'utf8' }));
    }
  });
}, true);

/*  ------------------------------------------------------------------------ */

getSource$1.exports.async = impl(function fetchFileAsync(path) {
  return new Promise((resolve, reject) => {
    if (isBrowser$1) {
      let xhr = new XMLHttpRequest();
      xhr.open('GET', path);
      xhr.onreadystatechange = (event) => {
        if (xhr.readyState === 4) {
          if (xhr.status === 200) {
            resolve(xhr.responseText);
          } else {
            reject(new Error(xhr.statusText));
          }
        }
      };
      xhr.send(null);
    } else {
      nodeRequire$1('fs').readFile(path, { encoding: 'utf8' }, (e, x) => {
        e ? reject(e) : resolve(x);
      });
    }
  });
});

var partition$1 = (arr_, pred) => {
  const arr = arr_ || [],
    spans = [];

  let span = { label: undefined, items: [arr.first] };

  arr.forEach((x) => {
    const label = pred(x);

    if (span.label !== label && span.items.length) {
      spans.push((span = { label: label, items: [x] }));
    } else {
      span.items.push(x);
    }
  });

  return spans;
};

var printableCharacters = { exports: {} };

(function (module) {
  var _slicedToArray = (function () {
    function sliceIterator(arr, i) {
      var _arr = [];
      var _n = true;
      var _d = false;
      var _e = undefined;
      try {
        for (
          var _i = arr[Symbol.iterator](), _s;
          !(_n = (_s = _i.next()).done);
          _n = true
        ) {
          _arr.push(_s.value);
          if (i && _arr.length === i) break;
        }
      } catch (err) {
        _d = true;
        _e = err;
      } finally {
        try {
          if (!_n && _i['return']) _i['return']();
        } finally {
          if (_d) throw _e;
        }
      }
      return _arr;
    }
    return function (arr, i) {
      if (Array.isArray(arr)) {
        return arr;
      } else if (Symbol.iterator in Object(arr)) {
        return sliceIterator(arr, i);
      } else {
        throw new TypeError(
          'Invalid attempt to destructure non-iterable instance'
        );
      }
    };
  })();

  const ansiEscapeCode =
      '[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PRZcf-nqry=><]',
    zeroWidthCharacterExceptNewline =
      '\u0000-\u0008\u000B-\u0019\u001b\u009b\u00ad\u200b\u2028\u2029\ufeff\ufe00-\ufe0f',
    zeroWidthCharacter = '\n' + zeroWidthCharacterExceptNewline,
    zeroWidthCharactersExceptNewline = new RegExp(
      '(?:' + ansiEscapeCode + ')|[' + zeroWidthCharacterExceptNewline + ']',
      'g'
    ),
    zeroWidthCharacters = new RegExp(
      '(?:' + ansiEscapeCode + ')|[' + zeroWidthCharacter + ']',
      'g'
    ),
    partition = new RegExp(
      '((?:' +
        ansiEscapeCode +
        ')|[\t' +
        zeroWidthCharacter +
        '])?([^\t' +
        zeroWidthCharacter +
        ']*)',
      'g'
    );

  module.exports = {
    zeroWidthCharacters,

    ansiEscapeCodes: new RegExp(ansiEscapeCode, 'g'),

    strlen: (s) => Array.from(s.replace(zeroWidthCharacters, '')).length, // Array.from solves the emoji problem as described here: http://blog.jonnew.com/posts/poo-dot-length-equals-two

    isBlank: (s) =>
      s.replace(zeroWidthCharacters, '').replace(/\s/g, '').length === 0,

    blank: (s) =>
      Array.from(s.replace(zeroWidthCharactersExceptNewline, '')) // Array.from solves the emoji problem as described here: http://blog.jonnew.com/posts/poo-dot-length-equals-two
        .map((x) => (x === '\t' || x === '\n' ? x : ' '))
        .join(''),

    partition(s) {
      for (
        var m, spans = [];
        partition.lastIndex !== s.length && (m = partition.exec(s));

      ) {
        spans.push([m[1] || '', m[2]]);
      }
      partition.lastIndex = 0; // reset
      return spans;
    },

    first(s, n) {
      let result = '',
        length = 0;

      for (const _ref of module.exports.partition(s)) {
        var _ref2 = _slicedToArray(_ref, 2);

        const nonPrintable = _ref2[0];
        const printable = _ref2[1];

        const text = Array.from(printable).slice(0, n - length); // Array.from solves the emoji problem as described here: http://blog.jonnew.com/posts/poo-dot-length-equals-two
        result += nonPrintable + text.join('');
        length += text.length;
      }

      return result;
    },
  };
})(printableCharacters);

function _toConsumableArray(arr) {
  if (Array.isArray(arr)) {
    for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++)
      arr2[i] = arr[i];
    return arr2;
  } else {
    return Array.from(arr);
  }
}

const O$1 = Object;

var _require = printableCharacters.exports;

const first = _require.first,
  strlen = _require.strlen,
  limit = (s, n) => first(s, n - 1) + '…';

const asColumns = (rows, cfg_) => {
  const zip = (arrs, f) =>
      arrs
        .reduce(
          (a, b) =>
            b.map((b, i) => [].concat(_toConsumableArray(a[i] || []), [b])),
          []
        )
        .map((args) => f.apply(undefined, _toConsumableArray(args))),
    /*  Convert cell data to string (converting multiline text to singleline) */

    cells = rows.map((r) => r.map((c) => c.replace(/\n/g, '\\n'))),
    /*  Compute column widths (per row) and max widths (per column)     */

    cellWidths = cells.map((r) => r.map(strlen)),
    maxWidths = zip(cellWidths, Math.max),
    /*  Default config     */

    cfg = O$1.assign(
      {
        delimiter: '  ',
        minColumnWidths: maxWidths.map((x) => 0),
        maxTotalWidth: 0,
      },
      cfg_
    ),
    delimiterLength = strlen(cfg.delimiter),
    /*  Project desired column widths, taking maxTotalWidth and minColumnWidths in account.     */

    totalWidth = maxWidths.reduce((a, b) => a + b, 0),
    relativeWidths = maxWidths.map((w) => w / totalWidth),
    maxTotalWidth =
      cfg.maxTotalWidth - delimiterLength * (maxWidths.length - 1),
    excessWidth = Math.max(0, totalWidth - maxTotalWidth),
    computedWidths = zip(
      [cfg.minColumnWidths, maxWidths, relativeWidths],
      (min, max, relative) =>
        Math.max(min, Math.floor(max - excessWidth * relative))
    ),
    /*  This is how many symbols we should pad or cut (per column).  */

    restCellWidths = cellWidths.map((widths) =>
      zip([computedWidths, widths], (a, b) => a - b)
    );

  /*  Perform final composition.   */

  return zip([cells, restCellWidths], (a, b) =>
    zip([a, b], (str, w) =>
      w >= 0
        ? cfg.right
          ? ' '.repeat(w) + str
          : str + ' '.repeat(w)
        : limit(str, strlen(str) + w)
    ).join(cfg.delimiter)
  );
};

const asTable$1 = (cfg) =>
  O$1.assign(
    (arr) => {
      var _ref;

      /*  Print arrays  */

      if (arr[0] && Array.isArray(arr[0])) {
        return asColumns(
          arr.map((r) =>
            r.map((c, i) => (c === undefined ? '' : cfg.print(c, i)))
          ),
          cfg
        ).join('\n');
      }

      /*  Print objects   */

      const colNames = [].concat(
          _toConsumableArray(
            new Set(
              (_ref = []).concat.apply(
                _ref,
                _toConsumableArray(arr.map(O$1.keys))
              )
            )
          )
        ),
        columns = [colNames.map(cfg.title)].concat(
          _toConsumableArray(
            arr.map((o) =>
              colNames.map((key) =>
                o[key] === undefined ? '' : cfg.print(o[key], key)
              )
            )
          )
        ),
        lines = asColumns(columns, cfg);

      return (
        cfg.dash
          ? [lines[0], cfg.dash.repeat(strlen(lines[0]))].concat(
              _toConsumableArray(lines.slice(1))
            )
          : lines
      ).join('\n');
    },
    cfg,
    {
      configure: (newConfig) => asTable$1(O$1.assign({}, cfg, newConfig)),
    }
  );

var asTable_1 = asTable$1({
  maxTotalWidth: Number.MAX_SAFE_INTEGER,
  print: String,
  title: String,
  dash: '-',
  right: false,
});

/*  ------------------------------------------------------------------------ */

const O = Object,
  isBrowser =
    typeof window !== 'undefined' &&
    window.window === window &&
    window.navigator,
  nodeRequire = isBrowser ? null : commonjsRequire, // to prevent bundlers from expanding the require call
  lastOf = (x) => x[x.length - 1],
  getSource = getSource$1.exports,
  partition = partition$1,
  asTable = asTable_1,
  nixSlashes = (x) => x.replace(/\\/g, '/'),
  pathRoot = isBrowser ? window.location.href : nixSlashes(process.cwd()) + '/';

/*  ------------------------------------------------------------------------ */

class StackTracey {
  constructor(input, offset) {
    const originalInput = input,
      isParseableSyntaxError =
        input && input instanceof SyntaxError && !isBrowser;

    /*  new StackTracey ()            */

    if (!input) {
      input = new Error();
      offset = offset === undefined ? 1 : offset;
    }

    /*  new StackTracey (Error)      */

    if (input instanceof Error) {
      input = input.stack || '';
    }

    /*  new StackTracey (string)     */

    if (typeof input === 'string') {
      input = this.rawParse(input)
        .slice(offset)
        .map((x) => this.extractEntryMetadata(x));
    }

    /*  new StackTracey (array)      */

    if (Array.isArray(input)) {
      if (isParseableSyntaxError) {
        const rawLines = nodeRequire('util').inspect(originalInput).split('\n'),
          fileLine = rawLines[0].split(':'),
          line = fileLine.pop(),
          file = fileLine.join(':');

        if (file) {
          input.unshift({
            file: nixSlashes(file),
            line: line,
            column: (rawLines[2] || '').indexOf('^') + 1,
            sourceLine: rawLines[1],
            callee: '(syntax error)',
            syntaxError: true,
          });
        }
      }

      this.items = input;
    } else {
      this.items = [];
    }
  }

  extractEntryMetadata(e) {
    const decomposedPath = this.decomposePath(e.file || '');
    const fileRelative = decomposedPath[0];
    const externalDomain = decomposedPath[1];

    return O.assign(e, {
      calleeShort: e.calleeShort || lastOf((e.callee || '').split('.')),
      fileRelative: fileRelative,
      fileShort: this.shortenPath(fileRelative),
      fileName: lastOf((e.file || '').split('/')),
      thirdParty: this.isThirdParty(fileRelative, externalDomain) && !e.index,
      externalDomain: externalDomain,
    });
  }

  shortenPath(relativePath) {
    return relativePath
      .replace(/^node_modules\//, '')
      .replace(/^webpack\/bootstrap\//, '')
      .replace(/^__parcel_source_root\//, '');
  }

  decomposePath(fullPath) {
    let result = fullPath;

    if (isBrowser) result = result.replace(pathRoot, '');

    const externalDomainMatch = result.match(
      /^(http|https)\:\/\/?([^\/]+)\/(.*)/
    );
    const externalDomain = externalDomainMatch
      ? externalDomainMatch[2]
      : undefined;
    result = externalDomainMatch ? externalDomainMatch[3] : result;

    if (!isBrowser) result = nodeRequire('path').relative(pathRoot, result);

    return [
      nixSlashes(result).replace(/^.*\:\/\/?\/?/, ''), // cut webpack:/// and webpack:/ things
      externalDomain,
    ];
  }

  isThirdParty(relativePath, externalDomain) {
    return (
      externalDomain ||
      relativePath[0] === '~' || // webpack-specific heuristic
      relativePath[0] === '/' || // external source
      relativePath.indexOf('node_modules') === 0 ||
      relativePath.indexOf('webpack/bootstrap') === 0
    );
  }

  rawParse(str) {
    const lines = (str || '').split('\n');

    const entries = lines.map((line) => {
      line = line.trim();

      let callee,
        fileLineColumn = [],
        native,
        planA,
        planB;

      if (
        (planA = line.match(/at (.+) \(eval at .+ \((.+)\), .+\)/)) || // eval calls
        (planA = line.match(/at (.+) \((.+)\)/)) ||
        (line.slice(0, 3) !== 'at ' && (planA = line.match(/(.*)@(.*)/)))
      ) {
        callee = planA[1];
        native = planA[2] === 'native';
        fileLineColumn = (
          planA[2].match(/(.*):(\d+):(\d+)/) ||
          planA[2].match(/(.*):(\d+)/) ||
          []
        ).slice(1);
      } else if ((planB = line.match(/^(at\s+)*(.+):(\d+):(\d+)/))) {
        fileLineColumn = planB.slice(2);
      } else {
        return undefined;
      }

      /*  Detect things like Array.reduce
            TODO: detect more built-in types            */

      if (callee && !fileLineColumn[0]) {
        const type = callee.split('.')[0];
        if (type === 'Array') {
          native = true;
        }
      }

      return {
        beforeParse: line,
        callee: callee || '',
        index: isBrowser && fileLineColumn[0] === window.location.href,
        native: native || false,
        file: nixSlashes(fileLineColumn[0] || ''),
        line: parseInt(fileLineColumn[1] || '', 10) || undefined,
        column: parseInt(fileLineColumn[2] || '', 10) || undefined,
      };
    });

    return entries.filter((x) => x !== undefined);
  }

  withSourceAt(i) {
    return this.items[i] && this.withSource(this.items[i]);
  }

  withSourceAsyncAt(i) {
    return this.items[i] && this.withSourceAsync(this.items[i]);
  }

  withSource(loc) {
    if (this.shouldSkipResolving(loc)) {
      return loc;
    } else {
      let resolved = getSource(loc.file || '').resolve(loc);

      if (!resolved.sourceFile) {
        return loc;
      }

      return this.withSourceResolved(loc, resolved);
    }
  }

  withSourceAsync(loc) {
    if (this.shouldSkipResolving(loc)) {
      return Promise.resolve(loc);
    } else {
      return getSource
        .async(loc.file || '')
        .then((x) => x.resolve(loc))
        .then((resolved) => this.withSourceResolved(loc, resolved))
        .catch((e) =>
          this.withSourceResolved(loc, { error: e, sourceLine: '' })
        );
    }
  }

  shouldSkipResolving(loc) {
    return (
      loc.sourceFile || loc.error || (loc.file && loc.file.indexOf('<') >= 0)
    ); // skip things like <anonymous> and stuff that was already fetched
  }

  withSourceResolved(loc, resolved) {
    if (resolved.sourceFile && !resolved.sourceFile.error) {
      resolved.file = nixSlashes(resolved.sourceFile.path);
      resolved = this.extractEntryMetadata(resolved);
    }

    if (resolved.sourceLine.includes('// @hide')) {
      resolved.sourceLine = resolved.sourceLine.replace('// @hide', '');
      resolved.hide = true;
    }

    if (
      resolved.sourceLine.includes('__webpack_require__') || // webpack-specific heuristics
      resolved.sourceLine.includes('/******/ ({')
    ) {
      resolved.thirdParty = true;
    }

    return O.assign({ sourceLine: '' }, loc, resolved);
  }

  withSources() {
    return this.map((x) => this.withSource(x));
  }

  withSourcesAsync() {
    return Promise.all(this.items.map((x) => this.withSourceAsync(x))).then(
      (items) => new StackTracey(items)
    );
  }

  mergeRepeatedLines() {
    return new StackTracey(
      partition(this.items, (e) => e.file + e.line).map((group) => {
        return group.items.slice(1).reduce((memo, entry) => {
          memo.callee =
            (memo.callee || '<anonymous>') +
            ' → ' +
            (entry.callee || '<anonymous>');
          memo.calleeShort =
            (memo.calleeShort || '<anonymous>') +
            ' → ' +
            (entry.calleeShort || '<anonymous>');
          return memo;
        }, O.assign({}, group.items[0]));
      })
    );
  }

  clean() {
    const s = this.withSources().mergeRepeatedLines();
    return s.filter(s.isClean.bind(s));
  }

  cleanAsync() {
    return this.withSourcesAsync().then((s) => {
      s = s.mergeRepeatedLines();
      return s.filter(s.isClean.bind(s));
    });
  }

  isClean(entry, index) {
    return index === 0 || !(entry.thirdParty || entry.hide || entry.native);
  }

  at(i) {
    return O.assign(
      {
        beforeParse: '',
        callee: '<???>',
        index: false,
        native: false,
        file: '<???>',
        line: 0,
        column: 0,
      },
      this.items[i]
    );
  }

  asTable(opts) {
    const maxColumnWidths =
      (opts && opts.maxColumnWidths) || this.maxColumnWidths();

    const trimEnd = (s, n) => s && (s.length > n ? s.slice(0, n - 1) + '…' : s);
    const trimStart = (s, n) =>
      s && (s.length > n ? '…' + s.slice(-(n - 1)) : s);

    const trimmed = this.map((e) => [
      'at ' + trimEnd(e.calleeShort, maxColumnWidths.callee),
      trimStart(
        (e.fileShort && e.fileShort + ':' + e.line) || '',
        maxColumnWidths.file
      ),
      trimEnd((e.sourceLine || '').trim() || '', maxColumnWidths.sourceLine),
    ]);

    return asTable(trimmed.items);
  }

  maxColumnWidths() {
    return {
      callee: 30,
      file: 60,
      sourceLine: 80,
    };
  }

  static resetCache() {
    getSource.resetCache();
    getSource.async.resetCache();
  }

  static locationsEqual(a, b) {
    return a.file === b.file && a.line === b.line && a.column === b.column;
  }
}
['map', 'filter', 'slice', 'concat'].forEach((method) => {
  StackTracey.prototype[method] = function (/*...args */) {
    // no support for ...args in Node v4 :(
    return new StackTracey(this.items[method].apply(this.items, arguments));
  };
});

/*  ------------------------------------------------------------------------ */

var stacktracey = StackTracey;

class ParsedStack {
  static empty() {
    return new ParsedStack('', '', []);
  }
  static parse({ stack }) {
    const parsed = new stacktracey(stack);
    const frames = parsed.items;
    if (frames.length === 0) {
      return new ParsedStack(stack, stack, []);
    }
    const first = frames[0].beforeParse;
    const lines = stack.split('\n');
    const offset = lines.findIndex((line) => line.trim() === first);
    if (offset === -1) {
      throw Error(`An assumption was incorrect: A line that came from StackTracey cannot be found in the original trace.

== Stack ==

${stack}

== Line ==

${first}`);
    }
    const header = lines.slice(0, offset).join('\n');
    return new ParsedStack(
      stack,
      header,
      frames.map((f) => StackFrame.from(parsed, f))
    );
  }
  #source;
  #header;
  #frames;
  constructor(source, header, frames) {
    this.#source = source;
    this.#header = header;
    this.#frames = frames;
  }
  get entries() {
    return this.#frames;
  }
  slice(n) {
    return new ParsedStack(this.#source, this.#header, this.#frames.slice(n));
  }
}
class Stack {
  static create(internal = 0) {
    if ('captureStackTrace' in Error) {
      const err = {};
      Error.captureStackTrace(err, Stack.create);
      return Stack.fromStack(err.stack).slice(internal);
    } else {
      const stack = Error(
        'An error created in the internals of Stack.create'
      ).stack;
      return Stack.fromStack(verified(stack, hasType('string'))).slice(
        internal + 1
      );
    }
  }
  static fromStack(stack) {
    return new Stack(ParsedStack.parse({ stack }));
  }
  static from(error) {
    if (isErrorWithStack(error)) {
      return new Stack(ParsedStack.parse(error));
    } else {
      return null;
    }
  }
  static fromHere(internal = 0) {
    return Stack.create(internal).slice(1);
  }
  static describeCaller(internal = 0) {
    return Stack.callerFrame(internal + 1)?.display ?? '';
  }
  static empty() {
    return new Stack(ParsedStack.empty());
  }
  static marker(description, internal = 0) {
    if (Description.is(description)) {
      return description;
    }
    const stack = Stack.fromCaller(internal + 1);
    return ImplementationDescription.from({ ...description, stack });
  }
  static description(name, internal = 0) {
    if (name !== void 0 && typeof name !== 'string') {
      return name;
    }
    const stack = Stack.fromCaller(internal + 1);
    if (name === void 0) {
      return { stack };
    } else {
      return { name, stack };
    }
  }
  static callerFrame(internal = 0) {
    return Stack.fromCaller(internal + 1).caller;
  }
  static fromCaller(internal = 0) {
    return Stack.create(internal + 2);
  }
  #parsed;
  constructor(parsed) {
    this.#parsed = parsed;
  }
  get entries() {
    return this.#parsed.entries;
  }
  get caller() {
    return this.#parsed.entries[0];
  }
  slice(n) {
    if (n === 0) {
      return this;
    } else {
      return new Stack(this.#parsed.slice(n));
    }
  }
}
class StackFrame {
  static from(stack, frame) {
    return new StackFrame(stack, frame, null);
  }
  #stack;
  #frame;
  #reified;
  constructor(stack, frame, reified) {
    this.#stack = stack;
    this.#frame = frame;
    this.#reified = reified;
  }
  #reify() {
    let reified = this.#reified;
    if (!reified) {
      this.#reified = reified = this.#stack.withSource(this.#frame);
    }
    return reified;
  }
  get action() {
    return this.#reify().callee;
  }
  get loc() {
    const entry = this.#reify();
    if (entry.line === void 0) {
      return void 0;
    }
    return { line: entry.line, column: entry.column };
  }
  get debug() {
    return this.#reify();
  }
  get display() {
    const module = describeModule(this.#reify().file);
    return module.display({ action: this.action, loc: this.loc });
  }
}
function isErrorWithStack(error) {
  return (
    isObject$1(error) &&
    error instanceof Error &&
    typeof error.stack === 'string'
  );
}

const VBAR = '\u2502';
const NEXT = '\u251C';
const LAST = '\u2570';
class Root {
  #root;
  constructor(root) {
    this.#root = root;
  }
  format() {
    return formatChildren(this.#root, { depth: 0 });
  }
}
function Tree(...root) {
  return new Root(root);
}
function formatNode(node, { depth, isLast }) {
  if (typeof node === 'string') {
    return formatLeaf(node, { depth, isLast });
  } else {
    return formatParent(node, { depth, isLast });
  }
}
function formatChildren(children, { depth }) {
  return children
    .map((child, index) => {
      const isLast = index === children.length - 1;
      return formatNode(child, { depth, isLast });
    })
    .join('\n');
}
function formatParent([label, ...children], { depth }) {
  const title = `${prefix({ depth, isLast: false })} ${label}`;
  return `${title}
${formatChildren(children, { depth: depth + 1 })}`;
}
function formatLeaf(value, { depth, isLast }) {
  return `${prefix({ depth, isLast })} ${value}`;
}
function indent(depth) {
  return `${VBAR} `.repeat(depth);
}
function prefix({ depth, isLast }) {
  if (isLast) {
    return `${indent(depth)}${LAST}`;
  } else {
    return `${indent(depth)}${NEXT}`;
  }
}

class Wrapper {
  static of(value, symbol) {
    return new Wrapper(null, symbol, value);
  }
  static withMeta(value, meta, symbol) {
    return new Wrapper(meta, symbol, value);
  }
  static getInner(newtype) {
    return newtype.#inner;
  }
  static inDebug(newtype, callback) {
    callback(newtype.#inner, newtype.#debugMeta);
  }
  #debugMeta;
  #symbol;
  #inner;
  constructor(debugMeta, symbol, inner) {
    this.#debugMeta = debugMeta;
    this.#symbol = symbol;
    this.#inner = inner;
  }
}
const QUALIFIED_NAME = Symbol('QUALIFIED_NAME');
function QualifiedName(name) {
  return Wrapper.withMeta(
    name,
    { description: 'QualifiedName' },
    QUALIFIED_NAME
  );
}
const LOCAL_NAME = Symbol('LOCAL_NAME');
function LocalName(name) {
  return Wrapper.withMeta(name, { description: 'LocalName' }, LOCAL_NAME);
}

const INSPECT = Symbol.for('nodejs.util.inspect.custom');
class Timestamp {
  static initial() {
    return new Timestamp(1);
  }
  #timestamp;
  constructor(timestamp) {
    this.#timestamp = timestamp;
  }
  [INSPECT]() {
    return DisplayStruct('Timestamp', { at: this.#timestamp });
  }
  gt(other) {
    return this.#timestamp > other.#timestamp;
  }
  next() {
    return new Timestamp(this.#timestamp + 1);
  }
  toString() {
    return `#<Timestamp ${this.#timestamp}>`;
  }
}

Error.stackTraceLimit = 100;
class InternalChildren {
  static None() {
    return new InternalChildren({ type: 'None' });
  }
  static Children(children) {
    return InternalChildren.from(children);
  }
  static from(children) {
    const childList = [...children].filter((child) => {
      const reactive = child[REACTIVE];
      return reactive.type !== 'mutable' || reactive.isFrozen() === false;
    });
    if (childList.length === 0) {
      return InternalChildren.None();
    } else {
      return new InternalChildren({
        type: 'Children',
        children: childList,
      });
    }
  }
  #enum;
  constructor(children) {
    this.#enum = children;
  }
  get dependencies() {
    switch (this.#enum.type) {
      case 'None':
        return /* @__PURE__ */ new Set();
      case 'Children': {
        const children = this.#enum.children.flatMap((child) => {
          const internals = child[REACTIVE];
          if (internals.type === 'mutable') {
            if (!internals.isFrozen()) {
              return [internals];
            }
          } else {
            return [...child[REACTIVE].children().dependencies];
          }
          return [];
        });
        return new Set(children);
      }
    }
  }
  get lastUpdated() {
    switch (this.#enum.type) {
      case 'None':
        return Timestamp.initial();
      case 'Children':
        return this.#enum.children
          .map((child) => child[REACTIVE].debug.lastUpdated)
          .reduce(
            (max, child) => (child.gt(max) ? child : max),
            Timestamp.initial()
          );
    }
  }
  isUpdatedSince(timestamp) {
    switch (this.#enum.type) {
      case 'None':
        return false;
      case 'Children':
        return this.#enum.children.some((child) =>
          child[REACTIVE].isUpdatedSince(timestamp)
        );
    }
  }
}

class AssertFrame {
  static describing(description) {
    return new AssertFrame(description);
  }
  #description;
  constructor(description) {
    this.#description = description;
  }
  assert() {
    throw Error(
      `The current timestamp should not change while ${this.#description}`
    );
  }
}
class ActiveFrame {
  constructor(children, description) {
    this.description = description;
    this.#children = children;
  }
  static create(description) {
    return new ActiveFrame(/* @__PURE__ */ new Set(), description);
  }
  #children;
  add(child) {
    this.#children.add(child);
  }
  finalize(value, now) {
    return {
      frame: FinalizedFrame.create({
        children: this.#children,
        finalizedAt: now,
        value,
        description: this.description,
      }),
      value,
    };
  }
}
class FinalizedFrame {
  constructor(children, finalizedAt, value, description) {
    this.description = description;
    this.#children = children;
    this.#finalizedAt = finalizedAt;
    this.#value = value;
    this.#composite = {
      type: 'composite',
      isUpdatedSince: (timestamp) => {
        return [...this.#children].some((child) =>
          child[REACTIVE].isUpdatedSince(timestamp)
        );
      },
      debug: {
        lastUpdated: this.#finalizedAt,
      },
      children: () => {
        return InternalChildren.from(this.children);
      },
    };
    this.#composite.description = FormulaDescription.from({
      ...description,
      validator: TimestampValidatorDescription.from(this.#composite),
    });
  }
  static create({ children, finalizedAt, value, description }) {
    return new FinalizedFrame(children, finalizedAt, value, description);
  }
  #children;
  #finalizedAt;
  #value;
  #composite;
  get [REACTIVE]() {
    return this.#composite;
  }
  get children() {
    return [...this.#children];
  }
  get dependencies() {
    return this.children.flatMap((child) => [
      ...child[REACTIVE].children().dependencies,
    ]);
  }
  isUpdatedSince(timestamp) {
    let isUpdated = false;
    for (let child of this.#children) {
      if (child[REACTIVE].isUpdatedSince(timestamp)) {
        isUpdated = true;
      }
    }
    return isUpdated;
  }
  validate() {
    if (this.isUpdatedSince(this.#finalizedAt)) {
      return { status: 'invalid' };
    }
    return { status: 'valid', value: this.#value };
  }
}

const UNINITIALIZED = Symbol.for('starbeam.UNINITIALIZED');

class Queue {
  static #current = new Queue();
  static enqueue(...notifications) {
    Queue.#current.enqueue(...notifications);
  }
  static afterFlush(...callbacks) {
    Queue.#current.afterFlush(...callbacks);
  }
  #started = false;
  #notifications = /* @__PURE__ */ new Set();
  #after = /* @__PURE__ */ new Set();
  #isEmpty() {
    return this.#notifications.size === 0 && this.#after.size === 0;
  }
  enqueue(...notifications) {
    for (const notification of notifications) {
      this.#notifications.add(notification);
    }
    this.#start();
  }
  afterFlush(...callbacks) {
    for (const callback of callbacks) {
      this.#after.add(callback);
    }
    this.#start();
  }
  #start() {
    if (this.#started === false) {
      this.#started = true;
      queueMicrotask(() => {
        this.#flush();
      });
    }
  }
  #flush() {
    Queue.#current = new Queue();
    for (const notification of this.#notifications) {
      notification();
    }
    if (Queue.#current.#isEmpty()) {
      for (const after of this.#after) {
        after();
      }
    } else {
      Queue.#current.afterFlush(...this.#after);
    }
  }
}

class Now {
  #now = Timestamp.initial();
  get now() {
    return this.#now;
  }
  bump() {
    return (this.#now = this.#now.next());
  }
}
const NOW = new Now();

class RenderableMap {
  static empty() {
    return new RenderableMap(/* @__PURE__ */ new WeakMap());
  }
  #map;
  constructor(map) {
    this.#map = map;
  }
  delete(dependency, renderable) {
    const set = this.#map.get(dependency);
    if (set) {
      set.delete(renderable);
    }
  }
  get(dependency) {
    return this.#map.get(dependency);
  }
  insert(dependency, renderable) {
    let set = this.#map.get(dependency);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.#map.set(dependency, set);
    }
    set.add(renderable);
  }
}

class Renderables {
  static create() {
    return new Renderables(RenderableMap.empty());
  }
  #internalsMap;
  constructor(internals) {
    this.#internalsMap = internals;
  }
  prune(renderable) {
    const dependencies = Renderable.dependencies(renderable);
    for (const dependency of dependencies) {
      this.#internalsMap.delete(dependency, renderable);
    }
  }
  bumped(dependency) {
    const renderables = this.#internalsMap.get(dependency);
    if (renderables) {
      for (const renderable of renderables) {
        Renderable.notifyReady(renderable);
      }
    }
  }
  poll(renderable) {
    const {
      add,
      remove,
      values: { next },
    } = Renderable.flush(renderable);
    for (const dep of add) {
      this.#internalsMap.insert(dep, renderable);
    }
    for (const dep of remove) {
      this.#internalsMap.delete(dep, renderable);
    }
    return next;
  }
  render(renderable, changed) {
    const {
      add,
      remove,
      values: { prev, next },
    } = Renderable.flush(renderable);
    if (prev !== next) {
      changed(next, prev);
    }
    for (const dep of add) {
      this.#internalsMap.insert(dep, renderable);
    }
    for (const dep of remove) {
      this.#internalsMap.delete(dep, renderable);
    }
  }
  insert(renderable) {
    const dependencies = Renderable.dependencies(renderable);
    for (const dep of dependencies) {
      this.#internalsMap.insert(dep, renderable);
    }
  }
}

class Phase {}
class ActionsPhase extends Phase {
  static create(description) {
    return new ActionsPhase(description, /* @__PURE__ */ new Set());
  }
  #description;
  #bumped;
  constructor(description, bumped) {
    super();
    this.#description = description;
    this.#bumped = bumped;
  }
  bump(internals) {
    this.#bumped.add(internals);
  }
}
class Timeline {
  static create() {
    return new Timeline(
      ActionsPhase.create('initialization'),
      Renderables.create(),
      /* @__PURE__ */ new Map(),
      /* @__PURE__ */ new Set()
    );
  }
  static StartedFormula = class StartedFormula {
    static create(description) {
      const prevFrame = TIMELINE.#frame;
      const currentFrame = (TIMELINE.#frame = ActiveFrame.create(description));
      return new StartedFormula(prevFrame, currentFrame);
    }
    #prev;
    #current;
    constructor(prev, current) {
      this.#prev = prev;
      this.#current = current;
    }
    done(value) {
      verify(
        TIMELINE.#frame,
        isEqual(this.#current),
        expected
          .as('the current frame')
          .when('ending a formula')
          .toBe(`the same as the frame that started the formula`)
      );
      const newFrame = this.#current.finalize(value, NOW.now);
      TIMELINE.#frame = this.#prev;
      TIMELINE.didConsume(newFrame.frame);
      return newFrame;
    }
    finally() {
      TIMELINE.#frame = this.#prev;
    }
  };
  #phase;
  #frame = null;
  #assertFrame = null;
  #debugTimeline = null;
  #renderables;
  #onUpdate;
  #onAdvance;
  constructor(phase, renderables, updaters, onAdvance) {
    this.#phase = phase;
    this.#renderables = renderables;
    this.#onUpdate = updaters;
    this.#onAdvance = onAdvance;
  }
  render(input, render, description) {
    const ready = () => Queue.afterFlush(render);
    const renderable = Renderable.create(
      input,
      { ready },
      this,
      Stack.description(description)
    );
    this.#renderables.insert(renderable);
    renderable.poll();
    return renderable;
  }
  on = {
    rendered: (callback) => {
      this.#onAdvance.add(callback);
      return () => {
        this.#onAdvance.delete(callback);
      };
    },
    change: (input, ready, description) => {
      const renderable = Renderable.create(
        input,
        { ready },
        this,
        Stack.description(description)
      );
      this.#renderables.insert(renderable);
      return renderable;
    },
  };
  attach(notify, options = { filter: { type: 'all' } }) {
    return this.#debug.attach(notify, options);
  }
  get #debug() {
    if (!this.#debugTimeline) {
      const debugTimeline = (this.#debugTimeline = DebugTimeline.create(
        Timestamp.initial()
      ));
      TIMELINE.on.rendered(() => debugTimeline.notify());
    }
    return this.#debugTimeline;
  }
  poll(renderable) {
    return this.#renderables.poll(renderable);
  }
  prune(renderable) {
    this.#renderables.prune(renderable);
  }
  #updatersFor(storage) {
    let callbacks = this.#onUpdate.get(storage);
    if (!callbacks) {
      callbacks = /* @__PURE__ */ new Set();
      this.#onUpdate.set(storage, callbacks);
    }
    return callbacks;
  }
  get now() {
    return NOW.now;
  }
  bump(mutable) {
    this.#phase.bump(mutable);
    {
      this.#debug.updateCell(mutable);
    }
    this.#assertFrame?.assert();
    NOW.bump();
    if (this.#onAdvance.size > 0) {
      this.afterFlush(...this.#onAdvance);
    }
    this.#notifySubscribers(mutable);
    this.#renderables.bumped(mutable);
    return NOW.now;
  }
  mutation(description, callback) {
    {
      return this.#debug.mutation(description, callback);
    }
  }
  enqueue(...notifications) {
    Queue.enqueue(...notifications);
  }
  afterFlush(...callbacks) {
    Queue.afterFlush(...callbacks);
  }
  #enqueue(...notifications) {
    Queue.enqueue(...notifications);
  }
  #notifySubscribers(...storages) {
    for (let storage of storages) {
      let updaters = this.#updatersFor(storage);
      LOGGER.trace.log(
        `notifying listeners for cell
cell: %o
listeners:%o`,
        storage,
        updaters
      );
      if (updaters.size > 0) {
        this.#enqueue(...updaters);
      }
    }
  }
  didConsume(reactive) {
    if (this.#frame) {
      this.#frame.add(reactive);
    } else {
      this.#debug.consume(reactive);
    }
  }
  withAssertFrame(callback, description) {
    let currentFrame = this.#assertFrame;
    try {
      this.#assertFrame = AssertFrame.describing(description);
      callback();
    } finally {
      this.#assertFrame = currentFrame;
    }
  }
  evaluateFormula(callback, description) {
    const formula = Timeline.StartedFormula.create(description);
    try {
      const result = callback();
      return formula.done(result);
    } catch (e) {
      formula.finally();
      throw e;
    }
  }
}
const TIMELINE = Timeline.create();

class Renderable {
  static create(input, notify, operations, description) {
    const initialDependencies = input[REACTIVE].children().dependencies;
    const renderable = new Renderable(
      input,
      notify,
      UNINITIALIZED,
      operations,
      new Set(initialDependencies),
      TIMELINE.now
    );
    LIFETIME.on.cleanup(renderable, () => operations.prune(renderable));
    return renderable;
  }
  static reactive(renderable) {
    return renderable.#input;
  }
  static dependencies(renderable) {
    return renderable.#dependencies;
  }
  static notifyReady(renderable) {
    renderable.#notify.ready(renderable);
  }
  static flush(renderable) {
    if (!(renderable instanceof Renderable)) {
      console.log('renderable', renderable);
    }
    return renderable.#flush();
  }
  #input;
  #notify;
  #last;
  #operations;
  #dependencies;
  #lastChecked;
  constructor(input, notify, last, operations, dependencies, lastChecked) {
    this.#input = input;
    this.#dependencies = dependencies;
    this.#last = last;
    this.#operations = operations;
    this.#notify = notify;
    this.#lastChecked = lastChecked;
  }
  get [REACTIVE]() {
    return this.#input[REACTIVE];
  }
  poll() {
    return this.#operations.poll(this);
  }
  attach(notify) {
    let last = TIMELINE.now;
    const listener = TIMELINE.attach(
      () => {
        if (this.#input[REACTIVE].isUpdatedSince(last)) {
          last = TIMELINE.now;
          notify();
        }
      },
      {
        filter: { type: 'by-reactive', reactive: this.#input },
      }
    );
    LIFETIME.link(this, listener);
    Queue.afterFlush(notify);
    return listener;
  }
  debug({ source, implementation = false } = {}) {
    const dependencies = [...this.#input[REACTIVE].children().dependencies];
    const descriptions = new Set(
      dependencies.map((dependency) => {
        return implementation
          ? dependency.description
          : dependency.description.userFacing();
      })
    );
    const nodes = [...descriptions].map((d) => {
      let description = implementation ? d : d.userFacing();
      return description.describe({ source });
    });
    return Tree(...nodes).format();
  }
  render() {
    const {
      values: { prev, next },
    } = this.#flush();
    if (prev === UNINITIALIZED) {
      return { status: 'initialized', value: next };
    } else if (prev === next) {
      return { status: 'unchanged', value: next };
    } else {
      return { status: 'changed', prev, value: next };
    }
  }
  #flush() {
    const prev = this.#last;
    const next = this.#input.current;
    const prevDeps = this.#dependencies;
    const nextDeps = new Set(this.#input[REACTIVE].children().dependencies);
    this.#dependencies = nextDeps;
    this.#lastChecked = TIMELINE.now;
    const diffs = {
      ...diff(prevDeps, nextDeps),
      values: { prev, next },
    };
    return diffs;
  }
}
function diff(prev, next) {
  const add = /* @__PURE__ */ new Set();
  const remove = /* @__PURE__ */ new Set();
  for (const internal of prev) {
    if (!next.has(internal)) {
      remove.add(internal);
    }
  }
  for (const internal of next) {
    if (!prev.has(internal)) {
      add.add(internal);
    }
  }
  return { add, remove };
}

function isArray(value) {
  return Array.isArray(value);
}

function isObject(value) {
  return typeof value === 'object' && value !== null;
}

class CompositeInternalsImpl {
  static create(children, description) {
    return new CompositeInternalsImpl(children, description);
  }
  type = 'composite';
  #children;
  #description;
  constructor(children, description) {
    this.#children = children;
    this.#description = FormulaDescription.from({
      ...description,
      validator: TimestampValidatorDescription.from(this),
    });
  }
  get debug() {
    return {
      lastUpdated: this.#children.lastUpdated,
    };
  }
  get [REACTIVE]() {
    return this;
  }
  get description() {
    return this.#description;
  }
  children() {
    return this.#children;
  }
  update(children) {
    this.#children = children;
  }
  isUpdatedSince(timestamp) {
    return this.#children.isUpdatedSince(timestamp);
  }
}
function CompositeInternals(children, description) {
  if (isArray(children)) {
    return CompositeInternalsImpl.create(
      InternalChildren.from(children),
      description
    );
  } else {
    return CompositeInternalsImpl.create(children, description);
  }
}

function ReactiveFn(reactive) {
  function Reactive() {
    return reactive.current;
  }
  Object.defineProperty(Reactive, REACTIVE, {
    configurable: true,
    get: () => reactive[REACTIVE],
  });
  Object.defineProperty(Reactive, 'current', {
    configurable: true,
    get: () => reactive.current,
  });
  return Reactive;
}

class MutableInternalsImpl {
  static {
    inspector(this, 'MutableInternals').define((internals, debug) =>
      debug.struct(
        {
          frozen: internals.#frozen,
          lastUpdate: internals.#lastUpdate,
        },
        {
          description: internals.#description.fullName,
        }
      )
    );
  }
  static create(description) {
    return new MutableInternalsImpl(
      false,
      TIMELINE.now,
      CellDescription,
      description
    );
  }
  static described(type, description) {
    return new MutableInternalsImpl(false, TIMELINE.now, type, description);
  }
  type = 'mutable';
  #frozen;
  #lastUpdate;
  #description;
  constructor(frozen, lastUpdate, type, description) {
    this.#frozen = frozen;
    this.#lastUpdate = lastUpdate;
    this.#description = Description.from(
      type,
      description,
      TimestampValidatorDescription.from(this)
    );
  }
  get [REACTIVE]() {
    return this;
  }
  get debug() {
    return { lastUpdated: this.#lastUpdate };
  }
  children() {
    if (this.#frozen) {
      return InternalChildren.None();
    } else {
      return InternalChildren.Children([this]);
    }
  }
  isFrozen() {
    return this.#frozen;
  }
  consume() {
    if (!this.#frozen) {
      TIMELINE.didConsume(this);
    }
  }
  update() {
    if (this.#frozen) {
      throw TypeError(
        `Cannot update a frozen reactive object (${this.#description.fullName})`
      );
    }
    this.#lastUpdate = TIMELINE.bump(this);
  }
  freeze() {
    this.#frozen = true;
  }
  get description() {
    return this.#description;
  }
  set description(value) {
    this.#description = value;
  }
  isUpdatedSince(timestamp) {
    return this.#lastUpdate.gt(timestamp);
  }
}

class ReactiveMarker {
  static create(internals) {
    return new ReactiveMarker(internals);
  }
  #internals;
  constructor(reactive) {
    this.#internals = reactive;
  }
  freeze() {
    this.#internals.freeze();
  }
  consume() {
    this.#internals.consume();
  }
  update() {
    this.#internals.update();
  }
  get [REACTIVE]() {
    return this.#internals;
  }
}
function Marker(description) {
  return ReactiveMarker.create(MutableInternalsImpl.create(description));
}
Marker.described = (type, args) => {
  return ReactiveMarker.create(MutableInternalsImpl.described(type, args));
};

class ReactiveFormula {
  static create(formula, description) {
    return new ReactiveFormula(UNINITIALIZED, formula, description);
  }
  #marker;
  #last;
  #formula;
  #description;
  constructor(last, formula, description) {
    this.#last = last;
    this.#formula = formula;
    this.#description = description;
    this.#marker = Marker(description);
  }
  get [REACTIVE]() {
    if (this.#last === UNINITIALIZED) {
      return this.#marker[REACTIVE];
    } else {
      return CompositeInternals(
        [this.#marker, this.#last.frame],
        this.#description
      );
    }
  }
  get current() {
    if (this.#last === UNINITIALIZED) {
      this.#marker.update();
      this.#marker.freeze();
    } else {
      const validation = this.#last.frame.validate();
      if (validation.status === 'valid') {
        TIMELINE.didConsume(this.#last.frame);
        return validation.value;
      }
    }
    return this.#evaluate();
  }
  #evaluate() {
    const { value, frame } = TIMELINE.evaluateFormula(
      this.#formula,
      this.#description
    );
    TIMELINE.didConsume(frame);
    this.#last = { value, frame };
    return value;
  }
}
function Formula(formula, description) {
  const reactive = ReactiveFormula.create(
    formula,
    Stack.description(description)
  );
  return ReactiveFn(reactive);
}

const DEBUG_RENDERER = {
  render({ render, debug }, description) {
    const formula = Formula(render, Stack.description(description));
    const renderable = TIMELINE.render(formula, () => {
      debug(formula.current);
    });
    renderable.poll();
  },
};

class ReactiveCell {
  static create(value, equals = Object.is, internals) {
    return new ReactiveCell(value, equals, internals);
  }
  #value;
  #internals;
  #equals;
  constructor(value, equals, reactive) {
    this.#value = value;
    this.#equals = equals;
    this.#internals = reactive;
  }
  [INSPECT]() {
    const { description, debug } = this.#internals;
    return DisplayStruct(`Cell (${description.describe()})`, {
      value: this.#value,
      updated: debug.lastUpdated,
    });
  }
  toString() {
    return `Cell (${String(this.#value)})`;
  }
  freeze() {
    this.#internals.freeze();
  }
  get current() {
    this.#internals.consume();
    return this.#value;
  }
  set current(value) {
    this.#set(value);
  }
  set(value) {
    return this.#set(value);
  }
  update(updater) {
    return this.#set(updater(this.#value));
  }
  #set(value) {
    if (this.#equals(this.#value, value)) {
      return false;
    }
    this.#value = value;
    this.#internals.update();
    return true;
  }
  get [REACTIVE]() {
    return this.#internals;
  }
}
function Cell(value, description) {
  if (typeof description === 'string' || description === void 0) {
    return ReactiveCell.create(
      value,
      Object.is,
      MutableInternalsImpl.create(Stack.description(description))
    );
  }
  const { equals, ...rest } = description;
  return ReactiveCell.create(
    value,
    equals,
    MutableInternalsImpl.create(Stack.description(rest))
  );
}
Cell.is = (value) => {
  return isObject(value) && value instanceof ReactiveCell;
};

class Linkable {
  static create(link) {
    return new Linkable(link);
  }
  #link;
  constructor(link) {
    this.#link = link;
  }
  create({ owner }) {
    return this.#link(owner);
  }
  map(mapper) {
    return new Linkable((owner) => {
      const value = this.#link(owner);
      return mapper(value);
    });
  }
}

class FormulaState {
  static evaluate(formula, description) {
    const { frame, value } = TIMELINE.evaluateFormula(formula, description);
    return {
      state: new FormulaState(formula, frame, value),
      value,
    };
  }
  #formula;
  #frame;
  #lastValue;
  constructor(formula, frame, lastValue) {
    this.#formula = formula;
    this.#frame = frame;
    this.#lastValue = lastValue;
  }
  get [REACTIVE]() {
    return this.#frame[REACTIVE];
  }
  get frame() {
    return this.#frame;
  }
  get dependencies() {
    return this.#frame.dependencies;
  }
  validate() {
    const validation = this.#frame.validate();
    if (validation.status === 'valid') {
      return { state: 'valid', value: validation.value };
    }
    return {
      state: 'invalid',
      oldValue: this.#lastValue,
      compute: () => {
        const { frame, value } = TIMELINE.evaluateFormula(
          this.#formula,
          this.#frame.description
        );
        const changed = this.#lastValue !== value;
        this.#lastValue = value;
        this.#frame = frame;
        return { state: changed ? 'changed' : 'unchanged', value };
      },
    };
  }
  poll() {
    const validation = this.#frame.validate();
    if (validation.status === 'valid') {
      return { state: 'unchanged', value: validation.value };
    }
    const oldValue = this.#lastValue;
    const { frame, value } = TIMELINE.evaluateFormula(
      this.#formula,
      this.#frame.description
    );
    this.#lastValue = value;
    this.#frame = frame;
    return { state: 'changed', value, oldValue };
  }
}

class ReactiveResource {
  static create(create, description) {
    return new ReactiveResource(
      create,
      Marker(description),
      UNINITIALIZED,
      description
    );
  }
  #create;
  #initialized;
  #state;
  #description;
  constructor(create, initialized, state, description) {
    this.#create = create;
    this.#initialized = initialized;
    this.#state = state;
    this.#description = description;
  }
  get [REACTIVE]() {
    if (this.#state === UNINITIALIZED) {
      return this.#initialized[REACTIVE];
    } else {
      return CompositeInternals(
        [this.#initialized, this.#state.creation, this.#state.formula],
        this.#description
      );
    }
  }
  get current() {
    if (this.#state === UNINITIALIZED) {
      this.#initialized.update();
      const formula = this.#initialize();
      return formula.current;
    } else {
      const { creation, formula, lifetime } = this.#state;
      const result = creation.validate();
      if (result.state === 'valid') {
        return formula.current;
      } else {
        const formula2 = this.#initialize({ last: lifetime });
        return formula2.current;
      }
    }
  }
  #initialize(options) {
    if (options?.last) {
      LIFETIME.finalize(options.last);
    }
    const build = BuildResource.create();
    const { state, value: definition } = FormulaState.evaluate(
      () => this.#create(build),
      this.#description
    );
    const formula = Formula(definition, {
      ...this.#description,
      transform: (description) =>
        description.implementation({ reason: 'constructor formula' }),
    });
    const lifetime = BuildResource.lifetime(build);
    LIFETIME.link(this, lifetime);
    this.#state = {
      creation: state,
      lifetime,
      formula,
    };
    return formula;
  }
}
class BuildResource {
  static create() {
    return new BuildResource({});
  }
  static lifetime(build) {
    return build.#object;
  }
  #object;
  constructor(object) {
    this.#object = object;
  }
  on = {
    cleanup: (handler) => LIFETIME.on.cleanup(this.#object, handler),
  };
  link(child) {
    return LIFETIME.link(this.#object, child);
  }
}
function Resource(create, description) {
  return Linkable.create((owner) => {
    const resource = ReactiveResource.create(
      create,
      Stack.description(description)
    );
    LIFETIME.link(owner, resource);
    return resource;
  });
}

const Reactive = {
  internals(reactive) {
    return reactive[REACTIVE];
  },
  description(reactive) {
    return Reactive.internals(reactive).description;
  },
};

class ReactiveFormulaList {
  static create(iterable, { key, value }, desc) {
    const descArgs = Stack.description(desc);
    const list = Formula(
      () => [...iterable].map((item) => [key(item), item]),
      descArgs
    );
    const description = Reactive.description(list);
    const last = list.current;
    const map = /* @__PURE__ */ new Map();
    for (const [key2, item] of last) {
      map.set(
        key2,
        Formula(() => value(item), { description: description.member('item') })
      );
    }
    return new ReactiveFormulaList(last, list, map, value);
  }
  #last;
  #inputs;
  #map;
  #value;
  #outputs;
  constructor(last, list, map, value) {
    this.#last = last;
    this.#inputs = list;
    this.#map = map;
    this.#value = value;
    this.#outputs = Formula(() => {
      this.#update();
      return [...this.#map.values()].map((formula) => formula.current);
    });
  }
  get [REACTIVE]() {
    return this.#outputs[REACTIVE];
  }
  get current() {
    return this.#outputs.current;
  }
  #update() {
    const next = this.#inputs.current;
    if (this.#last === next) {
      return;
    }
    this.#last = next;
    const map = /* @__PURE__ */ new Map();
    for (const [key, item] of next) {
      const formula = this.#map.get(key);
      if (formula === void 0) {
        map.set(
          key,
          Formula(() => this.#value(item), {
            description: Reactive.description(this.#inputs).member('item'),
          })
        );
      } else {
        map.set(key, formula);
      }
    }
    this.#map = map;
  }
}
const FormulaList = ReactiveFormulaList.create;

function normalizeOptions(options) {
  if (typeof options === 'function') {
    return {
      equals: Object.is,
      fn: options,
    };
  }
  return {
    equals: options.equals ?? Object.is,
    fn: options.fn,
  };
}
function FormulaFn(options, description) {
  const { equals, fn } = normalizeOptions(options);
  const cell = Cell(UNINITIALIZED, {
    ...Stack.description(description),
    equals: (a, b) => {
      if (a === UNINITIALIZED || b === UNINITIALIZED) {
        return false;
      }
      return equals(a, b);
    },
  });
  const desc = Reactive.description(cell);
  const formula = Formula(
    () => {
      const value = verified(cell.current, isNotEqual(UNINITIALIZED));
      return fn(value);
    },
    { description: desc.implementation({ reason: 'FormulaFn formula' }) }
  );
  return (value) => {
    cell.set(value);
    return formula.current;
  };
}

function ResourceFn(options, description) {
  return Linkable.create((owner) => {
    const equals = options.equals ?? Object.is;
    const cell = Cell(UNINITIALIZED, {
      ...Stack.description(description),
      equals: (a, b) => {
        if (a === UNINITIALIZED || b === UNINITIALIZED) {
          return false;
        }
        return equals(a, b);
      },
    });
    const formula = Formula(() => {
      const value = verified(cell.current, isNotEqual(UNINITIALIZED));
      return options.fn(value);
    });
    let last;
    return (value) => {
      cell.set(value);
      const next = formula.current;
      if (last === void 0) {
        last = { linkable: next, resource: next.create({ owner }) };
      } else if (last.linkable !== next) {
        LIFETIME.finalize(last.resource);
        last = { linkable: next, resource: next.create({ owner }) };
      }
      return last.resource.current;
    };
  });
}

class ReactiveResourceList {
  static create(iterable, { key, resource }, desc) {
    const formula = Formula(() =>
      [...iterable].map((item) => [key(item), item])
    );
    const description = Stack.description(desc);
    return Linkable.create((owner) => {
      const list = new ReactiveResourceList(formula, resource, description);
      LIFETIME.link(owner, list);
      return list;
    });
  }
  #last;
  #map;
  #inputs;
  #resource;
  #description;
  #outputs;
  constructor(iterable, resource, description) {
    this.#inputs = iterable;
    this.#map = void 0;
    this.#last = void 0;
    this.#resource = resource;
    this.#description = description;
    this.#map = this.#update();
    this.#outputs = Formula(() => {
      this.#map = this.#update();
      return [...this.#map.values()].map((formula) => formula.current);
    });
  }
  get [REACTIVE]() {
    return this.#outputs[REACTIVE];
  }
  get current() {
    return this.#outputs.current;
  }
  #update() {
    const next = this.#inputs.current;
    if (this.#map !== void 0 && this.#last === next) {
      return this.#map;
    }
    this.#last = next;
    const map = /* @__PURE__ */ new Map();
    for (const [key, item] of next) {
      const formula = this.#map?.get(key);
      if (formula === void 0) {
        const linkable = this.#resource(item);
        const resource = linkable.create({ owner: this });
        map.set(key, resource);
      } else {
        map.set(key, formula);
      }
    }
    if (this.#map) {
      for (const [key, formula] of this.#map) {
        if (!map.has(key)) {
          LIFETIME.finalize(formula);
        }
      }
    }
    return map;
  }
}
const ResourceList = ReactiveResourceList.create;

class ItemState {
  static create(initialized, description, member) {
    return new ItemState(
      Cell(initialized, {
        ...description.memberArgs(member),
        transform: (d) =>
          d.implementation({ reason: 'initialization tracking' }),
      }),
      Marker(description.memberArgs(member))
    );
  }
  static uninitialized(description, member) {
    return ItemState.create(false, description, member);
  }
  static initialized(description, member) {
    return ItemState.create(true, description, member);
  }
  #present;
  #value;
  constructor(present, value) {
    this.#present = present;
    this.#value = value;
  }
  check() {
    this.#present.current;
  }
  read() {
    this.#present.current;
    this.#value.consume();
  }
  initialize() {
    this.#present.current = true;
  }
  update() {
    this.#present.current = true;
    this.#value.update();
  }
  delete() {
    this.#present.current = false;
  }
}
class Item {
  static uninitialized(description, member) {
    const item = new Item(ItemState.uninitialized(description, member));
    item.#value.check();
    return item;
  }
  static initialized(description, member) {
    return new Item(ItemState.initialized(description, member));
  }
  #value;
  constructor(value) {
    this.#value = value;
  }
  check() {
    this.#value.check();
  }
  set() {
    this.#value.update();
  }
  delete() {
    this.#value.delete();
  }
  read() {
    return this.#value.read();
  }
}
class Collection {
  static #objects = /* @__PURE__ */ new WeakMap();
  static for(object) {
    return verified(
      Collection.#objects.get(object),
      isPresent,
      expected('an reactive ecmascript collection').toHave(
        'an associated internal collection'
      )
    );
  }
  static create(description, object) {
    const collection = new Collection(void 0, /* @__PURE__ */ new Map(), {
      ...description,
      transform: (d) => d.member('entries'),
    });
    Collection.#objects.set(object, collection);
    return collection;
  }
  #iteration;
  #items;
  #description;
  constructor(iteration, items, description) {
    this.#description = description;
    this.#iteration = iteration;
    this.#items = items;
  }
  iterateKeys() {
    if (this.#iteration === void 0) {
      this.#iteration = Marker(this.#description);
    }
    this.#iteration.consume();
  }
  splice() {
    if (this.#iteration === void 0) {
      return;
    }
    this.#iteration.update();
  }
  check(key, disposition, description) {
    let item = this.#items.get(key);
    if (item === void 0) {
      item = this.#initialize(key, disposition, description);
    }
    item.check();
  }
  get(key, disposition, description) {
    let item = this.#items.get(key);
    if (item === void 0) {
      item = this.#initialize(key, disposition, description);
    }
    return item.read();
  }
  set(key, disposition, description) {
    if (disposition === 'key:changes') {
      this.splice();
    }
    let item = this.#items.get(key);
    if (item === void 0) {
      item = this.#initialize(key, 'hit', description);
      return;
    }
    item.set();
    if (disposition === 'key:changes') {
      this.splice();
    }
  }
  delete(key) {
    const item = this.#items.get(key);
    if (item === void 0) {
      return;
    }
    item.delete();
    this.splice();
  }
  #initialize(key, disposition, member) {
    if (this.#iteration === void 0) {
      this.#iteration = Marker(this.#description);
    }
    let item;
    const iteration = Reactive.internals(this.#iteration).description;
    if (disposition === 'miss') {
      item = Item.uninitialized(iteration, member);
    } else {
      item = Item.initialized(iteration, member);
    }
    this.#items.set(key, item);
    return item;
  }
}

const ARRAY_GETTER_METHODS = /* @__PURE__ */ new Set([
  Symbol.iterator,
  'concat',
  'entries',
  'every',
  'fill',
  'filter',
  'find',
  'findIndex',
  'flat',
  'flatMap',
  'forEach',
  'includes',
  'indexOf',
  'join',
  'keys',
  'lastIndexOf',
  'map',
  'reduce',
  'reduceRight',
  'slice',
  'some',
  'values',
]);
const ARRAY_SETTER_METHODS = /* @__PURE__ */ new Set([
  'copyWithin',
  'fill',
  'pop',
  'push',
  'reverse',
  'shift',
  'sort',
  'splice',
  'unshift',
]);
function isGetterMethod(prop) {
  return ARRAY_GETTER_METHODS.has(prop);
}
function isSetterMethod(prop) {
  return ARRAY_SETTER_METHODS.has(prop);
}
function convertToInt(prop) {
  if (typeof prop === 'symbol') return null;
  const num = Number(prop);
  if (isNaN(num)) return null;
  return num % 1 === 0 ? num : null;
}
class Shadow {
  static create(target, collection) {
    return new Shadow(/* @__PURE__ */ new Map(), target, collection);
  }
  #fns;
  #target;
  #collection;
  constructor(fns, target, collection) {
    this.#fns = fns;
    this.#target = target;
    this.#collection = collection;
  }
  #getterMethod(prop) {
    let fn = this.#fns.get(prop);
    if (!fn) {
      fn = (...args) => {
        this.#collection.iterateKeys();
        return this.#target[prop](...args);
      };
      this.#fns.set(prop, fn);
    }
    return fn;
  }
  #setterMethod(name) {
    let fn = this.#fns.get(name);
    if (!fn) {
      fn = (...args) => {
        const prev = this.#target.length;
        const result = this.#target[name](...args);
        const next = this.#target.length;
        if (prev !== 0 || next !== 0) {
          this.#collection.splice();
        }
        return result;
      };
    }
    return fn;
  }
  at(index) {
    this.#collection.get(
      index,
      index in this.#target ? 'hit' : 'miss',
      member$1(index)
    );
    this.#collection.iterateKeys();
    return this.#target[index];
  }
  updateAt(index, value) {
    const current = this.#target[index];
    if (Object.is(current, value)) {
      return;
    }
    this.#collection.splice();
    this.#collection.set(index, 'key:changes', member$1(index));
    this.#target[index] = value;
  }
  get(prop) {
    if (isGetterMethod(prop)) {
      return this.getterMethod(prop);
    } else if (isSetterMethod(prop)) {
      return this.setterMethod(prop);
    } else {
      return this.#target[prop];
    }
  }
  set(prop, value) {
    this.#collection.splice();
    this.#target[prop] = value;
  }
  getterMethod(name) {
    return this.#getterMethod(name);
  }
  setterMethod(name) {
    return this.#setterMethod(name);
  }
  updateLength(to) {
    if (this.#target.length === to) {
      return;
    } else {
      this.#collection.splice();
    }
  }
}
class TrackedArray {
  constructor(description, arr = []) {
    Object.freeze(arr);
    const target = [...arr];
    const proxy = new Proxy(target, {
      get(target2, prop) {
        if (prop === 'length') {
          collection.iterateKeys();
          return target2.length;
        }
        const index = convertToInt(prop);
        if (index === null) {
          return shadow.get(prop);
        } else {
          return shadow.at(index);
        }
      },
      set(target2, prop, value) {
        const index = convertToInt(prop);
        if (prop === 'length') {
          shadow.updateLength(value);
          if (value === target2.length) {
            return true;
          }
        }
        if (index === null) {
          shadow.set(prop, value);
        } else if (index in target2) {
          shadow.updateAt(index, value);
        } else {
          shadow.set(prop, value);
        }
        return true;
      },
      getPrototypeOf() {
        return TrackedArray.prototype;
      },
    });
    const collection = Collection.create(description, proxy);
    const shadow = Shadow.create(target, collection);
    return proxy;
  }
}
Object.setPrototypeOf(TrackedArray.prototype, Array.prototype);
function member$1(prop) {
  if (typeof prop === 'string') {
    return `.${prop}`;
  } else {
    return `[${String(prop)}]`;
  }
}

class Entry {
  static initialized(value, desc, equality) {
    return new Entry(
      Cell(Cell(value, desc), {
        ...desc,
        transform: (d) => d.implementation({ reason: 'initialized entry' }),
      }),
      equality
    );
  }
  static uninitialized(desc, equality) {
    return new Entry(Cell(void 0, desc), equality);
  }
  #value;
  #equality;
  constructor(value, equality) {
    this.#value = value;
    this.#equality = equality;
  }
  isPresent() {
    return this.#value.current !== void 0;
  }
  delete() {
    const cell = this.#value.current;
    if (cell === void 0) {
      return 'unchanged';
    } else {
      this.#value.set(void 0);
      return 'deleted';
    }
  }
  get() {
    return this.#value.current?.current;
  }
  set(value) {
    const cell = this.#value.current;
    if (cell === void 0) {
      this.#value.set(
        Cell(value, {
          description: Reactive.internals(
            this.#value
          ).description.implementation({
            reason: 'initialized entry',
          }),
        })
      );
      return 'initialized';
    } else {
      return cell.set(value) ? 'updated' : 'unchanged';
    }
  }
}
class ReactiveMap {
  static reactive(equality, description) {
    return new ReactiveMap(description, equality);
  }
  #description;
  #entries = /* @__PURE__ */ new Map();
  #equality;
  #keys;
  #values;
  constructor(description, equality) {
    this.#description = description;
    this.#equality = equality;
    this.#keys = Marker({
      ...description,
      transform: (d) => d.member('keys'),
    });
    this.#values = Marker({
      ...description,
      transform: (d) => d.member('values'),
    });
  }
  clear() {
    if (this.#entries.size > 0) {
      this.#entries.clear();
      this.#keys.update();
      this.#values.update();
    }
  }
  delete(key) {
    const entry = this.#entries.get(key);
    if (entry) {
      const disposition = entry.delete();
      if (disposition === 'deleted') {
        this.#entries.delete(key);
        this.#keys.update();
        this.#values.update();
        return true;
      }
    }
    return false;
  }
  forEach(callbackfn, thisArg) {
    this.#keys.consume();
    this.#values.consume();
    for (const [key, entry] of this.#entries) {
      callbackfn.call(thisArg, entry.get(), key, this);
    }
  }
  get(key) {
    const entry = this.#entry(key);
    return entry?.get();
  }
  has(key) {
    return this.#entry(key).isPresent();
  }
  set(key, value) {
    const entry = this.#entry(key);
    const disposition = entry.set(value);
    if (disposition === 'initialized') {
      this.#keys.update();
    }
    if (disposition === 'initialized' || disposition === 'updated') {
      this.#values.update();
    }
    return this;
  }
  get size() {
    this.#keys.consume();
    let size = 0;
    for (const [, entry] of this.#iterate()) {
      if (entry.isPresent()) {
        size++;
      }
    }
    return size;
  }
  *#iterate() {
    for (const [key, entry] of this.#entries) {
      if (entry.isPresent()) {
        yield [key, entry];
      }
    }
  }
  *entries() {
    this.#keys.consume();
    this.#values.consume();
    for (const [key, value] of this.#iterate()) {
      yield [key, value.get()];
    }
  }
  *keys() {
    this.#keys.consume();
    for (const [key] of this.#iterate()) {
      yield key;
    }
  }
  *values() {
    this.#values.consume();
    for (const [, value] of this.#iterate()) {
      yield value.get();
    }
  }
  [Symbol.iterator]() {
    return this.entries();
  }
  [Symbol.toStringTag] = 'Map';
  #entry(key) {
    let entry = this.#entries.get(key);
    if (entry === void 0) {
      entry = Entry.uninitialized(
        { ...this.#description, transform: (d) => d.member('entry') },
        this.#equality
      );
      this.#entries.set(key, entry);
    }
    return entry;
  }
}
class ReactiveSet {
  static reactive(equality, description) {
    return new ReactiveSet(description, equality);
  }
  #description;
  #entries = /* @__PURE__ */ new Map();
  #equality;
  #values;
  constructor(description, equality) {
    this.#description = description;
    this.#equality = equality;
    this.#values = Marker({
      ...description,
      transform: (d) => d.member('values'),
    });
  }
  add(value) {
    const entry = this.#entry(value);
    if (!entry.isPresent()) {
      this.#entries.set(value, entry);
      this.#values.update();
      entry.set(value);
    }
    return this;
  }
  clear() {
    if (this.#entries.size > 0) {
      this.#entries.clear();
      this.#values.update();
    }
  }
  delete(value) {
    const entry = this.#entries.get(value);
    if (entry) {
      const disposition = entry.delete();
      if (disposition === 'deleted') {
        this.#values.update();
        this.#entries.delete(value);
        return true;
      }
    }
    return false;
  }
  forEach(callbackfn, thisArg) {
    this.#values.consume();
    for (const [value] of this.#iterate()) {
      callbackfn.call(thisArg, value, value, this);
    }
  }
  has(value) {
    return this.#entry(value).isPresent();
  }
  get size() {
    this.#values.consume();
    let size = 0;
    for (const _ of this.#iterate()) {
      size++;
    }
    return size;
  }
  *#iterate() {
    for (const [value, entry] of this.#entries) {
      if (entry.isPresent()) {
        yield [value, entry];
      }
    }
  }
  *entries() {
    this.#values.consume();
    for (const [value, entry] of this.#iterate()) {
      yield [value, entry.get()];
    }
  }
  *keys() {
    this.#values.consume();
    for (const [value] of this.#iterate()) {
      yield value;
    }
  }
  values() {
    return this.keys();
  }
  [Symbol.iterator]() {
    return this.keys();
  }
  [Symbol.toStringTag] = 'Set';
  #entry(value) {
    let entry = this.#entries.get(value);
    if (entry === void 0) {
      entry = Entry.uninitialized(this.#description, this.#equality);
      this.#entries.set(value, entry);
    }
    return entry;
  }
}

class TrackedMap {
  static reactive(description) {
    return new TrackedMap(description);
  }
  #collection;
  #values;
  #equals = Object.is;
  #vals;
  constructor(description) {
    this.#vals = /* @__PURE__ */ new Map();
    this.#values = Marker({
      ...description,
      transform: (d) => d.member('values'),
    });
    this.#collection = Collection.create(description, this);
  }
  get(key) {
    const has = this.#vals.has(key);
    this.#collection.get(key, has ? 'hit' : 'miss', ' {entry}');
    return this.#vals.get(key);
  }
  has(key) {
    const has = this.#vals.has(key);
    this.#collection.check(key, has ? 'hit' : 'miss', ' {entry}');
    return has;
  }
  entries() {
    this.#collection.iterateKeys();
    this.#values.consume();
    return this.#vals.entries();
  }
  keys() {
    this.#collection.iterateKeys();
    return this.#vals.keys();
  }
  values() {
    this.#collection.iterateKeys();
    this.#values.consume();
    return this.#vals.values();
  }
  forEach(fn) {
    this.#collection.iterateKeys();
    this.#values.consume();
    this.#vals.forEach(fn);
  }
  get size() {
    this.#collection.iterateKeys();
    return this.#vals.size;
  }
  [Symbol.iterator]() {
    this.#collection.iterateKeys();
    this.#values.consume();
    return this.#vals[Symbol.iterator]();
  }
  get [Symbol.toStringTag]() {
    return this.#vals[Symbol.toStringTag];
  }
  set(key, value) {
    const has = this.#vals.has(key);
    if (has) {
      const current = this.#vals.get(key);
      if (this.#equals(current, value)) {
        return this;
      }
    }
    this.#values.update();
    this.#collection.set(key, has ? 'key:stable' : 'key:changes', ' {entry}');
    this.#vals.set(key, value);
    return this;
  }
  delete(key) {
    const has = this.#vals.has(key);
    if (!has) {
      return false;
    }
    this.#collection.splice();
    this.#values.update();
    this.#collection.delete(key);
    return this.#vals.delete(key);
  }
  clear() {
    const hasItems = this.#vals.size > 0;
    if (!hasItems) {
      return;
    }
    this.#collection.splice();
    this.#values.update();
    this.#vals.clear();
  }
}
Object.setPrototypeOf(TrackedMap.prototype, Map.prototype);
class TrackedWeakMap {
  static reactive(description) {
    return new TrackedWeakMap(description);
  }
  #collection;
  #vals;
  #equals = Object.is;
  constructor(description) {
    this.#vals = /* @__PURE__ */ new WeakMap();
    this.#collection = Collection.create(description, this);
  }
  get(key) {
    const has = this.#vals.has(key);
    this.#collection.get(key, has ? 'hit' : 'miss', ' {entry}');
    return this.#vals.get(key);
  }
  has(key) {
    const has = this.#vals.has(key);
    this.#collection.check(key, has ? 'hit' : 'miss', ' {entry}');
    return has;
  }
  set(key, value) {
    const has = this.#vals.has(key);
    if (has) {
      const current = this.#vals.get(key);
      if (this.#equals(current, value)) {
        return this;
      }
    }
    this.#collection.set(key, has ? 'key:stable' : 'key:changes', ' {entry}');
    this.#vals.set(key, value);
    return this;
  }
  delete(key) {
    const has = this.#vals.has(key);
    if (!has) {
      return false;
    }
    this.#collection.delete(key);
    return this.#vals.delete(key);
  }
  get [Symbol.toStringTag]() {
    return this.#vals[Symbol.toStringTag];
  }
}
Object.setPrototypeOf(TrackedWeakMap.prototype, WeakMap.prototype);

class TrackedObject {
  static reactive(description, obj) {
    return new TrackedObject(description, obj);
  }
  constructor(description, obj) {
    const target = { ...obj };
    const proxy = new Proxy(target, {
      defineProperty(target2, key, descriptor) {
        define(key, descriptor);
        return true;
      },
      deleteProperty(target2, prop) {
        if (Reflect.has(target2, prop)) {
          collection.delete(prop);
          Reflect.deleteProperty(target2, prop);
        }
        return true;
      },
      get(target2, prop, _receiver) {
        collection.get(
          prop,
          Reflect.has(target2, prop) ? 'hit' : 'miss',
          member(prop)
        );
        return Reflect.get(target2, prop);
      },
      getOwnPropertyDescriptor(target2, prop) {
        collection.get(
          prop,
          Reflect.has(target2, prop) ? 'hit' : 'miss',
          member(prop)
        );
        return Reflect.getOwnPropertyDescriptor(target2, prop);
      },
      getPrototypeOf() {
        return TrackedObject.prototype;
      },
      has(target2, prop) {
        const has = Reflect.has(target2, prop);
        collection.check(prop, has ? 'hit' : 'miss', member(prop));
        return has;
      },
      isExtensible(target2) {
        return Reflect.isExtensible(target2);
      },
      ownKeys(target2) {
        collection.iterateKeys();
        return Reflect.ownKeys(target2);
      },
      preventExtensions(target2) {
        return Reflect.preventExtensions(target2);
      },
      set(target2, prop, value, _receiver) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target2, prop);
        if (descriptor === void 0 || isDataProperty(descriptor)) {
          const updates = Descriptor.updates(target2, prop, {
            value,
          });
          if (updates.isNoop) {
            return true;
          }
          collection.set(prop, updates.disposition, member(prop));
        }
        Reflect.set(target2, prop, value);
        return true;
      },
      setPrototypeOf() {
        return false;
      },
    });
    const collection = Collection.create(description, proxy);
    return proxy;
    function define(key, descriptor) {
      const updates = Descriptor.updates(target, key, descriptor);
      if (updates.isNoop) {
        return true;
      }
      collection.set(key, updates.disposition, String(key));
      return true;
    }
  }
}
class Descriptor {
  static from(descriptor) {
    return new Descriptor(descriptor);
  }
  static updates(object, key, updates) {
    return new Descriptor(
      updates,
      Reflect.getOwnPropertyDescriptor(object, key)
    );
  }
  #descriptor;
  #before;
  constructor(updates, before) {
    this.#descriptor = updates;
    this.#before = before;
    this.#assert();
  }
  get disposition() {
    if (this.#before === void 0) {
      return 'key:changes';
    }
    if (!Reflect.has(this.#descriptor, 'enumerable')) {
      return 'key:stable';
    }
    if (this.#descriptor.enumerable !== this.#before.enumerable) {
      return 'key:changes';
    }
    return 'key:stable';
  }
  get isNoop() {
    const before = this.#before;
    if (before === void 0) {
      return false;
    }
    const updates = this.#descriptor;
    if (
      Reflect.has(updates, 'enumerable') &&
      updates.enumerable !== before.enumerable
    ) {
      return false;
    }
    if (isDataProperty(before) && isDataProperty(updates)) {
      if (
        Reflect.has(updates, 'value') &&
        !Object.is(updates.value, before.value)
      ) {
        return false;
      }
      if (
        Reflect.has(updates, 'writable') &&
        updates.writable !== before.writable
      ) {
        return false;
      }
      return true;
    }
    if (isAccessorProperty(before) && isAccessorProperty(updates)) {
      if (Reflect.has(updates, 'get') && !Object.is(updates.get, before.get)) {
        return false;
      }
      if (Reflect.has(updates, 'set') && !Object.is(updates.set, before.set)) {
        return false;
      }
      return true;
    }
    return false;
  }
  get value() {
    return this.#get('value');
  }
  get get() {
    return this.#get('get');
  }
  get set() {
    return this.#get('set');
  }
  get configurable() {
    return this.#attr('configurable');
  }
  get enumerable() {
    return this.#attr('enumerable');
  }
  get writable() {
    return this.#attr('writable');
  }
  #assert() {
    if (this.#get('configurable') === false) {
      throw TypeError(
        `reactive object don't support non-configurable properties yet`
      );
    }
  }
  get type() {
    if (this.#get('get')) {
      if (this.#get('set')) {
        return 'accessor';
      } else {
        return 'accessor:readonly';
      }
    }
    if (this.#get('set')) {
      return 'accessor:writer';
    }
    const readonly = this.#attr('writable') ? '' : ':readonly';
    return `value${readonly}`;
  }
  #attr(key) {
    return this.#get(key) ?? false;
  }
  #get(key) {
    if (Reflect.has(this.#descriptor, key)) {
      return Reflect.get(this.#descriptor, key);
    }
    if (!this.#before) {
      return;
    }
    if (Reflect.has(this.#before, key)) {
      return Reflect.get(this.#before, key);
    }
  }
}
function isDataProperty(descriptor) {
  return !isAccessorProperty(descriptor);
}
function isAccessorProperty(descriptor) {
  return 'get' in descriptor || 'set' in descriptor;
}
function member(prop) {
  if (typeof prop === 'symbol') {
    return `[${String(prop)}]`;
  } else {
    return `.${prop}`;
  }
}

class TrackedSet {
  static reactive(description) {
    return new TrackedSet(description);
  }
  #collection;
  #vals;
  constructor(description) {
    this.#vals = /* @__PURE__ */ new Set();
    this.#collection = Collection.create(description, this);
  }
  has(value) {
    const has = this.#vals.has(value);
    this.#collection.check(value, has ? 'hit' : 'miss', ' {value}');
    return has;
  }
  entries() {
    this.#collection.iterateKeys();
    return this.#vals.entries();
  }
  keys() {
    this.#collection.iterateKeys();
    return this.#vals.keys();
  }
  values() {
    this.#collection.iterateKeys();
    return this.#vals.values();
  }
  forEach(fn) {
    this.#collection.iterateKeys();
    this.#vals.forEach(fn);
  }
  get size() {
    this.#collection.iterateKeys();
    return this.#vals.size;
  }
  [Symbol.iterator]() {
    this.#collection.iterateKeys();
    return this.#vals[Symbol.iterator]();
  }
  get [Symbol.toStringTag]() {
    return this.#vals[Symbol.toStringTag];
  }
  add(value) {
    const has = this.#vals.has(value);
    if (has) {
      return this;
    }
    this.#collection.splice();
    this.#collection.set(value, 'key:changes', ' {value}');
    this.#vals.add(value);
    return this;
  }
  delete(value) {
    const has = this.#vals.has(value);
    if (!has) {
      return false;
    }
    this.#collection.splice();
    this.#collection.delete(value);
    return this.#vals.delete(value);
  }
  clear() {
    const hasItems = this.#vals.size > 0;
    if (!hasItems) {
      return;
    }
    this.#collection.splice();
    this.#vals.clear();
  }
}
Object.setPrototypeOf(TrackedSet.prototype, Set.prototype);
class TrackedWeakSet {
  static reactive(description) {
    return new TrackedWeakSet(description);
  }
  #collection;
  #vals;
  constructor(description) {
    this.#collection = Collection.create(description, this);
    this.#vals = /* @__PURE__ */ new WeakSet();
  }
  has(value) {
    const has = this.#vals.has(value);
    this.#collection.check(value, has ? 'hit' : 'miss', ' {value}');
    return has;
  }
  add(value) {
    const has = this.#vals.has(value);
    if (has) {
      return this;
    }
    this.#vals.add(value);
    this.#collection.set(value, 'key:changes', ' {value}');
    return this;
  }
  delete(value) {
    const has = this.#vals.has(value);
    if (!has) {
      return false;
    }
    this.#collection.delete(value);
    return this.#vals.delete(value);
  }
  get [Symbol.toStringTag]() {
    return this.#vals[Symbol.toStringTag];
  }
}
Object.setPrototypeOf(TrackedWeakSet.prototype, WeakSet.prototype);

const reactive = (target, key, _descriptor) => {
  const CELLS = /* @__PURE__ */ new WeakMap();
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: true,
    get: function () {
      let cell = CELLS.get(this);
      if (!cell) {
        cell = Cell(void 0, `@reactive ${String(key)}`);
        CELLS.set(this, cell);
      }
      return cell.current;
    },
    set: function (value) {
      let cell = CELLS.get(this);
      if (!cell) {
        cell = Cell(void 0, `@reactive ${String(key)}`);
        CELLS.set(this, cell);
      }
      cell.set(value);
    },
  });
};
reactive.Map = (description) => {
  return ReactiveMap.reactive(Object.is, Stack.description(description));
};
reactive.WeakMap = (description) => {
  return TrackedWeakMap.reactive(Stack.description(description));
};
reactive.Set = (description) => {
  return ReactiveSet.reactive(Object.is, Stack.description(description));
};
reactive.WeakSet = (description) => {
  return TrackedWeakSet.reactive(Stack.description(description));
};
reactive.object = (values, description) => {
  return TrackedObject.reactive(Stack.description(description), values);
};
reactive.array = (values, description) => {
  return new TrackedArray(Stack.description(description), values);
};

export {
  verified as A,
  verify as B,
  Cell as C,
  DEBUG_RENDERER as D,
  expected as E,
  Formula as F,
  isPresent as G,
  isEqual as H,
  ImplementationDescription as I,
  isObject as J,
  exhaustive as K,
  LIFETIME as L,
  Marker as M,
  QualifiedName as Q,
  REACTIVE as R,
  StaticDescription as S,
  TIMELINE as T,
  UNINITIALIZED as U,
  Wrapper as W,
  Renderable as a,
  Linkable as b,
  Resource as c,
  FormulaList as d,
  FormulaFn as e,
  ResourceFn as f,
  ResourceList as g,
  Reactive as h,
  CellDescription as i,
  Description as j,
  FormulaDescription as k,
  MarkerDescription as l,
  TimestampValidatorDescription as m,
  DisplayStruct as n,
  DEBUG as o,
  DEBUG_NAME as p,
  INSPECT$1 as q,
  inspector as r,
  LOGGER as s,
  LogLevel as t,
  describeModule as u,
  Stack as v,
  StackFrame as w,
  Tree as x,
  LocalName as y,
  reactive as z,
};
