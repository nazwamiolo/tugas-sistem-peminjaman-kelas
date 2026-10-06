'use strict';

/** Route pengguna (mahasiswa & dosen): dashboard, daftar kelas, peminjaman, riwayat, profil. */

const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth, setFlash } = require('../auth');
const { validateBooking } = require('../validators');
const { findConflict, markFinished, todayStr } = require('./../utils');
const { createCalendarHandler } = require('../calendar');

const BOOKING_STATUSES = ['Menunggu', 'Disetujui', 'Ditolak', 'Selesai', 'Dibatalkan'];
const FACILITY_OPTIONS = ['Proyektor', 'AC', 'Papan tulis', 'Komputer', 'Wi-Fi', 'Sound system'];

module.exports = function createUserRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  const listClassrooms = () => db.prepare(
    'SELECT * FROM classrooms ORDER BY building, room_name'
  ).all();

  // ---- Dashboard ----
  router.get('/dashboard', (req, res) => {
    markFinished(db);
    const uid = req.user.id;
    const countBy = (status) => db.prepare(
      'SELECT COUNT(*) AS c FROM bookings WHERE user_id = ? AND status = ?'
    ).get(uid, status).c;
    const stats = {
      total: db.prepare('SELECT COUNT(*) AS c FROM bookings WHERE user_id = ?').get(uid).c,
      menunggu: countBy('Menunggu'),
      disetujui: countBy('Disetujui'),
      selesai: countBy('Selesai')
    };
    const recent = db.prepare(`
      SELECT b.*, c.room_name, c.building
      FROM bookings b
      JOIN classrooms c ON c.id = b.classroom_id
      WHERE b.user_id = ?
      ORDER BY b.id DESC
      LIMIT 5
    `).all(uid);
    res.render('user/dashboard', {
      title: 'Dashboard', active: 'dashboard', stats, recent
    });
  });

  // ---- Daftar kelas (pencarian & filter) ----
  router.get('/kelas', (req, res) => {
    const filters = {
      q: String(req.query.q || '').trim(),
      building: String(req.query.building || '').trim(),
      min_capacity: String(req.query.min_capacity || '').trim(),
      facility: String(req.query.facility || '').trim(),
      status: String(req.query.status || '').trim()
    };
    const conds = [];
    const params = [];
    if (filters.q) {
      conds.push('(room_name LIKE ? OR building LIKE ?)');
      params.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    if (filters.building) {
      conds.push('building = ?');
      params.push(filters.building);
    }
    const minCap = parseInt(filters.min_capacity, 10);
    if (filters.min_capacity && Number.isInteger(minCap) && minCap > 0) {
      conds.push('capacity >= ?');
      params.push(minCap);
    }
    if (filters.facility) {
      conds.push('facilities LIKE ?');
      params.push(`%${filters.facility}%`);
    }
    if (filters.status === 'Tersedia' || filters.status === 'Tidak tersedia') {
      conds.push('status = ?');
      params.push(filters.status);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const classrooms = db.prepare(
      `SELECT * FROM classrooms ${where} ORDER BY building, room_name`
    ).all(...params);
    const buildings = db.prepare(
      'SELECT DISTINCT building FROM classrooms ORDER BY building'
    ).all().map((r) => r.building);

    res.render('user/kelas', {
      title: 'Daftar Kelas', active: 'kelas',
      classrooms, buildings, filters, facilityOptions: FACILITY_OPTIONS
    });
  });

  // ---- Detail kelas + jadwal penggunaan ----
  router.get('/kelas/:id', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(id);
    if (!classroom) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan', message: 'Kelas tidak ditemukan.', user: req.user
      });
    }
    const today = todayStr();
    const upcoming = db.prepare(`
      SELECT b.*, u.name AS user_name
      FROM bookings b JOIN users u ON u.id = b.user_id
      WHERE b.classroom_id = ? AND b.booking_date >= ?
        AND b.status IN ('Menunggu', 'Disetujui')
      ORDER BY b.booking_date, b.start_time
      LIMIT 100
    `).all(classroom.id, today);
    const bookedToday = upcoming.filter((b) => b.booking_date === today);
    res.render('user/kelas-detail', {
      title: `Detail Kelas — ${classroom.room_name}`,
      active: 'kelas',
      classroom, upcoming, bookedToday, isAdmin: req.user.role === 'admin'
    });
  });

  // ---- Form ajukan peminjaman ----
  router.get('/peminjaman/baru', (req, res) => {
    const classrooms = listClassrooms();
    const requested = Number.parseInt(req.query.classroom_id, 10);
    const classroom = classrooms.find((c) => c.id === requested) || null;
    res.render('user/booking-form', {
      title: 'Ajukan Peminjaman', active: 'baru',
      classrooms, classroom, body: {}, errors: [], schedule: []
    });
  });

  // ---- Simpan peminjaman (dengan validasi & cek bentrok) ----
  router.post('/peminjaman', (req, res) => {
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?')
      .get(Number.parseInt(req.body.classroom_id, 10));
    const { errors, data } = validateBooking(db, req.body, classroom);
    const classrooms = listClassrooms();
    const renderForm = (status, errs) => res.status(status).render('user/booking-form', {
      title: 'Ajukan Peminjaman', active: 'baru',
      classrooms,
      classroom: classroom || classrooms.find((c) => c.id === data.classroom_id) || null,
      body: req.body,
      errors: errs,
      schedule: classroom ? db.prepare(`
        SELECT b.* FROM bookings b
        WHERE b.classroom_id = ? AND b.booking_date = ? AND b.status IN ('Menunggu', 'Disetujui')
        ORDER BY b.start_time
      `).all(classroom.id, data.booking_date || '') : []
    });

    if (errors.length) {
      // Bentrok jadwal dilaporkan sebagai 409 Conflict, bukan 400 Bad Request.
      const isConflict = errors.some((e) => e.startsWith('Kelas tidak tersedia pada waktu tersebut'));
      return renderForm(isConflict ? 409 : 400, errors);
    }

    // Transaksi: cek bentrok ulang tepat sebelum insert (hindari double booking).
    try {
      db.exec('BEGIN IMMEDIATE');
      const conflict = findConflict(db, data);
      if (conflict) {
        db.exec('ROLLBACK');
        return renderForm(409, ['Kelas tidak tersedia pada waktu tersebut karena sudah digunakan.']);
      }
      db.prepare(`
        INSERT INTO bookings
          (user_id, classroom_id, booking_date, start_time, end_time, purpose, participant_count, user_note, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Menunggu')
      `).run(
        req.user.id, data.classroom_id, data.booking_date,
        data.start_time, data.end_time, data.purpose,
        data.participant_count, data.user_note || null
      );
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
      throw err;
    }

    setFlash(req, 'success', 'Peminjaman berhasil diajukan dan sedang menunggu persetujuan admin.');
    return res.redirect('/peminjaman');
  });

  // ---- Peminjaman saya (riwayat + filter status) ----
  router.get('/peminjaman', (req, res) => {
    markFinished(db);
    const raw = String(req.query.status || '').trim();
    const status = BOOKING_STATUSES.includes(raw) ? raw : '';
    let sql = `
      SELECT b.*, c.room_name, c.building
      FROM bookings b JOIN classrooms c ON c.id = b.classroom_id
      WHERE b.user_id = ?
    `;
    const params = [req.user.id];
    if (status) {
      sql += ' AND b.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY b.booking_date DESC, b.start_time DESC';
    const bookings = db.prepare(sql).all(...params);
    res.render('user/peminjaman', {
      title: 'Peminjaman Saya', active: 'peminjaman', bookings, filter: status
    });
  });

  // ---- Detail peminjaman (hanya milik sendiri) ----
  router.get('/peminjaman/:id', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const booking = db.prepare(`
      SELECT b.*, c.room_name, c.building, c.capacity, u.name AS user_name, u.email AS user_email
      FROM bookings b
      JOIN classrooms c ON c.id = b.classroom_id
      JOIN users u ON u.id = b.user_id
      WHERE b.id = ?
    `).get(id);
    if (!booking) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan', message: 'Peminjaman tidak ditemukan.', user: req.user
      });
    }
    if (booking.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).render('error', {
        title: 'Akses Ditolak',
        message: 'Anda hanya dapat melihat peminjaman milik Anda sendiri.',
        user: req.user
      });
    }
    res.render('user/booking-detail', {
      title: `Detail Peminjaman #${booking.id}`,
      active: 'peminjaman',
      booking,
      isAdmin: req.user.role === 'admin'
    });
  });

  // ---- Batalkan pengajuan (hanya status Menunggu, milik sendiri) ----
  router.post('/peminjaman/:id/batal', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking || booking.user_id !== req.user.id) {
      setFlash(req, 'error', 'Peminjaman tidak ditemukan atau bukan milik Anda.');
      return res.redirect('/peminjaman');
    }
    if (booking.status !== 'Menunggu') {
      setFlash(req, 'error', 'Hanya pengajuan berstatus Menunggu yang dapat dibatalkan.');
      return res.redirect(`/peminjaman/${id}`);
    }
    db.prepare("UPDATE bookings SET status = 'Dibatalkan' WHERE id = ?").run(id);
    setFlash(req, 'success', 'Peminjaman berhasil dibatalkan.');
    return res.redirect('/peminjaman');
  });

  // ---- Kalender ----
  router.get('/kalender', createCalendarHandler(db, 'kalender'));

  // ---- Profil ----
  router.get('/profil', (req, res) => {
    res.render('user/profil', { title: 'Profil', active: 'profil', errors: [], pwErrors: [] });
  });

  router.post('/profil', (req, res) => {
    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').trim();
    const errors = [];
    if (name === '') errors.push('Nama lengkap wajib diisi.');
    if (phone !== '' && !/^[0-9+\-\s]{6,20}$/.test(phone)) errors.push('Nomor telepon tidak valid.');
    if (errors.length) {
      return res.status(400).render('user/profil', {
        title: 'Profil', active: 'profil', errors, pwErrors: []
      });
    }
    db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?')
      .run(name, phone || null, req.user.id);
    setFlash(req, 'success', 'Profil berhasil diperbarui.');
    return res.redirect('/profil');
  });

  router.post('/profil/password', (req, res) => {
    const current = String(req.body.current_password || '');
    const next = String(req.body.new_password || '');
    const confirm = String(req.body.confirm_password || '');
    const pwErrors = [];
    const row = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
    if (!row || !bcrypt.compareSync(current, row.password)) {
      pwErrors.push('Password saat ini salah.');
    }
    if (next.length < 6) pwErrors.push('Password baru minimal 6 karakter.');
    if (next !== confirm) pwErrors.push('Konfirmasi password baru tidak sama.');
    if (pwErrors.length) {
      return res.status(400).render('user/profil', {
        title: 'Profil', active: 'profil', errors: [], pwErrors
      });
    }
    db.prepare('UPDATE users SET password = ? WHERE id = ?')
      .run(bcrypt.hashSync(next, 10), req.user.id);
    setFlash(req, 'success', 'Password berhasil diubah.');
    return res.redirect('/profil');
  });

  return router;
};
