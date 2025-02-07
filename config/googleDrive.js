import { google } from "googleapis";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

async function authorize() {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT, "base64").toString("utf-8")),
            scopes: ["https://www.googleapis.com/auth/drive.file"],
        });

        return auth.getClient();
    } catch (err) {
        console.error("❌ Google Auth Error:", err.message);
        throw new Error("Google Drive authorization failed");
    }
}

export async function uploadToGoogleDrive(file) {
    try {
        if (!file || !file.path) {
            throw new Error("Invalid file: Path is missing");
        }

        const authClient = await authorize();
        const drive = google.drive({ version: "v3", auth: authClient });

        console.log(`🔹 Uploading file: ${file.originalname}`);

        const fileStream = fs.createReadStream(file.path); // ✅ Read file from disk

        const response = await drive.files.create({
            requestBody: {
                name: file.originalname,
                mimeType: file.mimetype,
                parents: [process.env.DRIVE_FOLDER_ID], // Ensure correct folder ID
            },
            media: {
                mimeType: file.mimetype,
                body: fileStream,
            },
        });

        if (!response.data.id) {
            throw new Error("Google Drive upload failed: No file ID returned");
        }

        // Make the file public
        await drive.permissions.create({
            fileId: response.data.id,
            requestBody: { role: "reader", type: "anyone" },
        });

        const fileUrl = `https://drive.google.com/uc?id=${response.data.id}`;
        console.log(`✅ File uploaded successfully: ${fileUrl}`);

        return fileUrl;
    } catch (err) {
        console.error("❌ Google Drive Upload Error:", err.message);
        throw new Error("Error uploading file to Google Drive");
    }
}
