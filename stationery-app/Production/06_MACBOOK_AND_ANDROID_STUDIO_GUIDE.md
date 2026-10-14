# Complete Local Deployment Guide: MacBook Backend + Android Studio (Pixel 6 API 33)

This step-by-step guide walks you through setting up and running the entire **Stationery Shop Management System** locally on your **MacBook**, starting the **Node.js + MySQL backend**, and launching the frontend mobile app inside **Android Studio** on your **Pixel 6 API 33** virtual device (emulator).

---

## 1. System Architecture on MacBook

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Your MacBook (Host Machine)                     │
│                                                                        │
│   ┌──────────────────────────┐         ┌───────────────────────────┐   │
│   │     MySQL 8.0 Engine     │         │   Node.js / Express API   │   │
│   │   127.0.0.1:3306         │ ◄─────► │   http://localhost:3000   │   │
│   │   Database: `stationery` │         │   (Local REST Backend)    │   │
│   └──────────────────────────┘         └─────────────┬─────────────┘   │
│                                                      ▲                 │
│                                                      │                 │
│                     Special Loopback Route: 10.0.2.2 │                 │
│                                                      ▼                 │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │           Android Studio Emulator: Pixel 6 (API 33)            │   │
│   │                                                                │   │
│   │   ┌────────────────────────────────────────────────────────┐   │   │
│   │   │   Stationery Shop Mobile App (Capacitor + Angular)     │   │   │
│   │   │   - API URL: http://10.0.2.2:3000/api                  │   │   │
│   │   │   - On-Device Native SQLite Storage                    │   │   │
│   │   └────────────────────────────────────────────────────────┘   │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

### The Golden Rule of Android Emulator Networking
Inside the Android emulator (`Pixel 6 API 33`):
- `http://localhost:3000` points to the **emulator's own internal Android OS**, NOT your MacBook!
- The Android emulator router provides a virtual alias: **`10.0.2.2`**, which maps directly to `127.0.0.1` (localhost) of your MacBook.
- Therefore, the mobile app inside the emulator connects to the backend at:  
  👉 **`http://10.0.2.2:3000/api`**

---

## 2. Phase 1: MacBook Prerequisites & Environment Setup

Open Terminal on your Mac and verify the required developer tools.

### Step 1.1: Ensure Node.js (20+ LTS) and npm are installed
```bash
node -v   # Should output v20.x or newer
npm -v
```

### Step 1.2: Install Java JDK 21 (Mandatory for Capacitor 8)
Capacitor's Android modules (specifically `@capacitor/filesystem`) require Java 21:

```bash
# Install Eclipse Temurin JDK 21 via Homebrew
brew install --cask temurin@21

# Set JAVA_HOME in your current session (add this to ~/.zshrc for permanence)
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
java -version   # Must output openjdk version "21.x.x"
```

### Step 1.3: Install Ionic CLI globally
```bash
npm install -g @ionic/cli
```

### Step 1.4: Install & Start MySQL 8 via Homebrew
```bash
brew install mysql
brew services start mysql   # Starts MySQL daemon automatically
```

---

## 3. Phase 2: Backend Setup & Database Seeding on macOS

### Step 2.1: Initialize the MySQL Database & User
Navigate to the backend directory:
```bash
cd /Users/parmarpratham/Desktop/mystore/stationery-app/backend
```

Run the automated database setup script:
```bash
./setup-db.sh
```
*(If your root MySQL account has a password, run: `./setup-db.sh -p`)*

This creates:
- Database: `stationery` (UTF8mb4)
- User: `stationery` with password `stationery123`
- Full privileges granted to `stationery`@`localhost`

### Step 2.2: Verify the `.env` Configuration
Inspect your `stationery-app/backend/.env` file:
```bash
cat .env
```
Ensure it contains:
```env
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=stationery
DB_PASSWORD=stationery123
DB_NAME=stationery
JWT_SECRET=dev-local-secret-2f9c1a7e4b8d3f6a0c5e2b9d7f1a4c8e6b3d0f2a
JWT_EXPIRES_IN=30d
CORS_ORIGINS=http://localhost:8100,capacitor://localhost,http://localhost,https://localhost
```

