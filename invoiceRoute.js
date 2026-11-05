"use strict";

const express = require("express");
const { ObjectId } = require("mongodb");
const { getBetterAuth } = require("./betterAuth");

// Dependency-free, one-page PDF generator. Uses PDF's built-in Helvetica font.
function pdfEscape(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}
function textAt(x, y, size, value, color = "0.13 0.13 0.15") {
  return `${color} rg BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfEscape(value)}) Tj ET\n`;
}
function usd(value) {
  const number = Number(value);
  return `$${(Number.isFinite(number) ? number : 0).toFixed(2)}`;
}
function createInvoicePdf(booking, user) {
  const id = String(booking._id).toUpperCase();
  const lines = [];
  lines.push("0.9 0.0 0.14 rg 0 742 612 50 re f\n");
  lines.push(textAt(45, 760, 25, "FRAME", "1 1 1"));
  lines.push(textAt(420, 760, 15, "BOOKING INVOICE", "1 1 1"));
  lines.push(textAt(45, 708, 10, `Invoice reference: FR-${id.slice(-10)}`));
  lines.push(textAt(45, 690, 10, `Booking ID: ${id}`));
  lines.push(textAt(45, 672, 10, `Issued: ${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}`));
  lines.push(textAt(45, 640, 12, "BILLED TO", "0.9 0 0.14"));
  lines.push(textAt(45, 621, 11, user.name || "Frame customer"));
  lines.push(textAt(45, 603, 10, user.email || booking.userEmail || ""));
  lines.push(textAt(45, 570, 12, "BOOKING DETAILS", "0.9 0 0.14"));
  const details = [
    ["Studio", booking.studioTitle || "Creative studio"],
    ["Date", booking.date],
    ["Time", `${booking.startTime} - ${booking.endTime}`],
    ["Duration", `${booking.hours} hours`],
    ["Crew", String(booking.crewCount ?? "-")],
    ["Status", booking.status],
  ];
  let y = 546;
  for (const [label, value] of details) {
    lines.push(textAt(45, y, 10, `${label}:`));
    lines.push(textAt(150, y, 10, String(value).slice(0, 64)));
    y -= 22;
  }
  lines.push("0.86 0.86 0.86 RG 45 390 m 567 390 l S\n");
  lines.push(textAt(45, 366, 12, "CHARGES", "0.9 0 0.14"));
  lines.push(textAt(45, 339, 11, `Studio rental (${booking.hours} h x ${usd(booking.hourlyRate)}/h)`));
  lines.push(textAt(482, 339, 11, usd(booking.subtotal)));
  lines.push(textAt(45, 313, 11, "Security deposit"));
  lines.push(textAt(482, 313, 11, usd(booking.securityDeposit)));
  lines.push("0.86 0.86 0.86 RG 45 295 m 567 295 l S\n");
  lines.push(textAt(45, 269, 15, "TOTAL", "0.9 0 0.14"));
  lines.push(textAt(470, 269, 15, usd(booking.total), "0.9 0 0.14"));
  lines.push(textAt(45, 210, 10, "This invoice records a confirmed studio reservation."));
  lines.push(textAt(45, 193, 10, "It is not proof of payment unless separately confirmed."));
  lines.push(textAt(45, 70, 9, "FRAME | Creative Studio Marketplace", "0.5 0.5 0.5"));
  const stream = lines.join("");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function createInvoiceRouter(getDatabase) {
  const router = express.Router();
  router.get("/:id/invoice", async (req, res) => {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid booking ID." });
    }
    try {
      const auth = await getBetterAuth(getDatabase);
      const headers = new Headers();
      if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
      if (req.headers.origin) headers.set("origin", req.headers.origin);
      const session = await auth.api.getSession({ headers });
      if (!session?.user?.id) {
        return res.status(401).json({ success: false, message: "Please sign in." });
      }
      const db = await getDatabase();
      const booking = await db.collection("bookings").findOne({
        _id: new ObjectId(req.params.id),
        userId: session.user.id,
      });
      if (!booking) {
        return res.status(404).json({ success: false, message: "Booking not found." });
      }
      if (!["Confirmed", "Completed"].includes(booking.status)) {
        return res.status(409).json({ success: false, message: "Invoices are available only for confirmed bookings." });
      }
      const pdf = createInvoicePdf(booking, session.user);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="frame-invoice-${req.params.id}.pdf"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      return res.end(pdf);
    } catch (error) {
      console.error("Invoice generation:", error.message);
      return res.status(503).json({ success: false, message: "Unable to generate invoice." });
    }
  });
  return router;
}
module.exports = { createInvoiceRouter, createInvoicePdf };
