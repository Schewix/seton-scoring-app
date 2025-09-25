/// <reference types="vite/client" />

declare interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_EVENT_ID: string;
  readonly VITE_STATION_ID?: string;
  readonly VITE_ADMIN_MODE?: string;
  readonly VITE_AUTH_API_URL?: string;
  readonly VITE_AUTH_BYPASS?: string;
  readonly VITE_STATION_CODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
