import express from "express";
import "dotenv/config";
import { createServer } from "http";
import mongoose from "mongoose";
import cors from "cors";

import { connectToSocket } from "./controllers/socketManager.js";
import userRoutes from "./routes/users.routes.js";
import meetingRoutes from "./routes/meetings.routes.js";
import transcriptionRoutes from "./routes/transcription.routes.js";

const app = express();
const server = createServer(app);
connectToSocket(server);

app.set("port", process.env.PORT || 8000);

app.use(cors());
app.use(express.json({ limit: "40kb" }));
app.use(express.urlencoded({ limit: "40kb", extended: true }));

app.use("/api/v1/users", userRoutes);
app.use("/api/v1/meetings", meetingRoutes);
app.use("/api/v1/transcribe", transcriptionRoutes);

const start = async () => {
  try {
    const connectionDb = await mongoose.connect(
      "mongodb+srv://gloryrp58_db_user:lkZOWpiEqdH2GQuK@cluster0.jmxqbcs.mongodb.net/echolinkDB?retryWrites=true&w=majority&appName=Cluster0"
    );

    console.log(`MONGO Connected DB Host: ${connectionDb.connection.host}`);
    console.log(`Connected to DB: ${connectionDb.connection.name}`);

    server.listen(app.get("port"), () => {
      console.log(`🚀 Server listening on port ${app.get("port")}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
  }
};

start();
