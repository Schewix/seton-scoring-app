declare module 'jsr:@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js';
}

declare module 'https://deno.land/std@0.224.0/csv/mod.ts' {
  export function parse(input: string): string[][];
  export function parse<T>(input: string, options: T): unknown;
}

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve: typeof import('https://deno.land/std@0.224.0/http/server.ts').serve;
};
