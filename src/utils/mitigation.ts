import axios from 'axios';
import { IBotStorage } from 'forta-bot-analytics';

type ManuallyRemovedFinding<T> = T & {
  removedAt: number;
};

type AlertMitigationStorage<T> = {
  removedFindings: ManuallyRemovedFinding<T>[];
};

export class AlertMitigation<T> {
  private readonly key: string = 'alert-manager';
  private readonly version: string = 'V1';
  private readonly storage: IBotStorage<AlertMitigationStorage<T>>;
  private readonly chainId: number;
  private readonly getHash: (item: T) => string;

  private readonly falseFindingsUrl?: string;

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
  }

  public async getFalseFindings(): Promise<T[]> {
    const falseFindings = await this.fetchFalseFindings();
    const removedFindings = await this.fetchRemovedFindings();

    const removedFindingsMap = new Map(removedFindings.map((f) => [this.getHash(f), f]));

    return falseFindings.filter((i) => !removedFindingsMap.has(this.getHash(i)));
  }

  public async markFindingsAsRemoved(findings: T[]) {
    const response = await this.storage.load(this.storageKey);
    const fixedFindings = response?.removedFindings || [];
    await this.storage.save(this.storageKey, {
      ...response,
      removedFindings: [
        ...fixedFindings,
        ...findings.map((f) => ({ ...f, removedAt: Date.now() })),
      ],
    });
  }

  public async optimizeStorage() {
    const falseFindings = await this.fetchFalseFindings();
    const storageState = await this.storage.load(this.storageKey);

    const falseFindingsMap = new Map(falseFindings.map((f) => [this.getHash(f), f]));

    const removedFindings = storageState?.removedFindings || [];
    const notPresentRemovedFindings = removedFindings.filter(
      (f) => !falseFindingsMap.has(this.getHash(f)),
    );

    const notPresentRemovedFindingsMap = new Map(
      notPresentRemovedFindings.map((f) => [this.getHash(f), f]),
    );

    await this.storage.save(this.storageKey, {
      ...storageState,
      removedFindings: removedFindings.filter(
        (f) => !notPresentRemovedFindingsMap.has(this.getHash(f)),
      ),
    });
  }

  private async fetchFalseFindings(): Promise<T[]> {
    if (!this.falseFindingsUrl) return [];

    const { data } = await axios.get(this.falseFindingsUrl);
    return data || [];
  }

  private async fetchRemovedFindings(): Promise<ManuallyRemovedFinding<T>[]> {
    const response = await this.storage.load(this.storageKey);
    return response?.removedFindings || [];
  }

  public get storageKey() {
    return `${this.key}-${this.chainId}-${this.version}`;
  }
}
