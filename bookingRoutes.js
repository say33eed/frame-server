
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
