'use strict';

/** Handler halaman kalender (dipakai pengguna & admin). */

const { isValidDate } = require('./validators');
const { toYmd, todayStr, formatDate, formatTime } = require('./utils');

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toYmd(dt);
}

/**
 * GET kalender: tampilkan jadwal pemakaian kelas pada satu tanggal
 * + daftar kelas yang bebas sepanjang hari.
 */
function createCalendarHandler(db, active) {
  return (req, res) => {
    let date = String(req.query.date || '').trim();
    if (!date || !isValidDate(date)) date = todayStr();

    const bookings = db.prepare(`
      SELECT b.*, c.room_name, c.building, u.name AS user_name
      FROM bookings b
      JOIN classrooms c ON c.id = b.classroom_id
      JOIN users u ON u.id = b.user_id
      WHERE b.booking_date = ?
        AND b.status IN ('Menunggu', 'Disetujui', 'Selesai')
      ORDER BY b.start_time, c.room_name
    `).all(date);

    const classrooms = db.prepare(
      'SELECT * FROM classrooms ORDER BY building, room_name'
    ).all();

    const usedIds = new Set(bookings.map((b) => b.classroom_id));
    const freeClasses = classrooms.filter((c) => !usedIds.has(c.id) && c.status === 'Tersedia');
    const busyClasses = classrooms.filter((c) => usedIds.has(c.id));

    return res.render('user/kalender', {
      title: 'Kalender Peminjaman',
      active,
      date,
      dateLabel: formatDate(date),
      prevDate: shiftDate(date, -1),
      nextDate: shiftDate(date, 1),
      bookings,
      freeClasses,
      busyClasses,
      isAdmin: req.user.role === 'admin',
      fmtTime: formatTime
    });
  };
}

module.exports = { createCalendarHandler };
