import type { SpawnSyncReturns } from 'node:child_process';
import { execSync } from 'node:child_process';
import pc from 'picocolors';

type ChainableGetter<Keys extends string, T extends Record<string, any>> = {
  readonly [K in Keys]: ChainableGetter<Keys, T> & T;
};
type PackageManager = 'npm' | 'yarn' | 'pnpm';
type LogOption = Partial<{ out: boolean; err: boolean }>;
type ExecOptions = Partial<{ debugCommand: boolean; log: boolean | LogOption }>;
type ExecResult = {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
};

const isLogEnabled = (x: unknown, key: string): x is boolean | LogOption => {
  if (typeof x === 'boolean') return x;
  if (typeof x === 'object' && !!x) return x[key as never];

  return false;
};

export class Runner {
  protected exec(cmd: string, options: ExecOptions = {}): ExecResult {
    if (options.debugCommand ?? true) {
      // Escape % when there is formatting applied as part of the command
      // Git log format strings often contain % characters via `--pretty=format:` syntax.
      const safeCmd = cmd.replace(/%/g, '%%');

      console.log(`> ${pc.magentaBright(safeCmd)}`, '\n');
    }

    const logOptions = options.log ?? { out: true, err: true };

    try {
      const stdout = execSync(cmd, {
        encoding: 'utf-8', // gives you a string instead of a Buffer
        stdio: 'pipe', // default; ensures capture, no live printing
        shell: 'bash',
      });

      if (isLogEnabled(logOptions, 'out')) {
        console.log(stdout);
      }

      return {
        ok: true,
        code: 0,
        stdout,
        stderr: '',
      };
    } catch (err) {
      const result = err as SpawnSyncReturns<string>;
      const stdout = result.stdout?.toString() ?? '';
      const stderr = result.stderr?.toString() ?? '';

      if (stdout && isLogEnabled(logOptions, 'out')) {
        console.log(stdout);
      }
      if (stderr && isLogEnabled(logOptions, 'err')) {
        console.error(stderr);
      }

      return {
        ok: false,
        code: result.status ?? 1,
        stdout,
        stderr,
      };
    }
  }
}

export class CommandBuilder<
  Main extends string,
  Subs extends string,
  Flags extends string = string,
> extends Runner {
  #parts: Array<Main | Subs | Flags | (string & {})> = [];
  #main: Main;
  #pkgMng: PackageManager | false;

  constructor(config: {
    main: Main;
    sub: Subs[];
    flags?: Flags[];
    packageManager?: PackageManager | false;
  }) {
    super();
    this.#main = config.main;
    this.#pkgMng = config.packageManager ?? 'pnpm';
    this.reset();

    config.sub.forEach((subCmd) => {
      Object.defineProperty(this, subCmd, {
        get() {
          this.#parts.push(subCmd);
          return this;
        },
        configurable: false,
        enumerable: true,
      });
    });
  }

  run(arg1: Array<Flags>, options?: ExecOptions): ExecResult;
  run(...args: Array<Flags>): ExecResult;
  run(...args: unknown[]): ExecResult {
    const cmd = [];
    let options: ExecOptions = {};

    if (
      Array.isArray(args[0]) &&
      (typeof args[1] === 'boolean' || typeof args[1] === 'object')
    ) {
      cmd.push(...this.#parts, ...args[0]);
      options = args[1] as ExecOptions;
    } else {
      cmd.push(...this.#parts, ...args);
    }

    this.reset();

    return this.exec(cmd.flat().join(' '), options);
  }

  reset() {
    if (!this.#pkgMng) {
      this.#parts = [this.#main];
    } else {
      this.#parts = [this.#pkgMng, this.#main];
    }
  }
}

export const createCommand = <
  Main extends string,
  Subs extends string,
  Flags extends string = string,
>(
  ...args: ConstructorParameters<typeof CommandBuilder<Main, Subs, Flags>>
) => {
  const builder = new CommandBuilder(...args);

  return builder as ChainableGetter<Main | Subs, typeof builder>;
};

type FlagsRaw = `--${string}`;
type Flags<T extends string> = T extends `--${infer F}` ? F : never;

export class ProcessState<K extends FlagsRaw = FlagsRaw> {
  flags = {} as Record<Flags<K>, boolean>;

  constructor(...keys: K[]) {
    const args = process.argv.slice(2);

    keys.forEach((key) => {
      const formattedKey = key.replace(/^--/, '') as Flags<K>;
      this.flags[formattedKey] = args.includes(key);
    });
  }
}
