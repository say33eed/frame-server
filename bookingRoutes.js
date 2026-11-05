
const express = require("express");
const { ObjectId } = require("mongodb");
const { getBetterAuth } = require("./betterAuth");

function createBookingRouter(getDatabase) {
    const router = express.Router();

    async function authenticate(req, res, next) {
        try {
            const auth = await getBetterAuth(getDatabase);
            const headers = new Headers();

            if (req.headers.cookie) {
                headers.set("cookie", req.headers.cookie);
            }

            if (req.headers.origin) {
                headers.set("origin", req.headers.origin);
            }

            const session = await auth.api.getSession({ headers });

            if (!session?.user?.id) {
                return res.status(401).json({
                    success: false,
                    message: "Please sign in to manage bookings.",
                });
            }

            req.authenticatedUser = session.user;
            next();
        } catch (error) {
            console.error("Booking authentication:", error.message);
            res.status(503).json({
                success: false,
                message: "Authentication is temporarily unavailable.",
            });
        }
    }

    function validId(id) {
        return typeof id === "string" &&
            /^[a-f\d]{24}$/i.test(id) &&
            ObjectId.isValid(id);
    }

    function validDate(value) {
        if (typeof value !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return false;
        }

        const date = new Date(`${value}T00:00:00.000Z`);

        return !Number.isNaN(date.getTime()) &&
            date.toISOString().slice(0, 10) === value;
    }

    function validTime(value) {
        return typeof value === "string" &&
            /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    }

    function minutes(value) {
        const [hours, mins] = value.split(":").map(Number);
        return hours * 60 + mins;
    }

    // Create a pending reservation.
    router.post("/", authenticate, async (req, res) => {
        try {
            const {
                studioId,
                date,
                startTime,
                endTime,
                crewCount,
                notes = "",
            } = req.body || {};

            if (!validId(studioId)) {
                return res.status(400).json({
                    success: false,
                    message: "Please select a valid studio.",
                });
            }

            if (!validDate(date) ||
                !validTime(startTime) ||
                !validTime(endTime)) {
                return res.status(400).json({
                    success: false,
                    message: "Please provide a valid date and time.",
                });
            }

            const start = minutes(startTime);
            const end = minutes(endTime);
            const duration = end - start;

            if (duration <= 0 || duration > 1440) {
                return res.status(400).json({
                    success: false,
                    message: "End time must be after start time.",
                });
            }

            const requestedStart = new Date(`${date}T${startTime}:00Z`);

            if (requestedStart.getTime() <= Date.now()) {
                return res.status(400).json({
                    success: false,
                    message: "Please choose a future booking slot.",
                });
            }

            if (!Number.isInteger(crewCount) || crewCount < 1) {
                return res.status(400).json({
                    success: false,
                    message: "Enter a valid crew count.",
                });
            }

            if (typeof notes !== "string" || notes.length > 2000) {
                return res.status(400).json({
                    success: false,
                    message: "Production notes must be under 2,000 characters.",
                });
            }

            const db = await getDatabase();
            const studio = await db.collection("studios").findOne({
                _id: new ObjectId(studioId),
            });

            if (!studio) {
                return res.status(404).json({
                    success: false,
                    message: "Studio not found.",
                });
            }

            if (crewCount > studio.maxCapacity) {
                return res.status(400).json({
                    success: false,
                    message: `This studio allows a maximum of ${studio.maxCapacity} people.`,
                });
            }

            if (studio.hostId === req.authenticatedUser.id ||
                studio.hostEmail === req.authenticatedUser.email ||
                studio.ownerEmail === req.authenticatedUser.email) {
                return res.status(403).json({
                    success: false,
                    message: "You cannot book your own studio.",
                });
            }

            const overlap = await db.collection("bookings").findOne({
                studioId: studio._id,
                date,
                status: "Confirmed",
                startMinutes: { $lt: end },
                endMinutes: { $gt: start },
            });

            if (overlap) {
                return res.status(409).json({
                    success: false,
                    message: "This time overlaps an existing confirmed booking.",
                });
            }

            const hours = duration / 60;
            const hourlyRate = Number(studio.pricePerHour);
            const deposit = Number(studio.securityDeposit || 0);

            if (!Number.isFinite(hourlyRate) || hourlyRate <= 0 ||
                !Number.isFinite(deposit) || deposit < 0) {
                return res.status(422).json({
                    success: false,
                    message: "Studio pricing is unavailable.",
                });
            }

            const subtotal = Math.round(hourlyRate * hours * 100) / 100;
            const total = Math.round((subtotal + deposit) * 100) / 100;

            const booking = {
                studioId: studio._id,
                studioTitle: studio.title || studio.name || "Studio",
                studioImage: studio.imageUrl || studio.images?.[0] || "",
                userId: req.authenticatedUser.id,
                userEmail: req.authenticatedUser.email || "",
                date,
                startTime,
                endTime,
                startMinutes: start,
                endMinutes: end,
                crewCount,
                notes: notes.trim(),
                hours,
                hourlyRate,
                subtotal,
                securityDeposit: deposit,
                total,
                status: "Pending",
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const result = await db.collection("bookings").insertOne(booking);

            res.status(201).json({
                success: true,
                message: "Booking request submitted successfully.",
                booking: {
                    ...booking,
                    _id: result.insertedId,
                },
            });
        } catch (error) {
            console.error("Create booking:", error.message);
            res.status(503).json({
                success: false,
                message: "Unable to create booking. Please try again.",
            });
        }
    });

    // Retrieve only the signed-in user's bookings.
    router.get("/mine", authenticate, async (req, res) => {
        try {
            const db = await getDatabase();

            const bookings = await db.collection("bookings")
                .find({ userId: req.authenticatedUser.id })
                .sort({ createdAt: -1 })
                .toArray();

            res.json({
                success: true,
                count: bookings.length,
                bookings,
            });
        } catch (error) {
            console.error("My bookings:", error.message);
            res.status(503).json({
                success: false,
                message: "Unable to load your bookings.",
            });
        }
    });


    // Host inbox: only reservations for studios owned by this authenticated user.
    router.get("/host", authenticate, async (req, res) => {
        try {
            const db = await getDatabase();
            const user = req.authenticatedUser;
            const owners = [{ hostId: user.id }];
            if (user.email) owners.push({ hostEmail: user.email }, { ownerEmail: user.email });
            const studios = await db.collection("studios")
                .find({ $or: owners }, { projection: { _id: 1, title: 1, name: 1 } }).toArray();
            if (!studios.length) return res.json({ success: true, bookings: [], count: 0 });
            const titles = new Map(studios.map(studio => [String(studio._id), studio.title || studio.name || "Studio"]));
            const bookings = await db.collection("bookings")
                .find({ studioId: { $in: studios.map(studio => studio._id) } })
                .sort({ createdAt: -1 }).limit(200).toArray();
            return res.json({ success: true, count: bookings.length,
                bookings: bookings.map(booking => ({
                    _id: booking._id, studioId: booking.studioId,
                    studioTitle: titles.get(String(booking.studioId)) || booking.studioTitle,
                    date: booking.date, startTime: booking.startTime, endTime: booking.endTime,
                    crewCount: booking.crewCount, total: booking.total,
                    userEmail: booking.userEmail, notes: booking.notes,
                    status: booking.status, createdAt: booking.createdAt,
                })) });
        } catch (error) {
            console.error("Host booking inbox:", error.message);
            return res.status(503).json({ success: false, message: "Unable to load incoming booking requests." });
        }
    });

    // Confirm or decline a pending booking. The JWT middleware in server.js
    // additionally protects PATCH requests before they reach this handler.
    router.patch("/:id/host-decision", authenticate, async (req, res) => {
        const { randomUUID } = require("node:crypto");
        const decision = req.body?.decision;
        if (!validId(req.params.id) || !["confirm", "cancel"].includes(decision)) {
            return res.status(400).json({ success: false, message: "Invalid booking or decision." });
        }
        let db;
        let lockedStudioId = null;
        let lockToken = null;
        try {
            db = await getDatabase();
            const bookings = db.collection("bookings");
            const studios = db.collection("studios");
            const bookingId = new ObjectId(req.params.id);
            const booking = await bookings.findOne({ _id: bookingId });
            if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });
            const studio = await studios.findOne({ _id: booking.studioId });
            if (!studio) return res.status(404).json({ success: false, message: "Studio no longer exists." });
            const user = req.authenticatedUser;
            const ownsStudio = studio.hostId === user.id ||
                (Boolean(user.email) && (studio.hostEmail === user.email || studio.ownerEmail === user.email));
            if (!ownsStudio) return res.status(403).json({ success: false, message: "Only the studio host can manage this request." });
            if (booking.status !== "Pending") return res.status(409).json({
                success: false, message: `This request is already ${String(booking.status).toLowerCase()}. Refresh to see its latest status.`,
            });

            if (decision === "confirm") {
                // Serialize confirmations for each studio across server instances.
                // The lease is released in finally, including on database errors.
                lockToken = randomUUID();
                const now = new Date();
                const lock = await studios.updateOne({ _id: studio._id,
                    $or: [
                        { bookingDecisionLock: { $exists: false } },
                        { "bookingDecisionLock.expiresAt": { $lte: now } },
                    ],
                }, { $set: { bookingDecisionLock: {
                    token: lockToken, expiresAt: new Date(now.getTime() + 120000),
                } } });
                if (!lock.modifiedCount) return res.status(409).json({
                    success: false, message: "Another request for this studio is being processed. Please refresh shortly.",
                });
                lockedStudioId = studio._id;
                const start = new Date(`${booking.date}T${booking.startTime}:00Z`);
                if (!Number.isFinite(start.getTime()) || start.getTime() <= Date.now()) {
                    return res.status(409).json({ success: false, message: "This booking slot is in the past and cannot be confirmed." });
                }
                const overlapping = await bookings.findOne({
                    _id: { $ne: bookingId }, studioId: studio._id, date: booking.date,
                    status: "Confirmed", startMinutes: { $lt: booking.endMinutes },
                    endMinutes: { $gt: booking.startMinutes },
                });
                if (overlapping) return res.status(409).json({
                    success: false, message: "Another confirmed booking already occupies this time slot.",
                });
            }
            const nextStatus = decision === "confirm" ? "Confirmed" : "Cancelled";
            const updated = await bookings.findOneAndUpdate(
                { _id: bookingId, studioId: studio._id, status: "Pending" },
                { $set: { status: nextStatus, updatedAt: new Date(),
                    hostDecisionAt: new Date(), hostDecisionBy: user.id } },
                { returnDocument: "after" }
            );
            if (!updated) return res.status(409).json({
                success: false, message: "This booking has already changed. Refresh to see its status.",
            });
            return res.json({ success: true, message: decision === "confirm"
                ? "Booking confirmed successfully." : "Booking request declined.",
                booking: { _id: updated._id, status: updated.status } });
        } catch (error) {
            console.error("Host booking decision:", error.message);
            return res.status(503).json({ success: false,
                message: "Unable to update this booking. Refresh the inbox to check its status before trying again." });
        } finally {
            if (lockedStudioId && lockToken && db) {
                try { await db.collection("studios").updateOne(
                    { _id: lockedStudioId, "bookingDecisionLock.token": lockToken },
                    { $unset: { bookingDecisionLock: "" } }
                ); } catch (error) { console.error("Release booking lock:", error.message); }
            }
        }
    });

    // Cancel only your own pending booking.
    router.patch("/:id/cancel", authenticate, async (req, res) => {
        try {
            if (!validId(req.params.id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid booking ID.",
                });
            }

            const db = await getDatabase();

            const result = await db.collection("bookings").findOneAndUpdate(
                {
                    _id: new ObjectId(req.params.id),
                    userId: req.authenticatedUser.id,
                    status: "Pending",
                },
                {
                    $set: {
                        status: "Cancelled",
                        updatedAt: new Date(),
                    },
                },
                { returnDocument: "after" }
            );

            if (!result) {
                return res.status(404).json({
                    success: false,
                    message: "Pending booking not found or cannot be cancelled.",
                });
            }

            res.json({
                success: true,
                message: "Booking cancelled successfully.",
                booking: result,
            });
        } catch (error) {
            console.error("Cancel booking:", error.message);
            res.status(503).json({
                success: false,
                message: "Unable to cancel booking.",
            });
        }
    });

    return router;
}

module.exports = { createBookingRouter };
