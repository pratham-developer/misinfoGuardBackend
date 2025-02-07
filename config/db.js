import mongoose from "mongoose";

const connectDb = async () => {
    try {
        await mongoose.connect(process.env.DB);
        console.log("Database connection established");
    } catch (err) {
        console.error(err);
    }
};

export default connectDb;