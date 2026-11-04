
const express = require("express");
const { ObjectId } = require("mongodb");
const { getBetterAuth } = require("./betterAuth");

const CATEGORIES = [
    "Photo Studio",
    "Film Stage",
    "Podcast Lounge",
    "Music Suite",
    "Workshop",
];

function createStudioEditRouter(getDatabase) {
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
                    message: "Please sign in to manage this studio.",
                });
            }

            req.authenticatedUser = session.user;
            next();
        } catch (error) {
            console.error(
                "Studio management authentication:",
                error.message
            );

            return res.status(503).json({
                success: false,
                message: "Authentication is temporarily unavailable.",
            });
        }
    }

    function ownerFilter(user) {
        // Prefer the stable Better Auth user ID.
        // Email fallback is restricted to legacy records
        // that do not already have a hostId.
        const filters = [{ hostId: user.id }];

        if (user.email) {
            filters.push({
                hostId: { $exists: false },
                $or: [
                    { hostEmail: user.email },
                    { ownerEmail: user.email },
                ],
            });
        }

        return { $or: filters };
    }

    function studioFilter(id, user) {
        return {
            _id: new ObjectId(id),
            ...ownerFilter(user),
        };
    }

    function isValidStudioId(id) {
        return (
            typeof id === "string" &&
            /^[a-fA-F0-9]{24}$/.test(id) &&
            ObjectId.isValid(id)
        );
    }

    function validateStudio(body) {
        if (
            !body ||
            typeof body !== "object" ||
            Array.isArray(body)
        ) {
            return {
                error: "Invalid studio information.",
            };
        }

        const title =
            typeof body.title === "string"
                ? body.title.trim()
                : "";

        const category =
            typeof body.category === "string"
                ? body.category.trim()
                : "";

        const location =
            typeof body.location === "string"
                ? body.location.trim()
                : "";

        const overview =
            typeof body.overview === "string"
                ? body.overview.trim()
                : "";

        const imageUrl =
            typeof body.imageUrl === "string"
                ? body.imageUrl.trim()
                : "";

        const images = Array.isArray(body.images)
            ? [...new Set(body.images.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))]
            : (imageUrl ? [imageUrl] : []);
        if (images.length > 10 || images.some((value) => {
            try { return !["http:", "https:"].includes(new URL(value).protocol); }
            catch { return true; }
        })) {
            return { error: "Provide up to 10 valid gallery image URLs." };
        }
        const studioImages = [...new Set([imageUrl, ...images].filter(Boolean))];
        const pricePerHour = Number(body.pricePerHour);
        const securityDeposit = Number(body.securityDeposit);
        const maxCapacity = Number(body.maxCapacity);

        if (title.length < 5 || title.length > 150) {
            return {
                error: "Title must contain 5–150 characters.",
            };
        }

        if (!CATEGORIES.includes(category)) {
            return {
                error: "Please select a valid category.",
            };
        }

        if (
            !Number.isFinite(pricePerHour) ||
            pricePerHour <= 0 ||
            pricePerHour > 100000
        ) {
            return {
                error: "Enter a valid hourly rate.",
            };
        }

        if (
            !Number.isFinite(securityDeposit) ||
            securityDeposit < 0 ||
            securityDeposit > 1000000
        ) {
            return {
                error: "Enter a valid security deposit.",
            };
        }

        if (
            !Number.isInteger(maxCapacity) ||
            maxCapacity < 1 ||
            maxCapacity > 10000
        ) {
            return {
                error: "Enter a valid maximum capacity.",
            };
        }

        if (
            location.length < 5 ||
            location.length > 300
        ) {
            return {
                error: "Enter a valid location.",
            };
        }

        if (
            overview.length < 20 ||
            overview.length > 10000
        ) {
            return {
                error:
                    "Overview must contain 20–10,000 characters.",
            };
        }

        if (imageUrl) {
            try {
                const url = new URL(imageUrl);

                if (
                    !["http:", "https:"].includes(
                        url.protocol
                    )
                ) {
                    throw new Error("Invalid protocol");
                }
            } catch {
                return {
                    error: "Enter a valid image URL.",
                };
            }
        }

        if (
            !Array.isArray(body.amenities) ||
            body.amenities.length > 50 ||
            !body.amenities.every(
                (item) =>
                    typeof item === "string" &&
                    item.trim().length > 0 &&
                    item.length <= 100
            )
        ) {
            return {
                error: "Invalid amenities list.",
            };
        }

        const amenities = [
            ...new Set(
                body.amenities.map((item) => item.trim())
            ),
        ];

        return {
            values: {
                title,
                name: title,
                category,
                location,
                overview,
                description: overview,
                imageUrl,
                images: studioImages,
                pricePerHour,
                securityDeposit,
                maxCapacity,
                amenities,
            },
        };
    }

    // GET /api/studios/manage/:id
    // Retrieve an existing studio for its owner.
    router.get("/:id", authenticate, async (req, res) => {
        try {
            if (!isValidStudioId(req.params.id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid studio ID.",
                });
            }

            const db = await getDatabase();

            const studio = await db
                .collection("studios")
                .findOne(
                    studioFilter(
                        req.params.id,
                        req.authenticatedUser
                    )
                );

            if (!studio) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Studio not found or access denied.",
                });
            }

            return res.status(200).json({
                success: true,
                studio,
            });
        } catch (error) {
            console.error(
                "Load studio for edit:",
                error.message
            );

            return res.status(503).json({
                success: false,
                message:
                    "Unable to load this studio right now.",
            });
        }
    });

    // PATCH /api/studios/manage/:id
    // Update only the authenticated owner's studio.
    router.patch("/:id", authenticate, async (req, res) => {
        try {
            if (!isValidStudioId(req.params.id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid studio ID.",
                });
            }

            const validation = validateStudio(req.body);

            if (validation.error) {
                return res.status(400).json({
                    success: false,
                    message: validation.error,
                });
            }

            const db = await getDatabase();

            const filter = studioFilter(
                req.params.id,
                req.authenticatedUser
            );

            const update = {
                ...validation.values,
                updatedAt: new Date(),
            };

            const result = await db
                .collection("studios")
                .updateOne(filter, {
                    $set: update,
                });

            if (result.matchedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Studio not found or access denied.",
                });
            }

            return res.status(200).json({
                success: true,
                message: "Studio updated successfully.",
            });
        } catch (error) {
            console.error(
                "Update studio:",
                error.message
            );

            return res.status(503).json({
                success: false,
                message:
                    "Unable to update this studio right now.",
            });
        }
    });

    // DELETE /api/studios/manage/:id
    // Permanently delete an owned studio.
    //
    // The MongoDB filter checks BOTH the studio ID
    // and authenticated ownership in one operation.
    router.delete("/:id", authenticate, async (req, res) => {
        try {
            if (!isValidStudioId(req.params.id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid studio ID.",
                });
            }

            const db = await getDatabase();

            const filter = studioFilter(
                req.params.id,
                req.authenticatedUser
            );

            const result = await db
                .collection("studios")
                .deleteOne(filter);

            if (result.deletedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Studio not found or access denied.",
                });
            }

            return res.status(200).json({
                success: true,
                message: "Studio deleted successfully.",
                deletedStudioId: req.params.id,
            });
        } catch (error) {
            console.error(
                "Delete studio:",
                error.message
            );

            return res.status(503).json({
                success: false,
                message:
                    "Unable to delete this studio right now.",
            });
        }
    });

    return router;
}

module.exports = {
    createStudioEditRouter,
};
