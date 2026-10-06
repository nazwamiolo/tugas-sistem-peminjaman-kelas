# Sistem Informasi Peminjaman Kelas

Aplikasi web pengelolaan peminjaman ruang kelas kampus untuk **mahasiswa**, **dosen**, dan **admin/pengelola**.
Menggantikan proses peminjaman manual: pengguna dapat melihat ketersediaan kelas, mengajukan peminjaman,
dan memantau status; admin memeriksa, menyetujui/menolak, serta melihat jadwal dan laporan.

## Teknologi

| Komponen | Pilihan | Alasan |
|---|---|---|
| Runtime | Node.js 22+ (diuji pada Node 24) | Tanpa instalasi tambahan |
| Web | Express 5 | Sederhana dan stabil |
| Template | EJS | Server-side rendering, cocok untuk tugas kampus |
| Database | SQLite (`node:sqlite` bawaan Node) | Relasional, tanpa server terpisah, langsung jalan |
| Password | bcryptjs | Hash password |
| Sesi | express-session | Autentikasi berbasis cookie |

## Menjalankan

```bash
npm install
npm start          # buka http://localhost:3000
```

Database SQLite dibuat otomatis di `data/sipk.db` beserta data dummy saat pertama dijalankan.

Variabel lingkungan (opsional): `PORT` (default 3000), `DB_FILE`, `SESSION_SECRET`.

### Akun demo

| Role | Email | Password |
|---|---|---|
| Admin | `admin@kampus.ac.id` | `admin123` |
| Mahasiswa | `budi@kampus.ac.id` | `mahasiswa123` |
| Mahasiswa | `siti@kampus.ac.id` | `mahasiswa123` |
| Dosen | `andi@kampus.ac.id` | `dosen123` |

## Pengujian

```bash
npm test
```

Suite `tests/app.test.js` menjalankan server pada port acak dengan database in-memory lalu menguji
lewat HTTP seluruh fungsi utama: registrasi, login ketiga role, CRUD kelas, validasi form peminjaman
(data kosong, waktu tidak valid, tanggal masa lalu, peserta melebihi kapasitas), **validasi bentrok
jadwal** (termasuk aturan jam berbatasan), persetujuan/penolakan admin, perubahan status yang dilihat
pengguna, riwayat peminjaman, laporan, serta keamanan role (mahasiswa/dosen tidak dapat membuka
halaman admin dan hanya dapat melihat peminjaman miliknya sendiri).

## Struktur

```
server.js          Titik masuk: buka database, rakit app, jalankan server
src/
  app.js           Perakit Express: middleware, sesi, route, error handler
  db.js            Skema SQLite (users, classrooms, bookings) + data dummy
  auth.js          Load sesi, requireAuth, requireRole (RBAC), flash message
  validators.js    Validasi seluruh input (registrasi, kelas, peminjaman)
  utils.js         Tanggal/waktu + findConflict (cek bentrok jadwal)
  calendar.js      Handler kalender pemakaian kelas
  routes/          authRoutes, userRoutes, adminRoutes
views/             Template EJS (auth, user, admin, partials)
public/            style.css, app.js (tanpa framework CSS/JS)
tests/app.test.js  Pengujian end-to-end
```

## Fitur utama

- **Auth & role**: registrasi/login, password di-hash, RBAC (admin-only area, kepemilikan peminjaman).
- **Data kelas**: CRUD lengkap + pencarian; kapasitas, gedung, lantai, fasilitas, status.
- **Peminjaman**: form tervalidasi (wajib diisi, waktu selesai > mulai, peserta ≤ kapasitas,
  tanggal tidak di masa lalu) dan **cegah double booking** dengan pesan
  *"Kelas tidak tersedia pada waktu tersebut karena sudah digunakan."*
- **Workflow status**: Menunggu → Disetujui/Ditolak (wajib beralasan) → Selesai (otomatis setelah
  waktunya lewat) / Dibatalkan (oleh pengguna saat masih Menunggu, atau oleh admin).
- **Dashboard** pengguna dan admin dengan card statistik + pengajuan terbaru.
- **Kalender** harian: jadwal pemakaian seluruh kelas + daftar kelas bebas sepanjang hari.
- **Laporan** admin: filter tanggal/kelas/pengguna/status, ringkasan status, kelas terpopuler,
  dan grafik batang sederhana.
- **Responsif**: sidebar layout, menjadi menu geser pada layar kecil.
