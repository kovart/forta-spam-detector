import { utils } from 'ethers';

import Logger from './logger';

interface CacheValue<T> {
  value: T;
  thrown: boolean;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class Cache<T extends unknown = unknown> {
  private entryMap = new Map<string, CacheEntry<T>>();

  public set(key: string, value: T, ttl: number): void {
    const expiresAt = Date.now() + ttl;
    this.entryMap.set(key, { value, expiresAt });
  }

  public has(key: string): boolean {
    if (!this.entryMap.has(key)) return false;

    const entry = this.entryMap.get(key)!;

    if (Date.now() < entry.expiresAt) {
      return true;
    } else {
      this.entryMap.delete(key);
      return false;
    }
  }

  public get(key: string): T | undefined {
    const entry = this.entryMap.get(key);

    if (!entry) return;

    if (Date.now() < entry.expiresAt) {
      return entry.value;
    } else {
      this.entryMap.delete(key);
    }
  }

  // A special function to use with has()
  public unsafeGet(key: string): T {
    return this.entryMap.get(key)!.value as T;
  }

  public clearExpired(): void {
    const now = Date.now();
    this.entryMap.forEach((value, key) => {
      if (value.expiresAt < now) {
        this.entryMap.delete(key);
      }
    });
  }
}

type QueryOpts = { ttl: number };
type QueryArgument = number | string;

class Memoizer {
  protected scopeByKey = new Map<string, Cache<CacheValue<unknown>>>();

  getScope(scopeKey = '') {
    let scope = this.scopeByKey.get(scopeKey);

    if (!scope) {
      scope = new Cache();
      this.scopeByKey.set(scopeKey, scope);
    }

    const memoFn = this.bindQuery(scopeKey);

    type ScopeInstance = typeof memoFn & {
      get<P>(key: string): P | undefined;
      set(key: string, value: any): void;
    };

    const instance = memoFn as ScopeInstance;

    instance.set = (key: string, value: any, ttl?: number) => this.set(scopeKey, key, value, ttl);
    instance.get = (key: string) => this.get(scopeKey, key);

    return instance;
  }

  deleteScope(key = '') {
    this.scopeByKey.delete(key);
  }

  bindQuery(scopeKey: string) {
    // Unfortunately, TypeScript loses function overloading after applying bind() with the first parameter passed.
    // To fix this, we define the overloading manually.
    return this.query.bind(this).bind(this, scopeKey) as {
      <TResult>(queryKey: string, queryFn: () => TResult): TResult;
      <TResult, TArgs extends QueryArgument[]>(
        queryKey: string,
        queryArgs: TArgs,
        queryFn: () => TResult,
      ): TResult;
      <TResult, TArgs extends QueryArgument[]>(
        queryKey: string,
        opts: QueryOpts,
        queryFn: () => TResult,
      ): TResult;
      <TResult, TArgs extends QueryArgument[]>(
        queryKey: string,
        queryArgs: TArgs,
        opts: QueryOpts,
        queryFn: () => TResult,
      ): TResult;
    };
  }

  protected query<TResult, TArgs extends QueryArgument[]>(...args: any[]): TResult {
    let scopeKey: string;
    let queryKey: string;
    let queryArgs: TArgs = [] as any as TArgs;
    let opts: { ttl: number } = { ttl: Infinity };
    let queryFn: () => TResult;

    if (args.length === 3) {
      scopeKey = args[0];
      queryKey = args[1];
      queryFn = args[2];
    } else if (args.length === 4) {
      scopeKey = args[0];
      queryKey = args[1];
      if (Array.isArray(args[2])) {
        queryArgs = args[2] as TArgs;
      } else {
        opts = args[2];
      }
      queryFn = args[3];
    } else if (args.length === 5) {
      scopeKey = args[0];
      queryKey = args[1];
      queryArgs = args[2];
      opts = args[3];
      queryFn = args[4];
    } else {
      throw new Error("Number of arguments doesn't match the function signature");
    }

    const { ttl } = opts;
    const scope = this.scopeByKey.get(scopeKey);

    if (!scope) throw new Error(`Scope hasn't been initialized`);

    const key = [queryKey, ...queryArgs].join('.');
    const hash = utils.keccak256(utils.defaultAbiCoder.encode(['string'], [key])).slice(2);

    Logger.trace(`Querying key: ${key} (${hash.slice(0, 10)}...)`);

    // undefined is also a valid value
    if (scope.has(hash)) {
      const result = scope.unsafeGet(hash);
      if (result.thrown) {
        throw result.value;
      } else {
        return result.value as TResult;
      }
    }

    try {
      const result = queryFn();
      if (!(result instanceof Promise)) {
        scope.set(hash, { value: result, thrown: false }, ttl);
        return result as TResult;
      }

      return result
        .then((result) => {
          scope.set(hash, { value: result, thrown: false }, ttl);
          return result;
        })
        .catch((e) => {
          scope.set(hash, { value: e, thrown: true }, ttl);
          return e;
        }) as TResult;
    } catch (e) {
      scope.set(hash, { value: e, thrown: true }, ttl);
      throw e;
    }
  }

  protected get<P>(scopeKey: string, key: string) {
    return this.scopeByKey.get(scopeKey)!.get(key)?.value as P | undefined;
  }

  protected set<P>(scopeKey: string, key: string, value: P, ttl = Infinity): void {
    this.scopeByKey.get(scopeKey)!.set(key, { value, thrown: false }, ttl);
  }
}

export default Memoizer;
