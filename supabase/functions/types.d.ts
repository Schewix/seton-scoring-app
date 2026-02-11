declare module 'jsr:@supabase/supabase-js@2' {
  export * from 'npm:@supabase/supabase-js@2';
}

declare module 'https://deno.land/std@0.224.0/csv/mod.ts' {
  export function parse(input: string): string[][];
  export function parse<T>(input: string, options: T): unknown;
}

declare module 'https://deno.land/x/argon2@v0.3.2/mod.ts' {
  export enum ArgonType {
    Argon2d = 0,
    Argon2i = 1,
    Argon2id = 2,
  }

  export type ArgonHashOptions = {
    timeCost?: number;
    memoryCost?: number;
    parallelism?: number;
    hashLength?: number;
    salt?: string | Uint8Array;
    associatedData?: string | Uint8Array;
    type?: ArgonType;
    version?: number;
    raw?: boolean;
  };

  export function hash(
    password: string | Uint8Array,
    options?: ArgonHashOptions,
  ): Promise<string>;
}

type DenoServeHandler = (req: Request) => Response | Promise<Response>;
type DenoServeOptions = {
  port?: number;
  signal?: AbortSignal;
};

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve: (handler: DenoServeHandler, options?: DenoServeOptions) => Promise<void>;
};
