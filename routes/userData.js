import express from "express";
import multer from "multer";
import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import authenticateFirebaseUser from "../middleware/googleAuth.js";
import { uploadToGoogleDrive } from "../config/googleDrive.js";
import { UserData } from "../models/userModel.js";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
const routerUserData = express.Router();

// Multer Storage Settings
const storage = multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    },
});

const upload = multer({ storage });

/**
 * Compress Video Before Uploading
 */
const compressVideo = (inputPath, outputPath) => {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .videoCodec("libx264")
            .audioCodec("aac")
            .audioBitrate("128k")
            .videoBitrate("1000k")
            .outputOptions([
                "-preset fast",
                "-crf 28",
                "-vf", "scale=640:-2:flags=lanczos",
                "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2"
            ])
            .format("mp4")
            .on("end", () => resolve())
            .on("error", (err) => reject(err))
            .save(outputPath);
    });
};

/**
 * Handlers for Different File Types
 */
const handlers = {
    "video": async (req, res, inputPath) => {
        const { email } = req.user;
        const compressedPath = `uploads/compressed_${req.file.filename}`;

        console.log(`Compressing video: ${inputPath}`);
        await compressVideo(inputPath, compressedPath);
        fs.unlinkSync(inputPath);

        console.log("Sending video to Flask API...");
        const formData = new FormData();
        formData.append("file", fs.createReadStream(compressedPath));

        let flaskResponse;
        try {
            flaskResponse = await axios.post(`${process.env.FLASK_API_URL}/detect`, formData, {
                headers: { ...formData.getHeaders() },
                timeout: 30000,
            });
        } catch (flaskError) {
            fs.unlinkSync(compressedPath);
            return res.status(500).json({ message: "Flask API failed, upload canceled" });
        }

        const { score, is_deepfake } = flaskResponse.data;

        const fileUrl = await uploadToGoogleDrive({ path: compressedPath, originalname: req.file.filename });
        fs.unlinkSync(compressedPath);

        await UserData.findOneAndUpdate(
            { email },
            { $push: { files: { fileName: req.file.originalname, fileUrl, score, is_deepfake } } },
            { upsert: true, new: true }
        );

        return res.status(200).json({
            message: "Video processed & uploaded",
            fileName: req.file.originalname,
            fileUrl,
            score,
            is_deepfake,
        });
    },

    "image": async (req, res, inputPath) => {
        const { email } = req.user;
        console.log("Sending image to Image Processing API...");

        const formData = new FormData();
        formData.append("file", fs.createReadStream(inputPath));

        try {
            const imageResponse = await axios.post(`${process.env.IMAGE_API_URL}/detect`, formData, {
                headers: { ...formData.getHeaders() },
                timeout: 30000,
            });

            if (imageResponse.status !== 200) throw new Error("Image API failed");

            const { is_deepfake, probability } = imageResponse.data;
            const fileUrl = await uploadToGoogleDrive({ path: inputPath, originalname: req.file.filename });
            fs.unlinkSync(inputPath);

            await UserData.findOneAndUpdate(
                { email },
                { $push: { files: { fileName: req.file.originalname, fileUrl, is_deepfake, score: probability } } },
                { upsert: true, new: true }
            );

            return res.status(200).json({
                message: "Image processed & uploaded",
                fileName: req.file.originalname,
                fileUrl,
                is_deepfake,
                score: probability,
            });

        } catch (error) {
            fs.unlinkSync(inputPath);
            return res.status(500).json({ message: "Image processing failed", error: error.message });
        }
    }
};

/**
 * Upload Route
 */
routerUserData.post("/upload", authenticateFirebaseUser, upload.single("file"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded or invalid format" });

        const inputPath = req.file.path;
        const fileType = req.file.mimetype.split("/")[0]; // Get 'video' or 'image'
        console.log(`Processing file: ${req.file.originalname}, Type: ${fileType}`);

        // Choose the correct handler dynamically
        const handler = handlers[fileType];
        console.log(handler)
        if (!handler) {
            fs.unlinkSync(inputPath);
            return res.status(400).json({ message: "Unsupported file type" });
        }

        await handler(req, res, inputPath);
    } catch (err) {
        console.error("Error in file processing:", err);
        res.status(500).json({ message: "Error uploading file" });
    }
});

// Route to get user-uploaded videos
routerUserData.get("/", authenticateFirebaseUser, async (req, res) => {
    try {
        const { email } = req.user;
        const userData = await UserData.findOne({ email });

        if (!userData || !userData.files.length) {
            return res.status(404).json({ message: "No files found for this user" });
        }

        return res.status(200).json({ message: "User files retrieved successfully", files: userData.files });
    } catch (err) {
        console.error("Error fetching user files:", err);
        res.status(500).json({ message: "Server error" });
    }
});

export default routerUserData;
