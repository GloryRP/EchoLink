import { Router } from "express";
import { createMeeting, joinMeeting, getMeetingInfo } from "../controllers/meetings.controller.js";

const router = Router();

// Host creates a meeting
router.post("/create", createMeeting);

// User joins an existing meeting
router.post("/join", joinMeeting);

// Get info of a meeting
router.get("/:meetingCode", getMeetingInfo);

export default router;
