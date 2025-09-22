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
      EXPO_PUBLIC_SUPABASE_URL: "https://vdkbdnxkpeeqxnruwiah.supabase.co",
      EXPO_PUBLIC_SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZka2JkbnhrcGVlcXhucnV3aWFoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODUyMjAxNSwiZXhwIjoyMDc0MDk4MDE1fQ.IBjUr4baAwMOh0Bp9w1byZLclFkFF57NpMTqVy7pdJU",
      EXPO_PUBLIC_EVENT_ID: "00000000-0000-0000-0000-000000000000",
      EXPO_PUBLIC_STATION_ID: "00000000-0000-0000-0000-000000000001"
    }
  }
}
