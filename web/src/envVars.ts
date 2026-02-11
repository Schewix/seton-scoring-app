export const env = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL as string,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  VITE_EVENT_ID: import.meta.env.VITE_EVENT_ID as string | undefined,
  VITE_STATION_ID: import.meta.env.VITE_STATION_ID as string | undefined,
  VITE_ADMIN_MODE: import.meta.env.VITE_ADMIN_MODE as string | undefined,
  VITE_AUTH_API_URL: import.meta.env.VITE_AUTH_API_URL as string | undefined,
  VITE_AUTH_BYPASS: import.meta.env.VITE_AUTH_BYPASS as string | undefined,
  VITE_AUTH_BYPASS_TOKEN: import.meta.env.VITE_AUTH_BYPASS_TOKEN as string | undefined,
  VITE_AUTH_BYPASS_PATROLS: import.meta.env.VITE_AUTH_BYPASS_PATROLS as string | undefined,
};
