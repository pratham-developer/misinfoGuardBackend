import express from "express";
import authenticateFirebaseUser from "../middleware/googleAuth.js";
import { User } from "../models/userModel.js";

const routerUser = express.Router();

// Login or Register User
routerUser.post("/login", authenticateFirebaseUser, async (req, res) => {
    const { email, name, uid } = req.user;
    if (!email || !name || !uid) {
        return res.status(400).json({ message: "Email, name & uid are required" });
    }

    try {
        let user = await User.findOne({ uid });
        if (!user) {
            user = new User({ uid, name, email });
            await user.save();
        }
        return res.status(200).json({
            message: "Logged in successfully",
            user: { uid: user.uid, email: user.email, name: user.name },
        });
    } catch (err) {
        console.error("Error logging in user:", err);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Get User Details
routerUser.get("/", authenticateFirebaseUser, async (req, res) => {
    const { uid } = req.user;
    if (!uid) {
        return res.status(400).json({ message: "Uid is required" });
    }

    try {
        const user = await User.findOne({ uid });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        return res.status(200).json({ message: "User retrieved successfully", user });
    } catch (err) {
        console.error("Error fetching user", err);
        return res.status(500).json({ message: "Server error" });
    }
});

export default routerUser;
