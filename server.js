'use strict';

/** Titik masuk aplikasi: buka database, rakit app, jalankan server. */

const path = require('path');
const { createDatabase } = require('./src/db');
const createApp = require('./src/app');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'sipk.db');
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;

const db = createDatabase(DB_FILE);
const app = createApp({ db, secret: process.env.SESSION_SECRET || 'sipk-dev-secret-ganti-saat-produksi' });

app.listen(PORT, () => {
  console.log('======================================================');
  console.log(' Sistem Informasi Peminjaman Kelas');
  console.log(` Berjalan di http://localhost:${PORT}`);
  console.log(` Database   : ${DB_FILE}`);
  console.log('------------------------------------------------------');
  console.log(' Akun demo:');
  console.log('  Admin      admin@kampus.ac.id / admin123');
  console.log('  Mahasiswa  budi@kampus.ac.id / mahasiswa123');
  console.log('  Mahasiswa  siti@kampus.ac.id / mahasiswa123');
  console.log('  Dosen      andi@kampus.ac.id / dosen123');
  console.log('======================================================');
});
