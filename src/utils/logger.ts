export enum LoggerLevel {
  DEBUG,
  INFO,
  WARN,
  ERROR,
}

class Logger {
  static level: LoggerLevel = LoggerLevel.DEBUG;

  private args: any[] = [];

  public constructor(args?: any[]) {
    if (args) {
      this.args.push(...args);
    }
  }

  public debug = (...args: any[]) => {
    this._log(args, LoggerLevel.DEBUG);
  };

  public info = (...args: any[]) => {
    this._log(args, LoggerLevel.INFO);
  };

  public warn = (...args: any[]) => {
    this._log(args, LoggerLevel.WARN);
  };

  public error = (...args: any[]) => {
    this._log(args, LoggerLevel.ERROR);
  };

  private _log = (args: any[], level: LoggerLevel) => {
    if (level < Logger.level) return;

    console.log(...this.args, ...args);
  };

  public scope(...args: any[]) {
    return new Logger([...this.args, ...args]);
  }
}

export default new Logger();
