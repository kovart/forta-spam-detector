/* eslint-disable no-async-promise-executor */
import fs from 'fs';
import path from 'path';
import { format, writeToPath } from '@fast-csv/format';
import { parse } from '@fast-csv/parse';

export type Stringify<T> = {
  [key in keyof T]: string;
};

export type Textify<T> = {
  [key in keyof T]: string | number;
};

export async function exists(filePath: string) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function mkdir(path: string) {
  try {
    await fs.promises.mkdir(path, { recursive: true });
  } catch {}
}

export async function rmFile(path: string) {
  try {
    await fs.promises.rm(path);
  } catch {}
}

export abstract class BaseStorage<P> {
  protected constructor(public folderPath: string, public fileName: string) {}

  public async delete(): Promise<void> {
    await rmFile(this.filePath);
  }

  protected async createFolder() {
    await fs.promises.mkdir(this.folderPath, { recursive: true });
  }

  protected get filePath() {
    return path.resolve(this.folderPath, this.fileName);
  }

  abstract read(): Promise<P | null>;
  abstract write(item: P): Promise<void>;
}

export class CsvStorage<R extends object, W = R> {
  public readonly filePath: string;
  public readonly ext = '.csv';

  constructor(
    public readonly distPath: string,
    public readonly fileName: string,
    protected readonly onRead: (row: Stringify<W>) => R,
    protected readonly onWrite: (row: R) => Textify<W>,
  ) {
    this.filePath = path.resolve(distPath, fileName.replace(this.ext, '') + this.ext);
  }

  public async read(): Promise<R[]> {
    if (!(await this.exists(this.filePath))) {
      return [];
    }

    return new Promise((res, rej) => {
      const data: R[] = [];

      const readStream = fs.createReadStream(this.filePath, {
        encoding: 'utf-8',
      });
      const csvStream = parse({ headers: true })
        .on('data', (row) => {
          data.push(this.onRead(row));
        })
        .on('end', () => res(data))
        .on('error', rej);

      readStream.pipe(csvStream);
    });
  }

  public async append(row: R | R[]): Promise<void> {
    const rows = Array.isArray(row) ? row : [row];

    return new Promise(async (res, rej) => {
      await this.mkdir();

      const fileExists = await this.exists();

      const writeStream = fs.createWriteStream(this.filePath, {
        encoding: 'utf-8',
        flags: 'a',
      });
      const csvStream = format({
        headers: !fileExists,
        includeEndRowDelimiter: true,
      });
      csvStream.pipe(writeStream);

      rows.forEach((row) => csvStream.write(this.onWrite(row)));

      writeStream.on('finish', res);
      writeStream.on('error', rej);

      csvStream.end();
    });
  }

  public async stream(
    fn: (params: { append: (row: R) => void; end: () => void }) => void,
  ): Promise<void> {
    return new Promise(async (res, rej) => {
      await this.mkdir();

      const fileExists = await this.exists();

      const writeStream = fs.createWriteStream(this.filePath, {
        encoding: 'utf-8',
        flags: 'a',
      });

      const csvStream = format({
        headers: !fileExists,
        includeEndRowDelimiter: true,
      });
      csvStream.pipe(writeStream);

      writeStream.on('finish', res);
      writeStream.on('error', rej);

      fn({
        append: (row) => csvStream.write(this.onWrite(row)),
        end: () => csvStream.end(),
      });
    });
  }

  public async write(rows: R[]): Promise<void> {
    return new Promise(async (res, rej) => {
      await this.mkdir();

      if (await this.exists()) {
        await this.delete();
      }

      const writeStream = writeToPath(this.filePath, rows, {
        headers: true,
        includeEndRowDelimiter: true,
        transform: this.onWrite,
      });

      writeStream.on('finish', res);
      writeStream.on('error', rej);
    });
  }

  protected async mkdir() {
    await mkdir(this.distPath);
  }

  public async delete() {
    await rmFile(this.filePath);
  }

  public async exists(filePath: string = this.filePath) {
    return await exists(filePath);
  }
}

export class JsonStorage<P> extends BaseStorage<P> {
  constructor(public folderPath: string, public fileName: string) {
    super(folderPath, fileName);
  }

  async write(data: P): Promise<void> {
    await this.createFolder();
    const str = JSON.stringify(data);
    await fs.promises.writeFile(this.filePath, str, { encoding: 'utf-8' });
  }

  async read(): Promise<P | null> {
    if (!(await exists(this.filePath))) {
      return null;
    }

    const str = await fs.promises.readFile(this.filePath, {
      encoding: 'utf-8',
    });
    return JSON.parse(str);
  }
}
