// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  // Android emulator reaches the host Mac at 10.0.2.2 (not localhost).
  // For browser dev (ionic serve / ng serve) change this back to http://localhost:3000/api.
//   apiUrl: 'http://10.0.2.2:3000/api',
  apiUrl: 'http://kali-pc.tail0f71f2.ts.net/api',
  lowStockThreshold: 5,
  // Your company details, printed on every bill / invoice. The full GST seller profile
  // (address, state code, bank, etc.) is editable in Settings and stored via SellerConfigService;
  // these are the fallback seed values.
  company: {
    name: 'Shree Sales Agency',
    gstNo: '24AIVPR6534P1Z8',
  },
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
