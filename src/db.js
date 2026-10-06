'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const { offsetDate } = require('./utils');

/** Skema database relasional (SQLite) dengan foreign key. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  email      TEXT    NOT NULL UNIQUE,
  password   TEXT    NOT NULL,
  role       TEXT    NOT NULL DEFAULT 'mahasiswa' CHECK (role IN ('mahasiswa', 'dosen', 'admin')),
  phone      TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS classrooms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_name  TEXT    NOT NULL UNIQUE,
  building   TEXT    NOT NULL,
  floor      TEXT    NOT NULL,
  capacity   INTEGER NOT NULL CHECK (capacity > 0),
  facilities TEXT    NOT NULL DEFAULT '',
  status     TEXT    NOT NULL DEFAULT 'Tersedia' CHECK (status IN ('Tersedia', 'Tidak tersedia'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL,
  classroom_id     INTEGER NOT NULL,
  booking_date     TEXT    NOT NULL,
  start_time       TEXT    NOT NULL,
  end_time         TEXT    NOT NULL,
  purpose          TEXT    NOT NULL,
  participant_count INTEGER NOT NULL CHECK (participant_count > 0),
  status           TEXT    NOT NULL DEFAULT 'Menunggu' CHECK (status IN ('Menunggu', 'Disetujui', 'Ditolak', 'Selesai', 'Dibatalkan')),
  admin_note       TEXT,
  user_note        TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bookings_classroom_date ON bookings(classroom_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
`;

/** Isi database dengan data dummy agar aplikasi langsung dapat diuji. */
function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;

  const hash = (pwd) => bcrypt.hashSync(pwd, 10);
  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, ?, ?)'
  );
  insertUser.run('Administrator', 'admin@kampus.ac.id', hash('admin123'), 'admin', '08111111111');
  insertUser.run('Budi Santoso', 'budi@kampus.ac.id', hash('mahasiswa123'), 'mahasiswa', '081234567890');
  insertUser.run('Siti Aminah', 'siti@kampus.ac.id', hash('mahasiswa123'), 'mahasiswa', '081234567891');
  insertUser.run('Dr. Andi Wijaya', 'andi@kampus.ac.id', hash('dosen123'), 'dosen', '081333333333');

  const insertClass = db.prepare(
    'INSERT INTO classrooms (room_name, building, floor, capacity, facilities, status) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertClass.run('Ruang 101', 'Gedung A', '1', 40, 'Proyektor|AC|Papan tulis|Wi-Fi', 'Tersedia');
  insertClass.run('Ruang 102', 'Gedung A', '1', 50, 'Proyektor|AC|Papan tulis|Wi-Fi', 'Tersedia');
  insertClass.run('Ruang 103', 'Gedung A', '2', 45, 'Proyektor|AC|Papan tulis', 'Tersedia');
  insertClass.run('Lab Komputer 1', 'Gedung B', '1', 30, 'Komputer|AC|Proyektor|Wi-Fi', 'Tersedia');
  insertClass.run('Ruang Seminar', 'Gedung C', '3', 60, 'Proyektor|AC|Sound system|Wi-Fi|Papan tulis', 'Tersedia');

  const insertBooking = db.prepare(`
    INSERT INTO bookings
      (user_id, classroom_id, booking_date, start_time, end_time, purpose, participant_count, status, admin_note, user_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Riwayat (untuk laporan & riwayat peminjaman)
  insertBooking.run(2, 1, offsetDate(-14), '08:00', '10:00', 'Kuliah Basis Data', 35, 'Disetujui', null, null);
  insertBooking.run(4, 4, offsetDate(-7), '10:00', '12:00', 'Praktikum Algoritma', 28, 'Disetujui', null, null);
  insertBooking.run(3, 2, offsetDate(-5), '13:00', '15:00', 'Rapat Organisasi', 20, 'Ditolak', 'Kelas sedang digunakan untuk kegiatan akademik.', 'Rapat rutin organisasi');
  insertBooking.run(2, 3, offsetDate(-3), '15:00', '17:00', 'Bimbingan Kelompok', 10, 'Dibatalkan', null, 'Dibatalkan karena ada perubahan jadwal');
  insertBooking.run(3, 5, offsetDate(-10), '09:00', '11:00', 'Latihan Presentasi', 25, 'Selesai', null, null);

  // Jadwal aktif (untuk kalender & pengujian validasi bentrok)
  insertBooking.run(2, 1, offsetDate(1), '08:00', '10:00', 'Kuliah Basis Data', 35, 'Disetujui', null, null);
  insertBooking.run(2, 1, offsetDate(1), '10:00', '12:00', 'Kuliah Basis Data', 35, 'Menunggu', null, null);
  insertBooking.run(3, 4, offsetDate(2), '13:00', '15:00', 'Praktikum Jaringan', 25, 'Menunggu', null, null);
  insertBooking.run(4, 5, offsetDate(3), '09:00', '11:00', 'Seminar Skripsi', 50, 'Disetujui', null, null);
  insertBooking.run(3, 2, offsetDate(0), '13:00', '15:00', 'Gladi Bersih', 40, 'Disetujui', null, null);
  insertBooking.run(4, 3, offsetDate(4), '08:00', '10:00', 'Rapat Dosen', 20, 'Menunggu', null, null);
}

/** Buka (dan siapkan) database: skema + data dummy. */
function createDatabase(file = ':memory:') {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

module.exports = { createDatabase };
