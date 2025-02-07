import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE, "base64").toString("utf-8")
);


admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

export default admin;