/// <reference types="vite/client" />

declare interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_EVENT_ID: string;
  readonly VITE_STATION_ID?: string;
  readonly VITE_ADMIN_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
