import express from "express";
import { handleTranscription } from "../controllers/transcriptionController.js";

const router = express.Router();
router.post("/", handleTranscription);

export default router;