### Step 2.3: Install Backend Dependencies and Run Seed
```bash
npm install
npm run seed
```
**Expected Output**:
`Seed complete: schema ensured, admin/admin123 ready.`

### Step 2.4: Start the Backend Server
```bash
npm run dev
```
**Expected Output**:
`Stationery backend listening on http://localhost:3000/api`

### Step 2.5: Verify Backend Health (In a new Terminal tab)
```bash
curl http://localhost:3000/api/health
```
**Expected Output**:
`{"status":"ok"}`

---

## 4. Phase 3: Configure Frontend for Android Emulator

Keep the backend running in Terminal 1. Open a new Terminal window for the frontend commands.

### Step 3.1: Set the API URL to `10.0.2.2`
Open `stationery-app/src/environments/environment.ts` and set `apiUrl` to point to the emulator gateway:

```typescript
export const environment = {
  production: false,
  // 10.0.2.2 routes directly to your MacBook localhost:3000 from the emulator:
  apiUrl: 'http://10.0.2.2:3000/api',
  lowStockThreshold: 5,
  company: {
    name: 'Shree Sales Agency',
    gstNo: '24AIVPR6534P1Z8',
  },
};
```

### Step 3.2: Verify Android Network Security Config
The project already allows cleartext HTTP calls to `10.0.2.2` in `android/app/src/main/res/xml/network_security_config.xml`:
```xml
<domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">10.0.2.2</domain>
    <domain includeSubdomains="true">localhost</domain>
    <domain includeSubdomains="true">127.0.0.1</domain>
</domain-config>
```
And `capacitor.config.ts` includes `server.androidScheme: 'http'`.

### Step 3.3: Build the Frontend & Sync to Android
In the `stationery-app` root directory:
```bash
cd /Users/parmarpratham/Desktop/mystore/stationery-app

# 1. Install frontend dependencies
npm install

# 2. Build the Angular web application
ionic build

# 3. Copy built web assets and update Android native plugin bindings
npx cap sync android
```

---

## 5. Phase 4: Launching on Android Studio (Pixel 6 API 33)

You can launch the app using the **Android Studio Graphical Interface (Recommended)** or via the **Command Line**.

### Method A: Using Android Studio IDE (Recommended)

1. **Launch Android Studio with the project**:
   ```bash
   cd /Users/parmarpratham/Desktop/mystore/stationery-app
   npx cap open android
   ```
   *(This launches Android Studio and opens the `/android` folder).*

2. **Wait for Gradle Sync to Complete**:
   - Check the bottom status bar in Android Studio until Gradle build finishes indexing (approx. 1–2 minutes on first run).
   - If prompted by Android Studio to configure JDK, ensure **JDK 21** is selected under `Settings` -> `Build, Execution, Deployment` -> `Build Tools` -> `Gradle` -> `Gradle JDK`.

3. **Select your Target Device**:
   - In the top toolbar device selector dropdown, locate and click:  
     **`Pixel 6 API 33`** (or `Pixel 6` under Running Devices / Device Manager).

4. **Launch the Emulator & Run App**:
   - Click the green **Run** button (▶ Play icon) in the top toolbar or press `Shift + F10`.
   - Android Studio will boot the **Pixel 6 API 33** emulator, compile the debug APK, install it, and start the app automatically.

---

### Method B: Using Terminal CLI Only

If you prefer launching directly from the terminal without using the Android Studio GUI:

1. **Start the Pixel 6 Emulator in the background**:
   ```bash
   ~/Library/Android/sdk/emulator/emulator -avd Pixel_6 &
   ```
   Wait for the virtual phone to fully boot to its home screen.

