import mongoose, { Schema } from "mongoose";

const meetingSchema = new Schema(
  {
    meetingCode: { type: String, required: true, unique: true },   // meeting ID
    hostId: { type: Schema.Types.ObjectId, ref: "User", required: true }, // host user
    participants: [{ type: Schema.Types.ObjectId, ref: "User" }],  // joined users
    locked: { type: Boolean, default: false },   // if meeting locked by host
    active: { type: Boolean, default: true },    // meeting status
    createdAt: { type: Date, default: Date.now }, // auto timestamp
  },
  { timestamps: true }
);

const Meeting = mongoose.model("Meeting", meetingSchema);

export { Meeting };
