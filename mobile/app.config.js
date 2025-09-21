export default {
  expo: {
    name: "Seton Scoring",
    slug: "seton-scoring",
    scheme: "seton",
    version: "0.1.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff"
    },
    ios: { supportsTablet: true },
    android: { adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#ffffff" } },
    web: { bundler: "metro" },
    extra: {
      EXPO_PUBLIC_SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "YOUR-ANON-KEY",
      EXPO_PUBLIC_EVENT_ID: "00000000-0000-0000-0000-000000000000",
      EXPO_PUBLIC_STATION_ID: "00000000-0000-0000-0000-000000000001"
    }
  }
}
