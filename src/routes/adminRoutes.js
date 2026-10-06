'use strict';

/** Route admin: dashboard, CRUD kelas, pengelolaan pengajuan, kalender, laporan, pengguna. */

const express = require('express');
const { requireRole, setFlash } = require('../auth');
const { validateClassroom, isValidDate } = require('../validators');
const { markFinished, todayStr } = require('./../utils');
const { createCalendarHandler } = require('../calendar');

const BOOKING_STATUSES = ['Menunggu', 'Disetujui', 'Ditolak', 'Selesai', 'Dibatalkan'];
const FACILITY_OPTIONS = ['Proyektor', 'AC', 'Papan tulis', 'Komputer', 'Wi-Fi', 'Sound system'];

module.exports = function createAdminRoutes(db) {
  const router = express.Router();
  router.use(requireRole('admin'));

  const listClassrooms = () => db.prepare(
    'SELECT * FROM classrooms ORDER BY building, room_name'
  ).all();

  const findBooking = (rawId) => {
    const id = Number.parseInt(rawId, 10);
    if (!Number.isInteger(id)) return null;
    return db.prepare(`
      SELECT b.*, c.room_name, c.building, c.capacity, u.name AS user_name, u.email AS user_email, u.role AS user_role
      FROM bookings b
      JOIN classrooms c ON c.id = b.classroom_id
      JOIN users u ON u.id = b.user_id
      WHERE b.id = ?
    `).get(id);
  };

  // ---- Dashboard admin ----
  router.get('/admin', (req, res) => {
    markFinished(db);
    const today = todayStr();
    const c = (sql, ...params) => db.prepare(sql).get(...params).c;
    const stats = {
      totalKelas: c('SELECT COUNT(*) AS c FROM classrooms'),
      kelasTersedia: c("SELECT COUNT(*) AS c FROM classrooms WHERE status = 'Tersedia'"),
      totalPengajuan: c('SELECT COUNT(*) AS c FROM bookings'),
      menunggu: c("SELECT COUNT(*) AS c FROM bookings WHERE status = 'Menunggu'"),
      disetujui: c("SELECT COUNT(*) AS c FROM bookings WHERE status = 'Disetujui'"),
      hariIni: c(
        "SELECT COUNT(*) AS c FROM bookings WHERE booking_date = ? AND status IN ('Menunggu', 'Disetujui', 'Selesai')",
        today
      )
    };
    const recent = db.prepare(`
      SELECT b.*, c.room_name, c.building, u.name AS user_name, u.role AS user_role
      FROM bookings b
      JOIN classrooms c ON c.id = b.classroom_id
      JOIN users u ON u.id = b.user_id
      ORDER BY b.id DESC
      LIMIT 8
    `).all();
    res.render('admin/dashboard', {
      title: 'Dashboard Admin', active: 'admin', stats, recent
    });
  });

  // ---- Data kelas: list ----
  router.get('/admin/kelas', (req, res) => {
    const q = String(req.query.q || '').trim();
    let classrooms;
    if (q) {
      classrooms = db.prepare(
        'SELECT * FROM classrooms WHERE room_name LIKE ? OR building LIKE ? ORDER BY building, room_name'
      ).all(`%${q}%`, `%${q}%`);
    } else {
      classrooms = listClassrooms();
    }
    res.render('admin/kelas', {
      title: 'Data Kelas', active: 'data-kelas', classrooms, q
    });
  });

  // ---- Data kelas: tambah ----
  router.get('/admin/kelas/baru', (req, res) => {
    res.render('admin/kelas-form', {
      title: 'Tambah Kelas', active: 'data-kelas',
      classroom: null, body: {}, errors: [], facilityOptions: FACILITY_OPTIONS
    });
  });

  router.post('/admin/kelas', (req, res) => {
    const { errors, data } = validateClassroom(req.body);
    const dup = db.prepare('SELECT id FROM classrooms WHERE room_name = ?').get(data.room_name);
    if (dup) errors.push('Nama ruangan sudah digunakan.');
    if (errors.length) {
      return res.status(400).render('admin/kelas-form', {
        title: 'Tambah Kelas', active: 'data-kelas',
        classroom: null, body: req.body, errors, facilityOptions: FACILITY_OPTIONS
      });
    }
    db.prepare(`
      INSERT INTO classrooms (room_name, building, floor, capacity, facilities, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(data.room_name, data.building, data.floor, data.capacity, data.facilities, data.status);
    setFlash(req, 'success', `Kelas "${data.room_name}" berhasil ditambahkan.`);
    return res.redirect('/admin/kelas');
  });

  // ---- Data kelas: ubah ----
  router.get('/admin/kelas/:id/edit', (req, res) => {
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?')
      .get(Number.parseInt(req.params.id, 10));
    if (!classroom) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan', message: 'Kelas tidak ditemukan.', user: req.user
      });
    }
    res.render('admin/kelas-form', {
      title: 'Ubah Kelas', active: 'data-kelas',
      classroom, body: {}, errors: [], facilityOptions: FACILITY_OPTIONS
    });
  });

  router.post('/admin/kelas/:id', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(id);
    if (!classroom) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan', message: 'Kelas tidak ditemukan.', user: req.user
      });
    }
    const { errors, data } = validateClassroom(req.body);
    const dup = db.prepare('SELECT id FROM classrooms WHERE room_name = ? AND id != ?')
      .get(data.room_name, id);
    if (dup) errors.push('Nama ruangan sudah digunakan.');
    if (errors.length) {
      return res.status(400).render('admin/kelas-form', {
        title: 'Ubah Kelas', active: 'data-kelas',
        classroom, body: req.body, errors, facilityOptions: FACILITY_OPTIONS
      });
    }
    db.prepare(`
      UPDATE classrooms
      SET room_name = ?, building = ?, floor = ?, capacity = ?, facilities = ?, status = ?
      WHERE id = ?
    `).run(data.room_name, data.building, data.floor, data.capacity, data.facilities, data.status, id);
    setFlash(req, 'success', `Kelas "${data.room_name}" berhasil diubah.`);
    return res.redirect('/admin/kelas');
  });

  // ---- Data kelas: hapus ----
  router.post('/admin/kelas/:id/hapus', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(id);
    if (!classroom) {
      setFlash(req, 'error', 'Kelas tidak ditemukan.');
      return res.redirect('/admin/kelas');
    }
    const bookingCount = db.prepare(
      'SELECT COUNT(*) AS c FROM bookings WHERE classroom_id = ?'
    ).get(id).c;
    db.prepare('DELETE FROM classrooms WHERE id = ?').run(id);
    setFlash(
      req, 'success',
      bookingCount > 0
        ? `Kelas "${classroom.room_name}" beserta ${bookingCount} riwayat peminjaman dihapus.`
        : `Kelas "${classroom.room_name}" berhasil dihapus.`
    );
    return res.redirect('/admin/kelas');
  });

  // ---- Pengajuan peminjaman ----
  router.get('/admin/pengajuan', (req, res) => {
    markFinished(db);
    const raw = String(req.query.status || '').trim();
    const status = BOOKING_STATUSES.includes(raw) ? raw : '';
    let sql = `
      SELECT b.*, c.room_name, c.building, u.name AS user_name, u.role AS user_role
      FROM bookings b
      JOIN classrooms c ON c.id = b.classroom_id
      JOIN users u ON u.id = b.user_id
    `;
    const params = [];
    if (status) {
      sql += ' WHERE b.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY b.id DESC';
    const bookings = db.prepare(sql).all(...params);
    res.render('admin/pengajuan', {
      title: 'Pengajuan Peminjaman', active: 'pengajuan', bookings, filter: status
    });
  });

  router.get('/admin/peminjaman/:id', (req, res) => {
    const booking = findBooking(req.params.id);
    if (!booking) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan', message: 'Pengajuan tidak ditemukan.', user: req.user
      });
    }
    res.render('admin/pengajuan-detail', {
      title: `Detail Pengajuan #${booking.id}`, active: 'pengajuan', booking
    });
  });

  // ---- Proses pengajuan: setujui / tolak / batalkan / selesai ----
  router.post('/admin/peminjaman/:id/setujui', (req, res) => {
    const booking = findBooking(req.params.id);
    if (!booking) return res.redirect('/admin/pengajuan');
    if (booking.status !== 'Menunggu') {
      setFlash(req, 'error', 'Hanya pengajuan berstatus Menunggu yang dapat disetujui.');
      return res.redirect(`/admin/peminjaman/${booking.id}`);
    }
    // Cek bentrok ulang saat menyetujui (data bisa berubah sejak diajukan).
    const conflict = db.prepare(`
      SELECT id FROM bookings
      WHERE classroom_id = ? AND booking_date = ? AND status IN ('Menunggu', 'Disetujui')
        AND start_time < ? AND end_time > ? AND id != ?
    `).get(booking.classroom_id, booking.booking_date, booking.end_time, booking.start_time, booking.id);
    if (conflict) {
      setFlash(req, 'error', 'Tidak dapat menyetujui: terdapat peminjaman lain yang bentrok pada waktu tersebut.');
      return res.redirect(`/admin/peminjaman/${booking.id}`);
    }
    const note = String(req.body.catatan || '').trim() || null;
    db.prepare("UPDATE bookings SET status = 'Disetujui', admin_note = ? WHERE id = ?")
      .run(note, booking.id);
    setFlash(req, 'success', `Pengajuan #${booking.id} disetujui.`);
    return res.redirect('/admin/pengajuan');
  });

  router.post('/admin/peminjaman/:id/tolak', (req, res) => {
    const booking = findBooking(req.params.id);
    if (!booking) return res.redirect('/admin/pengajuan');
    if (booking.status !== 'Menunggu') {
      setFlash(req, 'error', 'Hanya pengajuan berstatus Menunggu yang dapat ditolak.');
      return res.redirect(`/admin/peminjaman/${booking.id}`);
    }
    const alasan = String(req.body.alasan || '').trim();
    if (alasan === '') {
      setFlash(req, 'error', 'Alasan penolakan wajib diisi.');
      return res.redirect(`/admin/peminjaman/${booking.id}`);
    }
    db.prepare("UPDATE bookings SET status = 'Ditolak', admin_note = ? WHERE id = ?")
      .run(alasan, booking.id);
    setFlash(req, 'success', `Pengajuan #${booking.id} ditolak.`);
    return res.redirect('/admin/pengajuan');
  });

  router.post('/admin/peminjaman/:id/batalkan', (req, res) => {
    const booking = findBooking(req.params.id);
    if (!booking) return res.redirect('/admin/pengajuan');
    if (booking.status !== 'Menunggu' && booking.status !== 'Disetujui') {
      setFlash(req, 'error', 'Hanya pengajuan berstatus Menunggu atau Disetujui yang dapat dibatalkan.');
      return res.redirect(`/admin/peminjaman/${booking.id}`);
    }
    const note = String(req.body.catatan || '').trim() || null;
    db.prepare("UPDATE bookings SET status = 'Dibatalkan', admin_note = COALESCE(?, admin_note) WHERE id = ?")
      .run(note, booking.id);
    setFlash(req, 'success', `Pengajuan #${booking.id} dibatalkan.`);
    return res.redirect('/admin/pengajuan');
  });

  router.post('/admin/peminjaman/:id/selesai', (req, res) => {
    const booking = findBooking(req.params.id);
    if (!booking) return res.redirect('/admin/pengajuan');
    if (booking.status !== 'Disetujui') {
      setFlash(req, 'error', 'Hanya peminjaman berstatus Disetujui yang dapat ditandai selesai.');
      return res.redirect(`/admin/peminjaman/${booking.id}`);
    }
    db.prepare("UPDATE bookings SET status = 'Selesai' WHERE id = ?").run(booking.id);
    setFlash(req, 'success', `Peminjaman #${booking.id} ditandai selesai.`);
    return res.redirect(`/admin/peminjaman/${booking.id}`);
  });

  // ---- Kalender (seluruh kelas) ----
  router.get('/admin/kalender', createCalendarHandler(db, 'admin-kalender'));

  // ---- Laporan ----
  router.get('/admin/laporan', (req, res) => {
    markFinished(db);
    const q = {
      from: String(req.query.from || '').trim(),
      to: String(req.query.to || '').trim(),
      classroom_id: Number.parseInt(req.query.classroom_id, 10),
      user_id: Number.parseInt(req.query.user_id, 10),
      status: String(req.query.status || '').trim()
    };
    const conds = [];
    const params = [];
    if (q.from && isValidDate(q.from)) { conds.push('b.booking_date >= ?'); params.push(q.from); }
    if (q.to && isValidDate(q.to)) { conds.push('b.booking_date <= ?'); params.push(q.to); }
    if (Number.isInteger(q.classroom_id) && q.classroom_id > 0) {
      conds.push('b.classroom_id = ?'); params.push(q.classroom_id);
    }
    if (Number.isInteger(q.user_id) && q.user_id > 0) {
      conds.push('b.user_id = ?'); params.push(q.user_id);
    }
    if (BOOKING_STATUSES.includes(q.status)) { conds.push('b.status = ?'); params.push(q.status); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT b.*, u.name AS user_name, c.room_name, c.building
      FROM bookings b
      JOIN users u ON u.id = b.user_id
      JOIN classrooms c ON c.id = b.classroom_id
      ${where}
      ORDER BY b.booking_date DESC, b.start_time DESC
      LIMIT 500
    `).all(...params);

    const summary = { total: rows.length, Menunggu: 0, Disetujui: 0, Ditolak: 0, Selesai: 0, Dibatalkan: 0 };
    const perClassroom = new Map();
    for (const r of rows) {
      summary[r.status] = (summary[r.status] || 0) + 1;
      const key = r.room_name;
      perClassroom.set(key, (perClassroom.get(key) || 0) + 1);
    }
    const byClassroom = [...perClassroom.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    const maxCount = byClassroom.length ? byClassroom[0].count : 0;
    const topClassroom = byClassroom.length ? byClassroom[0] : null;

    res.render('admin/laporan', {
      title: 'Laporan Peminjaman', active: 'laporan',
      rows, summary, byClassroom, maxCount, topClassroom,
      filters: q,
      classrooms: listClassrooms(),
      users: db.prepare('SELECT id, name, role FROM users ORDER BY name').all()
    });
  });

  // ---- Pengguna ----
  router.get('/admin/pengguna', (req, res) => {
    const users = db.prepare(`
      SELECT u.*, COUNT(b.id) AS booking_count
      FROM users u
      LEFT JOIN bookings b ON b.user_id = u.id
      GROUP BY u.id
      ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'dosen' THEN 1 ELSE 2 END, u.name
    `).all();
    res.render('admin/pengguna', {
      title: 'Data Pengguna', active: 'pengguna', users
    });
  });

  return router;
};
