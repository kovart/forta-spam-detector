import axios from 'axios';
import { uniqBy } from 'lodash';
import { IBotStorage } from 'forta-bot-analytics';
import Logger from './logger';

type ManuallyRemovedFinding<T> = T & {
  removedAt: number;
};

type AlertMitigationStorage<T> = {
  removedFindings: ManuallyRemovedFinding<T>[];
};

export class AlertMitigation<T> {
  private readonly key: string = 'alert-manager';
  private readonly version: string = 'V1.5';
  private readonly storage: IBotStorage<AlertMitigationStorage<T>>;
  private readonly chainId: number;
  private readonly getHash: (item: T) => string;

  private readonly falseFindingsUrl?: string;

  // In case there are problems with the server
  private localStorageCache: AlertMitigationStorage<T> | null;

  constructor(params: {
    storage: IBotStorage<AlertMitigationStorage<T>>;
    getHash: (item: T) => string;
    chainId: number;
    falseFindingsUrl?: string;
  }) {
    this.storage = params.storage;
    this.chainId = params.chainId;
    this.falseFindingsUrl = params.falseFindingsUrl;
    this.getHash = params.getHash;
    this.localStorageCache = null;
  }

  public async getFalseFindings(): Promise<T[]> {
    const chainId = this.chainId;
    const falseFindingsByChainId = await this.fetchFalseFindingsMap();
    const falseFindings = falseFindingsByChainId[chainId] || [];
    const removedFindings = await this.fetchRemovedFindings();
    const removedFindingsHashSet = new Set(removedFindings.map((f) => this.getHash(f)));

    return falseFindings.filter((i) => !removedFindingsHashSet.has(this.getHash(i)));
  }

  public async markFindingsAsRemoved(findings: T[]) {
    const storageState = await this.storage.load(this.storageKey);
    const oldRemovedFindings = storageState?.removedFindings || [];
    const newRemovedFindings = uniqBy(
      [...oldRemovedFindings, ...findings.map((f) => ({ ...f, removedAt: Date.now() }))],
      (i) => this.getHash(i),
    );

    const newStorageState = {
      ...storageState,
      removedFindings: newRemovedFindings,
    };

    this.localStorageCache = newStorageState;
    await this.storage.save(this.storageKey, newStorageState);
  }

  public async optimizeStorage() {
    const storageState = await this.storage.load(this.storageKey);
    const falseFindingsByChainId = await this.fetchFalseFindingsMap();
    const removedFindings = storageState?.removedFindings || [];

    const newStorageState: AlertMitigationStorage<T> = {
      ...storageState,
      removedFindings: [],
    };

    for (const chainId of Object.keys(falseFindingsByChainId)) {
      if (Number(chainId) !== this.chainId) continue;

      const falseFindings = falseFindingsByChainId[chainId] || [];
      const falseFindingsHashSet = new Set(falseFindings.map((f) => this.getHash(f)));
      const notPresentRemovedFindingsSet = new Set(
        removedFindings
          .filter((f) => !falseFindingsHashSet.has(this.getHash(f)))
          .map((f) => this.getHash(f)),
      );

      Logger.warn(
        `[AlertManager] Removed ${notPresentRemovedFindingsSet.size} findings from cache since as they are no longer present in the url of false findings`,
      );

      newStorageState.removedFindings = removedFindings.filter(
        (f) => !notPresentRemovedFindingsSet.has(this.getHash(f)),
      );
    }

    this.localStorageCache = newStorageState;
    await this.storage.save(this.storageKey, newStorageState);
  }

  private async fetchFalseFindingsMap(): Promise<{ [chainId: string]: T[] }> {
    if (!this.falseFindingsUrl) return {};

    const { data } = await axios.get(this.falseFindingsUrl);
    return data || {};
  }

  private async fetchRemovedFindings(): Promise<ManuallyRemovedFinding<T>[]> {
    const storageState = await this.storage.load(this.storageKey);

    return [
      ...(this.localStorageCache?.removedFindings || []),
      ...(storageState?.removedFindings || []),
    ];
  }

  public get storageKey() {
    return `${this.key}-${this.chainId}-${this.version}`;
  }
}