2. **Deploy and Run via Capacitor**:
   ```bash
   cd /Users/parmarpratham/Desktop/mystore/stationery-app
   npx cap run android --target="Pixel_6"
   ```

3. **Alternative: Build and install using Gradle CLI**:
   ```bash
   cd /Users/parmarpratham/Desktop/mystore/stationery-app/android
   export JAVA_HOME=$(/usr/libexec/java_home -v 21)
   ./gradlew installDebug
   adb shell am start -n com.mystore.stationery/.MainActivity
   ```

---

## 6. Phase 5: Verification & Testing in the Emulator

Once the app opens on your **Pixel 6 API 33** screen:

1. **Sign In**:
   - **Username**: `admin`
   - **Password**: `admin123`
   - Tap **Sign In**. The app calls `http://10.0.2.2:3000/api/auth/login`, stores the JWT in native storage, and opens the **Dashboard**.

2. **Check Sync Status**:
   - Observe the top right header icon:
     - ☁️ **Cloud with Checkmark**: Connected to MacBook backend and in sync.
     - 🔄 **Spinning Icon**: Actively syncing queued records.
     - ⚠️ **Offline Banner**: App cannot reach `http://10.0.2.2:3000`. Verify `npm run dev` is running on your Mac.

3. **Test Billing & Printing**:
   - Go to the **Billing** tab.
   - Search for an item (or select a category chip) and tap to add to cart.
   - Enter Customer Name (e.g., `Test Customer`).
   - Toggle **GST Invoice** to inspect the live SGST/CGST tax calculations.
   - Tap **Generate Bill & Print**.
   - Tap **Share / Print Invoice** to trigger the native Android PDF share sheet.

4. **Test True Offline Billing**:
   - On the Pixel 6 emulator, swipe down the notification shade and enable **Airplane Mode**.
   - Notice the yellow top banner immediately activates:  
     `"Offline — changes will sync when internet is back"`.
   - Generate 2 new bills and create a new item. The app responds instantly from local SQLite.
   - Disable **Airplane Mode**.
   - Within seconds, `SyncService` wakes up, uploads all pending actions to your MacBook backend, and replaces the temporary local IDs with real server invoice numbers!

---

## 7. Troubleshooting & FAQ

### Issue 1: "Cannot find a Java installation matching JDK 21"
- **Cause**: Capacitor 8's Android build requires Java 21. macOS default may be Java 17 or older.
- **Solution**:
  ```bash
  brew install --cask temurin@21
  export JAVA_HOME=$(/usr/libexec/java_home -v 21)
  ```
  In Android Studio: Go to **Settings / Preferences** -> **Build, Execution, Deployment** -> **Build Tools** -> **Gradle** -> Set **Gradle JDK** to `temurin-21`.

### Issue 2: App shows "Could not reach the server. Check your connection." on Login
- **Check 1**: Is your backend running? Open a browser tab on your Mac and test: `http://localhost:3000/api/health`.
- **Check 2**: Did you set `apiUrl` to `http://10.0.2.2:3000/api` in `src/environments/environment.ts`? If you left it as `localhost:3000`, the emulator cannot connect.
- **Check 3**: Did you re-run `ionic build && npx cap sync android` after editing `environment.ts`? Code changes must be synced to the native folder.

### Issue 3: Barcode Scanner in the Android Emulator
- **Behavior**: The emulator lacks a physical hardware camera lens.
- **Solution**: In the emulator's Extended Controls (the `...` button on emulator toolbar), go to **Camera** -> set **Back Camera** to **Virtual Scene**. Point the camera at a test barcode image on your computer screen, or tap **"Choose from Gallery"** inside the app to pick an image containing a barcode.

### Issue 4: MySQL Access Denied for User 'stationery'
- **Solution**:
  ```bash
  mysql -u root -e "ALTER USER 'stationery'@'localhost' IDENTIFIED BY 'stationery123'; FLUSH PRIVILEGES;"
  ```
