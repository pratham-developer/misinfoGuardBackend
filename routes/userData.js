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

// Multer storage settings
const storage = multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    },
});

// File filter for video formats
const fileFilter = (req, file, cb) => {
    const allowedTypes = ["video/mp4", "video/x-msvideo", "video/quicktime"];
    allowedTypes.includes(file.mimetype) ? cb(null, true) : cb(new Error("Invalid file type"), false);
};

const upload = multer({ storage, fileFilter });

/**
 * Compress video using FFmpeg before sending to Flask API
 * - Reduces resolution to 640px width (maintains aspect ratio)
 * - Lowers bitrate to 800k for compression
 * - Converts to MP4 format
 */
const compressVideo = (inputPath, outputPath) => {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .videoCodec("libx264")  // H.264 codec
            .audioCodec("aac")       // AAC audio
            .audioBitrate("128k")    // Set audio bitrate
            .videoBitrate("1000k")   // Set video bitrate
            .outputOptions([
                "-preset fast",  // Speed-optimized compression
                "-crf 28",       // Compression level (28 is a good balance)
                "-vf", "scale=640:-2:flags=lanczos",  // Resize width to 640px while maintaining aspect ratio
                "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2"  // Ensure dimensions are even
            ])
            .format("mp4") 
            .on("end", () => {
                console.log("✅ Compression successful:", outputPath);
                resolve();
            })
            .on("error", (err) => {
                console.error("❌ FFmpeg Compression Error:", err);
                reject(err);
            })
            .save(outputPath);
    });
};



// Route to upload video, compress it, send to Flask API, and upload to Google Drive
routerUserData.post("/upload", authenticateFirebaseUser, upload.single("file"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded or invalid format" });

        const { email } = req.user;
        const inputPath = req.file.path;
        const compressedPath = `uploads/compressed_${req.file.filename}`;

        console.log(`Compressing video: ${inputPath}`);

        // Compress the video
        await compressVideo(inputPath, compressedPath);

        // ✅ Unlink (delete) original file after compression
        fs.unlinkSync(inputPath);
        console.log(`Original file deleted: ${inputPath}`);

        console.log("Compression complete. Sending to Flask API...");

        // Send the compressed video to Flask API for detection
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

        if (flaskResponse.status !== 200) {
            fs.unlinkSync(compressedPath);
            return res.status(500).json({ message: "Unexpected Flask API response" });
        }

        const { score, is_deepfake } = flaskResponse.data;
        console.log("Flask API response received. Uploading to Google Drive...");

        // Upload the compressed video to Google Drive
        const fileUrl = await uploadToGoogleDrive({ path: compressedPath, originalname: req.file.filename });

        console.log("Upload to Google Drive complete. Saving data to DB...");

        // Save to MongoDB
        await UserData.findOneAndUpdate(
            { email },
            { $push: { files: { fileName: req.file.originalname, fileUrl, score, is_deepfake } } },
            { upsert: true, new: true }
        );

        // ✅ Unlink compressed file after successful upload
        fs.unlinkSync(compressedPath);
        console.log(`Compressed file deleted: ${compressedPath}`);

        return res.status(200).json({
            message: "File compressed, uploaded & link saved",
            fileName: req.file.originalname,
            fileUrl,
            score,
            is_deepfake,
        });

    } catch (err) {
        console.error("Error in video processing:", err);
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
