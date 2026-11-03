
let authPromise = null;

function getRequiredEnv(name) {
    const value = process.env[name]?.trim();

    if (!value) {
        throw new Error(`${name} is missing or empty.`);
    }

    return value;
}

function normalizeOrigin(value) {
    if (!value) return null;

    try {
        const url = new URL(value.trim());

        if (
            url.protocol !== "http:" &&
            url.protocol !== "https:"
        ) {
            throw new Error("Unsupported protocol");
        }

        return url.origin;
    } catch {
        throw new Error(
            "CLIENT_URL must be a valid HTTP or HTTPS URL."
        );
    }
}

function getBetterAuth(getDatabase) {
    if (!authPromise) {
        authPromise = (async () => {
            const { betterAuth } = await import("better-auth");
            const { mongodbAdapter } = await import(
                "better-auth/adapters/mongodb"
            );

            const db = await getDatabase();

            const secret = getRequiredEnv(
                "BETTER_AUTH_SECRET"
            );

            if (secret.length < 32) {
                throw new Error(
                    "BETTER_AUTH_SECRET must be at least 32 characters."
                );
            }

            const isProduction =
                process.env.NODE_ENV === "production";

            const baseURL = (
                process.env.BETTER_AUTH_URL?.trim() ||
                `http://localhost:${process.env.PORT || 5000}`
            ).replace(/\/+$/, "");

            const frontendOrigins = [
                "http://localhost:3000",
                "https://frame-client.vercel.app",
            ];

            if (process.env.CLIENT_URL?.trim()) {
                frontendOrigins.push(
                    normalizeOrigin(process.env.CLIENT_URL)
                );
            }

            const trustedOrigins = [
                ...new Set(frontendOrigins),
            ];

            const googleClientId =
                process.env.GOOGLE_CLIENT_ID?.trim();

            const googleClientSecret =
                process.env.GOOGLE_CLIENT_SECRET?.trim();

            if (
                Boolean(googleClientId) !==
                Boolean(googleClientSecret)
            ) {
                throw new Error(
                    "Both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together."
                );
            }

            const socialProviders =
                googleClientId && googleClientSecret
                    ? {
                        google: {
                            clientId: googleClientId,
                            clientSecret: googleClientSecret,
                        },
                    }
                    : {};

            console.log("Better Auth configuration:", {
                baseURL,
                trustedOrigins,
                googleEnabled: Boolean(
                    googleClientId && googleClientSecret
                ),
                secureCookies: isProduction,
            });

            return betterAuth({
                appName: "Frame",

                baseURL,
                basePath: "/api/auth",

                secret,

                database: mongodbAdapter(db),

                trustedOrigins,

                emailAndPassword: {
                    enabled: true,
                    minPasswordLength: 6,
                    maxPasswordLength: 128,
                    requireEmailVerification: false,
                    autoSignIn: false,
                },

                socialProviders,

                advanced: {
                    useSecureCookies: isProduction,

                    defaultCookieAttributes: isProduction
                        ? {
                            sameSite: "none",
                            secure: true,
                            httpOnly: true,
                        }
                        : {
                            sameSite: "lax",
                            secure: false,
                            httpOnly: true,
                        },
                },
            });
        })().catch((error) => {
            authPromise = null;
            throw error;
        });
    }

    return authPromise;
}

async function betterAuthMiddleware(
    req,
    res,
    getDatabase
) {
    try {
        const { toNodeHandler } = await import(
            "better-auth/node"
        );

        const auth = await getBetterAuth(getDatabase);
        const handler = toNodeHandler(auth);

        return handler(req, res);
    } catch (error) {
        console.error(
            "Better Auth unavailable:",
            error.message
        );

        if (!res.headersSent) {
            return res.status(503).json({
                success: false,
                message:
                    "Authentication is temporarily unavailable.",
            });
        }
    }
}

module.exports = {
    getBetterAuth,
    betterAuthMiddleware,
};
