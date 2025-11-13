// backend/src/controllers/socketManager.js
import { Server } from "socket.io";
import WebSocket from "ws";
import fetch from "node-fetch"; // npm i node-fetch@2

let rooms = {};

/**
 * Translate `text` (assumed 'en') -> targetLang using local LibreTranslate server
 * at http://127.0.0.1:5000/translate
 */
async function translateTextLibre(text, targetLang) {
  if (!text || !targetLang || targetLang === "en") return null;
  try {
    const res = await fetch("http://127.0.0.1:5000/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: text,
        source: "en",
        target: targetLang,
        format: "text",
      }),
    });

    if (!res.ok) {
      console.warn("LibreTranslate non-OK:", res.status, await res.text());
      return null;
    }

    const json = await res.json();
    return json.translatedText || json.translated || null;
  } catch (err) {
    console.error("translateTextLibre error:", err.message);
    return null;
  }
}

/**
 * Convert text to speech using local Flask TTS service (http://127.0.0.1:5001/speak)
 */
async function speakText(text, lang) {
  try {
    const res = await fetch("http://127.0.0.1:5001/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang }),
    });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer);
  } catch (err) {
    console.error("speakText error:", err.message);
    return null;
  }
}

/**
 * Main Socket.IO Connection
 */
export const connectToSocket = (server) => {
  const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
  });

  io.on("connection", (socket) => {
    console.log("✅ Connected:", socket.id);
    socket.deepgramSocket = null;
    socket.deepgramKeepAlive = null;
    socket.dgQueue = [];

    // JOIN CALL
    socket.on("join-call", ({ roomId, username }) => {
      if (!rooms[roomId]) {
        rooms[roomId] = {
          users: {},
          chat: [],
          chatLock: false,
          screenLock: false,
          screenOwner: null,
        };
      }

      const name = username || "Guest";
      rooms[roomId].users[socket.id] = {
        name,
        lockedAudio: false,
        lockedVideo: false,
        lang: "en",
      };
      socket.data.roomId = roomId;
      socket.data.username = name;

      socket.join(roomId);
      const isHost = Object.keys(rooms[roomId].users)[0] === socket.id;
      socket.data.isHost = isHost;
      io.to(socket.id).emit("host-status", { isHost });
      console.log(`👥 ${name} joined ${roomId} (Host: ${isHost})`);

      const others = Object.entries(rooms[roomId].users)
        .filter(([id]) => id !== socket.id)
        .map(([id, info]) => ({
          id,
          name: info.name,
          lockedAudio: info.lockedAudio,
          lockedVideo: info.lockedVideo,
          lang: info.lang,
        }));

      io.to(socket.id).emit("existing-participants", others);
      socket.to(roomId).emit("new-user", { id: socket.id, name });
      io.to(socket.id).emit("room-locks", {
        chatLock: rooms[roomId].chatLock,
        screenLock: rooms[roomId].screenLock,
        screenOwner: rooms[roomId].screenOwner,
      });
      updateParticipants(io, roomId);
    });

    // SET LANGUAGE
    socket.on("set-language", (lang) => {
      const roomId = socket.data.roomId;
      if (!roomId || !rooms[roomId]) return;
      if (rooms[roomId].users[socket.id]) {
        rooms[roomId].users[socket.id].lang = lang || "en";
        updateParticipants(io, roomId);
      }
    });

    // SIGNALING
    socket.on("signal", (toId, signal) => {
      io.to(toId).emit("signal", socket.id, signal);
    });

    // CHAT
    socket.on("chat-message", (msg, sender) => {
      const roomId = socket.data.roomId;
      if (!roomId || !rooms[roomId]) return;

      if (rooms[roomId].chatLock) {
        io.to(socket.id).emit("chat-blocked");
        return;
      }

      rooms[roomId].chat.push({ sender, data: msg });
      socket.to(roomId).emit("chat-message", msg, sender);
    });

    // HOST CONTROLS
    socket.on("host-mute-all", () => {
      if (!socket.data.isHost) return;
      const roomId = socket.data.roomId;
      Object.keys(rooms[roomId].users).forEach((id) => {
        if (id !== socket.id) {
          rooms[roomId].users[id].lockedAudio = true;
          io.to(id).emit("force-mute");
        }
      });
      updateParticipants(io, roomId);
    });

    socket.on("host-mute-user", ({ userId }) => {
      if (!socket.data.isHost) return;
      const roomId = socket.data.roomId;
      if (rooms[roomId]?.users[userId]) {
        rooms[roomId].users[userId].lockedAudio = true;
        io.to(userId).emit("force-mute");
        updateParticipants(io, roomId);
      }
    });

    socket.on("host-unmute-user", ({ userId }) => {
      if (!socket.data.isHost) return;
      const roomId = socket.data.roomId;
      if (rooms[roomId]?.users[userId]) {
        rooms[roomId].users[userId].lockedAudio = false;
        io.to(userId).emit("unlock-audio");
        updateParticipants(io, roomId);
      }
    });

    socket.on("host-stop-video-user", ({ userId }) => {
      if (!socket.data.isHost) return;
      const roomId = socket.data.roomId;
      if (rooms[roomId]?.users[userId]) {
        rooms[roomId].users[userId].lockedVideo = true;
        io.to(userId).emit("force-stop-video");
        updateParticipants(io, roomId);
      }
    });

    socket.on("host-start-video-user", ({ userId }) => {
      if (!socket.data.isHost) return;
      const roomId = socket.data.roomId;
      if (rooms[roomId]?.users[userId]) {
        rooms[roomId].users[userId].lockedVideo = false;
        io.to(userId).emit("unlock-video");
        updateParticipants(io, roomId);
      }
    });

    socket.on("host-chat-toggle", ({ lock }) => {
      if (!socket.data.isHost) return;
      const roomId = socket.data.roomId;
      rooms[roomId].chatLock = !!lock;
      io.to(roomId).emit("chat-lock-status", { lock: !!lock });
    });

    socket.on("host-screen-toggle", ({ lock }) => {
      if (!socket.data.isHost) return;
      const roomId = socket.data.roomId;
      rooms[roomId].screenLock = !!lock;
      io.to(roomId).emit("screen-lock-status", { lock: !!lock });
    });

    // SCREEN SHARE
    socket.on("screen-share-start", () => {
      const roomId = socket.data.roomId;
      if (!rooms[roomId]) return;
      if (rooms[roomId].screenLock) {
        io.to(socket.id).emit("screen-share-blocked");
        return;
      }
      rooms[roomId].screenOwner = socket.id;
      io.to(roomId).emit("screen-share-started", { owner: socket.id });
    });

    socket.on("screen-share-stop", () => {
      const roomId = socket.data.roomId;
      if (rooms[roomId]?.screenOwner === socket.id) rooms[roomId].screenOwner = null;
      io.to(roomId).emit("screen-share-stopped", { owner: socket.id });
    });

    // TRANSCRIPTION
    socket.on("start-transcription", () => {
      const roomId = socket.data.roomId;
      if (!roomId || !rooms[roomId]) return;

      console.log(`🎤 Deepgram stream for ${socket.data.username}`);

      const dgSocket = new WebSocket("wss://api.deepgram.com/v1/listen?model=nova-2&language=en", {
        headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
      });

      socket.deepgramSocket = dgSocket;
      socket.dgQueue = [];

      dgSocket.on("open", () => {
        console.log(`🎧 Deepgram open for ${socket.data.username}`);
        const startMsg = { type: "StartStream", encoding: "webm", sample_rate: 48000, channels: 1 };
        dgSocket.send(JSON.stringify(startMsg));

        if (socket.dgQueue.length > 0) {
          socket.dgQueue.forEach((buf) => dgSocket.send(buf, { binary: true }));
          socket.dgQueue = [];
        }

        socket.deepgramKeepAlive = setInterval(() => {
          try {
            if (dgSocket.readyState === WebSocket.OPEN) {
              dgSocket.ping ? dgSocket.ping() : dgSocket.send(Buffer.from([]));
            }
          } catch {}
        }, 15000);

        io.to(socket.id).emit("transcription-started");
      });

      dgSocket.on("message", async (msg) => {
        try {
          const text = typeof msg === "string" ? msg : msg.toString();
          const data = JSON.parse(text);
          const transcript = data?.channel?.alternatives?.[0]?.transcript?.trim();
          if (!transcript) return;

          const roomUsers = Object.keys(rooms[roomId].users);
          await Promise.all(
            roomUsers.map(async (recipientId) => {
              const recip = rooms[roomId].users[recipientId];
              const targetLang = recip.lang || "en";

              let translated = null;
              if (targetLang !== "en") {
                translated = await translateTextLibre(transcript, targetLang);
              }

              io.to(recipientId).emit("transcription-result", {
                sender: socket.data.username,
                senderId: socket.id,
                text: transcript,
                translated,
                lang: targetLang,
              });
            })
          );
        } catch {}
      });

      dgSocket.on("close", () => {
        console.log(`🛑 Deepgram closed for ${socket.data.username}`);
        clearInterval(socket.deepgramKeepAlive);
        socket.deepgramSocket = null;
      });

      dgSocket.on("error", (err) => console.error("Deepgram error:", err.message));
    });

    // END TRANSCRIPTION
    socket.on("end-transcription", () => {
      if (socket.deepgramSocket) {
        socket.deepgramSocket.close();
      }
      if (socket.deepgramKeepAlive) clearInterval(socket.deepgramKeepAlive);
      socket.dgQueue = [];
      console.log(`🛑 Transcription ended for ${socket.data.username}`);
    });

    // AUDIO CHUNKS
    socket.on("audio-chunk", (audioData) => {
      try {
        const dgSocket = socket.deepgramSocket;
        const base64 = typeof audioData === "string" && audioData.includes(",")
          ? audioData.split(",")[1]
          : audioData;
        if (!base64) return;
        const buffer = Buffer.from(base64, "base64");

        if (dgSocket?.readyState === WebSocket.OPEN) dgSocket.send(buffer, { binary: true });
        else {
          socket.dgQueue.push(buffer);
          if (socket.dgQueue.length > 60) socket.dgQueue.shift();
        }
      } catch (err) {
        console.error("audio-chunk error:", err.message);
      }
    });

    // DISCONNECT
    socket.on("disconnect", () => {
      const roomId = socket.data.roomId;
      if (!roomId || !rooms[roomId]) return;
      const username = rooms[roomId].users[socket.id]?.name;
      delete rooms[roomId].users[socket.id];
      socket.to(roomId).emit("user-left", socket.id);
      updateParticipants(io, roomId);

      if (rooms[roomId].screenOwner === socket.id) {
        rooms[roomId].screenOwner = null;
        io.to(roomId).emit("screen-share-stopped", { owner: socket.id });
      }

      if (socket.data.isHost && Object.keys(rooms[roomId].users).length > 0) {
        const newHostId = Object.keys(rooms[roomId].users)[0];
        const newHostSocket = io.sockets.sockets.get(newHostId);
        if (newHostSocket) {
          newHostSocket.data.isHost = true;
          io.to(newHostId).emit("host-status", { isHost: true });
          console.log(`👑 New host assigned: ${newHostId}`);
        }
      }

      if (socket.deepgramSocket) socket.deepgramSocket.close();
      if (socket.deepgramKeepAlive) clearInterval(socket.deepgramKeepAlive);
      socket.dgQueue = [];

      if (Object.keys(rooms[roomId].users).length === 0) {
        delete rooms[roomId];
        console.log(`🧹 Room ${roomId} cleared`);
      }

      console.log(`❌ Disconnected: ${socket.id} (${username})`);
    });
  });

  return io;
};

function updateParticipants(io, roomId) {
  if (!rooms[roomId]) return;
  io.to(roomId).emit(
    "participants-update",
    Object.entries(rooms[roomId].users).map(([id, info]) => ({
      id,
      name: info.name,
      lockedAudio: info.lockedAudio,
      lockedVideo: info.lockedVideo,
      lang: info.lang || "en",
    }))
  );
}
