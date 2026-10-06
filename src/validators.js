'use strict';

/** Validasi seluruh input pengguna (server-side). */

const { todayStr, findConflict } = require('./utils');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

/** Validasi form registrasi. Mengembalikan array pesan error. */
function validateRegistration(db, body) {
  const errors = [];
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const confirm = String(body.confirm || '');
  const role = String(body.role || '');
  const phone = String(body.phone || '').trim();

  if (name === '') errors.push('Nama lengkap wajib diisi.');
  if (email === '') errors.push('Email wajib diisi.');
  else if (!EMAIL_RE.test(email)) errors.push('Format email tidak valid.');
  else {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) errors.push('Email sudah terdaftar.');
  }
  if (password === '') errors.push('Password wajib diisi.');
  else if (password.length < 6) errors.push('Password minimal 6 karakter.');
  if (confirm !== password) errors.push('Konfirmasi password tidak sama.');
  if (role !== 'mahasiswa' && role !== 'dosen') errors.push('Role pengguna tidak valid.');
  if (phone !== '' && !/^[0-9+\-\s]{6,20}$/.test(phone)) errors.push('Nomor telepon tidak valid.');

  return { errors, data: { name, email, password, role, phone } };
}

/** Validasi form login. */
function validateLogin(body) {
  const errors = [];
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (email === '') errors.push('Email wajib diisi.');
  if (password === '') errors.push('Password wajib diisi.');
  return { errors, data: { email, password } };
}

/** Validasi data kelas (tambah/ubah). */
function validateClassroom(body) {
  const errors = [];
  const room_name = String(body.room_name || '').trim();
  const building = String(body.building || '').trim();
  const floor = String(body.floor || '').trim();
  const rawCapacity = String(body.capacity || '').trim();
  const status = String(body.status || 'Tersedia');
  const capacity = Number(rawCapacity);

  if (room_name === '') errors.push('Nama ruangan wajib diisi.');
  if (building === '') errors.push('Gedung wajib diisi.');
  if (floor === '') errors.push('Lantai wajib diisi.');
  if (rawCapacity === '') errors.push('Kapasitas wajib diisi.');
  else if (!Number.isInteger(capacity) || capacity < 1) errors.push('Kapasitas harus bilangan bulat lebih dari 0.');
  else if (capacity > 1000) errors.push('Kapasitas maksimal 1000 orang.');
  if (status !== 'Tersedia' && status !== 'Tidak tersedia') errors.push('Status kelas tidak valid.');

  let facilities = body.facilities;
  if (typeof facilities === 'string') facilities = facilities.split(',');
  if (!Array.isArray(facilities)) facilities = [];
  facilities = facilities.map((f) => String(f).trim()).filter(Boolean);

  return {
    errors,
    data: { room_name, building, floor, capacity, facilities: facilities.join('|'), status }
  };
}

/**
 * Validasi form peminjaman kelas:
 * - semua data wajib diisi
 * - tanggal tidak boleh masa lalu
 * - waktu selesai > waktu mulai
 * - jumlah peserta tidak melebihi kapasitas
 * - tidak boleh bentrok jadwal (double booking)
 */
function validateBooking(db, body, classroom) {
  const errors = [];
  const classroom_id = Number.parseInt(body.classroom_id, 10);
  const booking_date = String(body.booking_date || '').trim();
  const start_time = String(body.start_time || '').trim();
  const end_time = String(body.end_time || '').trim();
  const purpose = String(body.purpose || '').trim();
  const rawCount = String(body.participant_count || '').trim();
  const participant_count = Number(rawCount);
  const user_note = String(body.user_note || '').trim();

  if (!classroom || Number.isNaN(classroom_id)) errors.push('Kelas harus dipilih.');
  if (booking_date === '') errors.push('Tanggal peminjaman wajib diisi.');
  if (start_time === '') errors.push('Waktu mulai wajib diisi.');
  if (end_time === '') errors.push('Waktu selesai wajib diisi.');
  if (purpose === '') errors.push('Keperluan peminjaman wajib diisi.');
  if (rawCount === '') errors.push('Jumlah peserta wajib diisi.');

  if (booking_date !== '') {
    if (!isValidDate(booking_date)) errors.push('Tanggal peminjaman tidak valid.');
    else if (booking_date < todayStr()) errors.push('Tanggal peminjaman tidak boleh berada di masa lalu.');
  }

  if (start_time !== '' && !TIME_RE.test(start_time)) errors.push('Waktu mulai tidak valid.');
  if (end_time !== '' && !TIME_RE.test(end_time)) errors.push('Waktu selesai tidak valid.');
  if (TIME_RE.test(start_time) && TIME_RE.test(end_time) && end_time <= start_time) {
    errors.push('Waktu selesai harus lebih besar dari waktu mulai.');
  }

  if (rawCount !== '') {
    if (!Number.isInteger(participant_count) || participant_count < 1) {
      errors.push('Jumlah peserta harus bilangan bulat lebih dari 0.');
    } else if (classroom && participant_count > classroom.capacity) {
      errors.push(`Jumlah peserta (${participant_count}) melebihi kapasitas kelas (${classroom.capacity}).`);
    }
  }

  if (classroom && classroom.status !== 'Tersedia') {
    errors.push('Kelas berstatus tidak tersedia.');
  }

  // Cek bentrok hanya jika semua data dasar sudah valid.
  if (
    errors.length === 0 &&
    classroom && DATE_RE.test(booking_date) &&
    TIME_RE.test(start_time) && TIME_RE.test(end_time)
  ) {
    const conflict = findConflict(db, { classroom_id: classroom.id, booking_date, start_time, end_time });
    if (conflict) {
      errors.push('Kelas tidak tersedia pada waktu tersebut karena sudah digunakan.');
    }
  }

  return {
    errors,
    data: { classroom_id, booking_date, start_time, end_time, purpose, participant_count, user_note }
  };
}

module.exports = {
  isValidDate,
  validateRegistration,
  validateLogin,
  validateClassroom,
  validateBooking
};
