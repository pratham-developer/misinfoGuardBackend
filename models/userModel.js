import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
    {
        uid: { type: String, required: true, unique: true },
        email: { type: String, required: true, unique: true },
        name: { type: String, required: true }
    },
    { timestamps: true }
);

const userDataSchema = new mongoose.Schema(
    {
        email: { type: String, required: true, unique: true, ref: "User" },
        files: [
            {   fileName: {type: String, required: true},
                fileUrl: { type: String, required: true },
                score: { type: Number, required: true },
                is_deepfake: { type: Boolean, required: true }
            }
        ]
    },
    { timestamps: true }
);

export const User = mongoose.model("User", userSchema, "users");
export const UserData = mongoose.model("UserData", userDataSchema, "user_data");
