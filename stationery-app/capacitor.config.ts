import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mystore.stationery',
  appName: 'Stationery Shop',
  webDir: 'www',
  server: {
    // Serve the Android webview over http:// (not the default https://) so the app can call
    // the local http backend without a Mixed-Content block. Dev-only; for a production HTTPS
    // backend, remove this and keep the default https scheme.
    androidScheme: 'http',
  },
};

export default config;
