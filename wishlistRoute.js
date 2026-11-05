
"use strict";

const express = require("express");
const { ObjectId } = require("mongodb");
const { getBetterAuth } = require("./betterAuth");

function createWishlistRouter(getDatabase) {
    const router = express.Router();

    async function requireSession(req, res, next) {
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
                    message: "Please sign in to use your wishlist.",
                });
            }

            req.wishlistUserId = session.user.id;
            next();
        } catch (error) {
            console.error(
                "Wishlist authentication:",
                error.message
            );

            res.status(503).json({
                success: false,
                message: "Unable to verify your session.",
            });
        }
    }

    router.use(requireSession);

    router.get("/", async (req, res) => {
        try {
            const db = await getDatabase();

            const saved = await db
                .collection("wishlists")
                .find({ userId: req.wishlistUserId })
                .sort({ createdAt: -1 })
                .toArray();

            const ids = saved.map((item) => item.studioId);

            const studios = ids.length
                ? await db
                    .collection("studios")
                    .find({ _id: { $in: ids } })
                    .toArray()
                : [];

            const byId = new Map(
                studios.map((studio) => [
                    String(studio._id),
                    studio,
                ])
            );

            res.set("Cache-Control", "no-store");

            return res.json({
                success: true,
                studioIds: ids.map(String),
                studios: ids
                    .map((id) => byId.get(String(id)))
                    .filter(Boolean),
            });
        } catch (error) {
            console.error("Wishlist read:", error.message);

            return res.status(503).json({
                success: false,
                message: "Unable to load your wishlist.",
            });
        }
    });

    router.put("/:studioId", async (req, res) => {
        const { studioId } = req.params;

        if (
            !ObjectId.isValid(studioId) ||
            String(new ObjectId(studioId)) !==
            studioId.toLowerCase()
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid studio ID.",
            });
        }

        try {
            const db = await getDatabase();

            const studio = await db
                .collection("studios")
                .findOne({
                    _id: new ObjectId(studioId),
                });

            if (!studio) {
                return res.status(404).json({
                    success: false,
                    message: "Studio not found.",
                });
            }

            await db.collection("wishlists").updateOne(
                {
                    userId: req.wishlistUserId,
                    studioId: studio._id,
                },
                {
                    $setOnInsert: {
                        userId: req.wishlistUserId,
                        studioId: studio._id,
                        createdAt: new Date(),
                    },
                },
                { upsert: true }
            );

            return res.json({
                success: true,
                saved: true,
                studioId,
            });
        } catch (error) {
            console.error("Wishlist save:", error.message);

            return res.status(503).json({
                success: false,
                message: "Unable to save this studio.",
            });
        }
    });

    router.delete("/:studioId", async (req, res) => {
        const { studioId } = req.params;

        if (
            !ObjectId.isValid(studioId) ||
            String(new ObjectId(studioId)) !==
            studioId.toLowerCase()
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid studio ID.",
            });
        }

        try {
            const db = await getDatabase();

            await db.collection("wishlists").deleteOne({
                userId: req.wishlistUserId,
                studioId: new ObjectId(studioId),
            });

            return res.json({
                success: true,
                saved: false,
                studioId,
            });
        } catch (error) {
            console.error(
                "Wishlist remove:",
                error.message
            );

            return res.status(503).json({
                success: false,
                message: "Unable to remove this studio.",
            });
        }
    });

    return router;
}

module.exports = { createWishlistRouter };
