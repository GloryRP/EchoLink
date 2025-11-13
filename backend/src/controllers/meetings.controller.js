import { Meeting } from "../models/meeting.model.js";
import { User } from "../models/user.model.js";
import crypto from "crypto";

// Create a new meeting (host)
const createMeeting = async (req, res) => {
  const { token } = req.body; // token in body
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const hostUser = await User.findOne({ token });
    if (!hostUser) return res.status(401).json({ message: "Unauthorized" });

    // Generate unique meeting code
    const meetingCode = crypto.randomBytes(3).toString("hex").toUpperCase();

    const newMeeting = new Meeting({
      meetingCode,
      hostId: hostUser._id,
      participants: [hostUser._id],
    });

    await newMeeting.save();

    res.status(201).json({
      message: "Meeting created",
      meetingCode,
      hostId: hostUser._id,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Something went wrong", error: err });
  }
};

// Join an existing meeting
const joinMeeting = async (req, res) => {
  const { token, meetingCode } = req.body; // token + meetingCode in body
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const user = await User.findOne({ token });
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const meeting = await Meeting.findOne({ meetingCode });
    if (!meeting) return res.status(404).json({ message: "Meeting not found" });

    // Prevent joining if locked
    if (meeting.locked)
      return res.status(403).json({ message: "Meeting is locked by host" });

    // Add user to participants if not already
    if (!meeting.participants.some(id => id.equals(user._id))) {
      meeting.participants.push(user._id);
      await meeting.save();
    }

    res.status(200).json({
      message: "Joined meeting",
      meetingCode,
      hostId: meeting.hostId,
      participants: meeting.participants,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Something went wrong", error: err });
  }
};

// Get meeting info
const getMeetingInfo = async (req, res) => {
  const { meetingCode } = req.params;

  try {
    const meeting = await Meeting.findOne({ meetingCode }).populate(
      "hostId participants",
      "name username"
    );
    if (!meeting) return res.status(404).json({ message: "Meeting not found" });

    res.status(200).json({
      meetingCode: meeting.meetingCode,
      host: meeting.hostId,
      participants: meeting.participants,
      locked: meeting.locked,
      active: meeting.active,
    });
  } catch (err) {
    res.status(500).json({ message: "Something went wrong", error: err });
  }
};

export { createMeeting, joinMeeting, getMeetingInfo };
