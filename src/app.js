import express from "express";
import connectDb from "../config/db.js";
import routerUser from "../routes/user.js";
import routerUserData from "../routes/userData.js";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(morgan("dev"));
app.use(express.json());
app.use(cors());

app.use("/user", routerUser);
app.use("/user/data", routerUserData);

const port = process.env.PORT || 5500;

app.get("/", (req, res) => {
    res.send("Hello World");
});

app.listen(port, async () => {
    console.log(`Server running on http://localhost:${port}`);
    await connectDb();
});
