# Papan Kegiatan Tim

Kalender kegiatan tim yang terhubung real-time ke Firestore, diisi lewat WhatsApp (via WAHA + n8n) dan bisa juga dikelola langsung dari web ini.

## 1. Coba dulu di komputer sendiri

```bash
npm install
```

Isi `src/firebase.js` dengan config Firebase Anda (lihat bagian bawah), lalu:

```bash
npm run dev
```

Buka alamat yang muncul di terminal (biasanya `http://localhost:5173`).

## 2. Ambil config Firebase Anda

1. Buka [Firebase Console](https://console.firebase.google.com) → pilih project `botskedul`
2. Klik ikon gerigi (⚙️) → **Project Settings**
3. Scroll ke bagian **"Your apps"**
   - Kalau belum ada Web app, klik ikon `</>` untuk membuat satu (nama bebas, tidak perlu centang Firebase Hosting)
4. Salin object `firebaseConfig` yang muncul, tempelkan ke `src/firebase.js` menggantikan nilai `GANTI_DENGAN_...`

## 3. Terapkan Firestore Security Rules

1. Buka Firebase Console → **Firestore Database** → tab **Rules**
2. Salin isi file `firestore.rules` di project ini, tempelkan menggantikan isi yang ada
3. Klik **Publish**

(Baca catatan keamanan di dalam file `firestore.rules` — rules ini terbuka untuk tim kecil, bisa ditingkatkan pakai Login nanti kalau perlu.)

## 4. Deploy ke GitHub Pages

1. Buat repository baru di GitHub, push semua isi folder ini ke branch `main`
2. Edit `vite.config.js` — ganti `NAMA_REPO_ANDA` dengan nama repo GitHub Anda persis
3. Di repo GitHub: **Settings → Pages → Source**, pilih **"GitHub Actions"**
4. Push ke branch `main` — GitHub Actions (file `.github/workflows/deploy.yml`, sudah disiapkan) akan otomatis build & deploy setiap kali ada push
5. Setelah selesai (cek tab **Actions** di GitHub untuk progress), web bisa diakses di:
   `https://USERNAME-ANDA.github.io/NAMA_REPO_ANDA/`

## 5. Sambungkan ke n8n

Pastikan node-node Firestore di workflow n8n Anda menulis ke collection `members` dan `activities` pada project Firebase **yang sama** (`botskedul`) — web ini otomatis akan menampilkan perubahan apa pun yang masuk lewat WhatsApp secara real-time, tanpa perlu refresh.
