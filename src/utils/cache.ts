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

  getScope(key = '') {
    let scope = this.scopeByKey.get(key);

    if (!scope) {
      scope = new Cache();
      this.scopeByKey.set(key, scope);
    }

    return this.bindQuery(key);
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
      if (typeof args[2] === 'object') {
        opts = args[2];
      } else {
        queryArgs = args[2];
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

    const hash = [queryKey, ...queryArgs].join('.');

    // undefined is also a valid value
    if (scope.has(hash)) {
      const result = scope.get(hash)!;
      if (result.thrown) {
        throw result;
      } else {
        return result as TResult;
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
}

export default Memoizer;
