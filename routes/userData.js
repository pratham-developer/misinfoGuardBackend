import express from "express";
import multer from "multer";
import fs from "fs"; // ✅ Supports createReadStream
import { promises as fsPromises } from "fs"; // ✅ Use this for async operations like unlink
import axios from "axios";
import FormData from "form-data";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import sharp from "sharp";
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
 * ✅ Utility: Wait for File to Exist Before Processing
 */
const waitForFile = async (path, retries = 5, delay = 500) => {
    for (let i = 0; i < retries; i++) {
        try {
            await fsPromises.access(path);
            return true; // ✅ File exists
        } catch (error) {
            console.log(`🔄 File not found, retrying... (${i + 1})`);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw new Error(`❌ File not found after ${retries} retries: ${path}`);
};

/**
 * 📹 Compress Video Before Uploading
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
                "-vf", "scale=640:-2:flags=lanczos,pad=ceil(iw/2)*2:ceil(ih/2)*2"
            ])
            .format("mp4")
            .on("end", () => resolve())
            .on("error", (err) => reject(err))
            .save(outputPath);
    });
};

/**
 * 🖼️ Compress Image Before Uploading
 */
const compressImage = async (inputPath, outputPath) => {
    try {
        await fsPromises.access(inputPath); // ✅ Ensure file exists
        await sharp(inputPath)
            .resize({ width: 800 })
            .jpeg({ quality: 75 })
            .toFile(outputPath);
        console.log("✅ Image compression successful:", outputPath);
    } catch (err) {
        console.error("❌ Error in image processing:", err);
        throw err;
    }
};

/**
 * 🔹 Handlers for Different File Types
 */
const handlers = {
    "video": async (req, res, inputPath) => {
        const { email } = req.user;
        const compressedPath = `uploads/compressed_${req.file.filename}`;

        console.log(`📹 Compressing video: ${inputPath}`);
        await compressVideo(inputPath, compressedPath);
        await fsPromises.unlink(inputPath); // ✅ Delete original file

        console.log("📡 Sending video to Flask API...");
        const formData = new FormData();
        formData.append("file", fs.createReadStream(compressedPath)); // ✅ Now works

        let flaskResponse;
        try {
            flaskResponse = await axios.post(`${process.env.FLASK_API_URL}/detect`, formData, {
                headers: { ...formData.getHeaders() },
                timeout: 30000,
            });
        } catch (flaskError) {
            await fsPromises.unlink(compressedPath);
            return res.status(500).json({ message: "Flask API failed, upload canceled" });
        }

        const { score, is_deepfake } = flaskResponse.data;

        const fileUrl = await uploadToGoogleDrive({ path: compressedPath, originalname: req.file.filename });
        await fsPromises.unlink(compressedPath);

        await UserData.findOneAndUpdate(
            { email },
            { $push: { files: { fileName: req.file.originalname, fileUrl, score, is_deepfake } } },
            { upsert: true, new: true }
        );

        return res.status(200).json({
            message: "✅ Video processed & uploaded",
            fileName: req.file.originalname,
            fileUrl,
            score,
            is_deepfake,
        });
    },

    "image": async (req, res, inputPath) => {
        const { email } = req.user;
        const compressedPath = `uploads/compressed_${req.file.filename}`;

        console.log(`🖼️ Compressing image: ${inputPath}`);
        await compressImage(inputPath, compressedPath);
        await fsPromises.unlink(inputPath); // ✅ Delete original file

        console.log("📡 Sending image to Image Processing API...");
        const formData = new FormData();
        formData.append("file", fs.createReadStream(compressedPath)); // ✅ Now works

        try {
            const imageResponse = await axios.post(`${process.env.IMAGE_API_URL}/detect`, formData, {
                headers: { ...formData.getHeaders() },
                timeout: 30000,
            });

            if (imageResponse.status !== 200) throw new Error("Image API failed");

            const { is_deepfake, probability } = imageResponse.data;

            const fileUrl = await uploadToGoogleDrive({ path: compressedPath, originalname: req.file.filename });
            await fsPromises.unlink(compressedPath);

            await UserData.findOneAndUpdate(
                { email },
                { $push: { files: { fileName: req.file.originalname, fileUrl, is_deepfake, score: probability } } },
                { upsert: true, new: true }
            );

            return res.status(200).json({
                message: "✅ Image processed & uploaded",
                fileName: req.file.originalname,
                fileUrl,
                is_deepfake,
                score: probability,
            });

        } catch (error) {
            await fsPromises.unlink(compressedPath);
            return res.status(500).json({ message: "❌ Image processing failed", error: error.message });
        }
    }
};

/**
 * 🚀 Upload Route
 */
routerUserData.post("/upload", authenticateFirebaseUser, upload.single("file"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded or invalid format" });

        const inputPath = req.file.path;
        const fileType = req.file.mimetype.split("/")[0]; // Get 'video' or 'image'

        console.log(`📂 Processing file: ${req.file.originalname}, Type: ${fileType}`);

        // ✅ Wait for file before processing
        await waitForFile(inputPath);

        const handler = handlers[fileType];
        if (!handler) {
            await fsPromises.unlink(inputPath);
            return res.status(400).json({ message: "Unsupported file type" });
        }

        await handler(req, res, inputPath);
    } catch (err) {
        console.error("❌ Error in file processing:", err);
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
