import admin from "../config/firebase.js";

const authenticateFirebaseUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    console.log(token)
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (err) {
        console.error("Firebase Authentication Error:", err);
        return res.status(401).json({ message: "Unauthorized" });
    }
};

export default authenticateFirebaseUser;
