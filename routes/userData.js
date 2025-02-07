import express from "express";
import multer from "multer";
import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import authenticateFirebaseUser from "../middleware/googleAuth.js";
import { uploadToGoogleDrive } from "../config/googleDrive.js";
import { UserData } from "../models/userModel.js";

const routerUserData = express.Router();

const storage = multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => {
        cb(null, Date.now() + "_" + file.originalname);
    },
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ["video/mp4", "video/x-msvideo", "video/quicktime"];
    allowedTypes.includes(file.mimetype) ? cb(null, true) : cb(new Error("Invalid file type"), false);
};

const upload = multer({ storage, fileFilter });

routerUserData.post("/upload", authenticateFirebaseUser, upload.single("file"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded or invalid format" });

        const { email } = req.user;
        const formData = new FormData();
        if (!fs.existsSync(req.file.path)) return res.status(500).json({ message: "Temporary file not found" });

        const fileStream = fs.createReadStream(req.file.path);
        formData.append("file", fileStream);

        let flaskResponse;
        try {
            flaskResponse = await axios.post(`${process.env.FLASK_API_URL}/detect`, formData, {
                headers: { ...formData.getHeaders() },
                timeout: 30000,
            });
        } catch (flaskError) {
            fs.unlinkSync(req.file.path);
            return res.status(500).json({ message: "Flask API failed, upload canceled" });
        }

        if (flaskResponse.status !== 200) {
            fs.unlinkSync(req.file.path);
            return res.status(500).json({ message: "Unexpected Flask API response" });
        }

        const { score, is_deepfake } = flaskResponse.data;

        const fileUrl = await uploadToGoogleDrive(req.file);
        await UserData.findOneAndUpdate(
            { email },
            { $push: { files: { fileUrl, score, is_deepfake } } },
            { upsert: true, new: true }
        );

        fs.unlinkSync(req.file.path);

        return res.status(200).json({
            message: "File uploaded & link saved",
            fileUrl,
            score,
            is_deepfake,
        });

    } catch (err) {
        res.status(500).json({ message: "Error uploading file" });
    }
});

routerUserData.get("/", authenticateFirebaseUser, async (req, res) => {
    try {
        const { email } = req.user;
        const userData = await UserData.findOne({ email });

        if (!userData || !userData.files.length) {
            return res.status(404).json({ message: "No files found for this user" });
        }

        return res.status(200).json({ message: "User files retrieved successfully", files: userData.files });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

export default routerUserData;