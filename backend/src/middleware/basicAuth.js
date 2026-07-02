import crypto from "crypto";
import config from "../config/index.js";

let hasWarnedNoAuth = false;

function safeEqual(a, b) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

export default function basicAuth(req, res, next) {
    if (req.path === "/api/health") return next();

    const { basicAuthUser, basicAuthPass } = config;
    if (!basicAuthUser || !basicAuthPass) {
        if (!hasWarnedNoAuth) {
            console.warn(
                "[basicAuth] BASIC_AUTH_USER/BASIC_AUTH_PASS not set -- app is reachable by anyone with the URL"
            );
            hasWarnedNoAuth = true;
        }
        return next();
    }

    const header = req.headers.authorization || "";
    const [scheme, encoded] = header.split(" ");

    if (scheme === "Basic" && encoded) {
        const decoded = Buffer.from(encoded, "base64").toString("utf8");
        const sepIndex = decoded.indexOf(":");
        if (sepIndex !== -1) {
            const user = decoded.slice(0, sepIndex);
            const pass = decoded.slice(sepIndex + 1);
            if (safeEqual(user, basicAuthUser) && safeEqual(pass, basicAuthPass)) {
                return next();
            }
        }
    }

    res.set("WWW-Authenticate", 'Basic realm="DME Desk Prospector"');
    return res.status(401).send("Authentication required");
}
