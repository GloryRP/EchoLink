// backend/src/controllers/transcriptionController.js
import dotenv from "dotenv";
import { createClient } from "@deepgram/sdk";

dotenv.config();
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// For uploaded/pre-recorded audio (not live)
export const handleTranscription = async (audioBase64) => {
  try {
    if (!audioBase64) return "";

    const audioBuffer = Buffer.from(audioBase64, "base64");

    const response = await deepgram.listen.prerecorded.transcribeFile(
      { buffer: audioBuffer, mimetype: "audio/webm" },
      { model: "nova-2", smart_format: true, language: "en" }
    );

    const transcript = response?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
    return transcript.trim();
  } catch (error) {
    console.error("Deepgram transcription error:", error?.message || error);
    return "";
  }
};
