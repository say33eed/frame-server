"use strict";
// Booking dates and HH:mm fields are Bangladesh wall-clock times (Asia/Dhaka, UTC+06:00).
// Persisted Date values (createdAt/updatedAt) remain UTC instants as usual.
const OFFSET_MS = 6 * 60 * 60 * 1000;
function bookingInstant(date, time) {
  if (typeof date !== "string" || typeof time !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN;
  const value = Date.parse(`${date}T${time}:00.000Z`);
  if (!Number.isFinite(value) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0,10) !== date) return NaN;
  return value - OFFSET_MS;
}
function isBookingCompleted(booking, now = Date.now()) {
  return (booking.status === "Confirmed" || booking.status === "Completed") &&
    Number.isFinite(bookingInstant(booking.date, booking.endTime)) &&
    bookingInstant(booking.date, booking.endTime) <= now;
}
function displayBooking(booking, now = Date.now()) {
  return { ...booking, status: isBookingCompleted(booking, now) ? "Completed" : booking.status };
}
module.exports = { bookingInstant, isBookingCompleted, displayBooking };
