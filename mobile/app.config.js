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
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZka2JkbnhrcGVlcXhucnV3aWFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1MjIwMTUsImV4cCI6MjA3NDA5ODAxNX0.FAQ_mCZYnrKqhsOdeZR55kfErJ-RpO9IawJC70hYZM4",
      EXPO_PUBLIC_EVENT_ID: "192b9c16-0747-4b62-949b-2bd5ec1c7730",
      EXPO_PUBLIC_STATION_ID: "cca45c48-f2d2-4feb-9e23-052ffcc697df"
    },
    plugins: ["expo-barcode-scanner"]
  }
}
