
const express = require("express");
const { getBetterAuth } = require("./betterAuth");

function createMyListingsRouter(getDatabase) {
    const router = express.Router();

    router.get("/", async (req, res) => {
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
                    message: "Please sign in to view your listings.",
                });
            }

            const db = await getDatabase();
            const userId = session.user.id;
            const userEmail = session.user.email;

            // New listings are associated with the verified host ID.
            // Legacy listings may use an email ownership field.
            const ownershipFilters = [{ hostId: userId }];

            if (userEmail) {
                ownershipFilters.push(
                    { hostEmail: userEmail },
                    { ownerEmail: userEmail }
                );
            }

            const studios = await db
                .collection("studios")
                .find({ $or: ownershipFilters })
                .sort({ createdAt: -1, _id: -1 })
                .toArray();

            return res.status(200).json({
                success: true,
                count: studios.length,
                studios,
            });
        } catch (error) {
            console.error("My listings error:", error.message);

            return res.status(503).json({
                success: false,
                message: "Unable to load your studio listings right now.",
            });
        }
    });

    return router;
}

module.exports = { createMyListingsRouter };
