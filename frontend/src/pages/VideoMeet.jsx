// src/components/VideoMeetComponent.jsx
import React, { useRef, useState, useEffect } from "react";
import io from "socket.io-client";
import EmojiPicker from "emoji-picker-react";
import {
  Button,
  IconButton,
  TextField,
  Badge,
  Card,
  CardContent,
  Collapse,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
} from "@mui/material";
import {
  Videocam as VideocamIcon,
  VideocamOff as VideocamOffIcon,
  CallEnd as CallEndIcon,
  Mic as MicIcon,
  MicOff as MicOffIcon,
  ScreenShare as ScreenShareIcon,
  StopScreenShare as StopScreenShareIcon,
  Chat as ChatIcon,
  VolumeOff as VolumeOffIcon,
  VolumeUp as VolumeUpIcon,
  ClosedCaption as ClosedCaptionIcon,
  MoreVert as MoreVertIcon,
  PlayArrow as PlayArrowIcon,
  Stop as StopIcon,
} from "@mui/icons-material";
import server from "../environment"; // e.g. "http://localhost:8000"
import styles from "../styles/videoComponent.module.css";

const peerConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// small set of languages (LibreTranslate supports many; expand as needed)
const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "mr", label: "Marathi" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "kn", label: "Kannada" },
  { code: "gu", label: "Gujarati" },
  { code: "ml", label: "Malayalam" },
  { code: "pa", label: "Punjabi" },
  { code: "ur", label: "Urdu" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
];

function RemoteVideo({ stream, username }) {
  const ref = useRef();
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className={styles.videoWrapper}>
      <video ref={ref} autoPlay playsInline muted={false} />
      <span className={styles.usernameTag}>{username || "Guest"}</span>
    </div>
  );
}

// Map simple language code -> likely BCP-47 voice code for speechSynthesis
const speechLangMap = {
  en: "en-US",
  hi: "hi-IN",
  bn: "bn-IN",
  mr: "mr-IN",
  ta: "ta-IN",
  te: "te-IN",
  kn: "kn-IN",
  gu: "gu-IN",
  ml: "ml-IN",
  pa: "pa-IN",
  ur: "ur-PK",
  es: "es-ES",
  fr: "fr-FR",
};

export default function VideoMeetComponent() {
  const socketRef = useRef(null);
  const localVideoRef = useRef(null);
  const connectionsRef = useRef({});
  const recorderRef = useRef(null);
  const recorderStreamRef = useRef(null);

  const [videos, setVideos] = useState([]);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [screenEnabled, setScreenEnabled] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [username, setUsername] = useState("");
  const [askUsername, setAskUsername] = useState(true);
  const [isHost, setIsHost] = useState(false);
  const [mutedUsers, setMutedUsers] = useState({});
  const [participants, setParticipants] = useState([]);
  const [hostPanelOpen, setHostPanelOpen] = useState(false);

  const [captions, setCaptions] = useState([]); // array of { sender, senderId, text, translated, lang, ts }
  const [lockedAudio, setLockedAudio] = useState(false);
  const [lockedVideo, setLockedVideo] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  // room-level locks
  const [chatLocked, setChatLocked] = useState(false);
  const [screenLocked, setScreenLocked] = useState(false);

  // user-selected language for UI (default en)
  const [selectedLang, setSelectedLang] = useState("en");

  // If true, automatically play translated audio (when translated text exists and matches selectedLang)
  const [autoPlayTranslated, setAutoPlayTranslated] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);


  // keep track of current utterance to be able to stop it
  const currentUtteranceRef = useRef(null);

  const getLocalStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoEnabled,
        audio: audioEnabled,
      });
      window.localStream = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    } catch (err) {
      console.error("getUserMedia error:", err);
      alert("Camera/Microphone access required.");
    }
  };

  useEffect(() => {
  const handleClickOutside = () => setShowEmojiPicker(false);
  document.addEventListener("click", handleClickOutside);
  return () => document.removeEventListener("click", handleClickOutside);
}, []);


  // --- TTS Helpers (browser speechSynthesis) ---
  function speakText(text, langCode) {
    try {
      if (!("speechSynthesis" in window)) {
        console.warn("No speechSynthesis available in this browser.");
        return;
      }
      // stop any previous utterance
      if (currentUtteranceRef.current) {
        try {
          window.speechSynthesis.cancel();
        } catch (e) {}
        currentUtteranceRef.current = null;
      }

      const utter = new SpeechSynthesisUtterance(text);
      const bcpTag = speechLangMap[langCode] || speechLangMap[selectedLang] || "en-US";
      utter.lang = bcpTag;

      // Choose best match voice if available
      const voices = window.speechSynthesis.getVoices() || [];
      if (voices.length > 0) {
        // prefer exact lang match, else first voice with same language prefix
        let voice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(bcpTag.toLowerCase()));
        if (!voice) {
          const prefix = bcpTag.split("-")[0];
          voice = voices.find((v) => v.lang && v.lang.split("-")[0] === prefix);
        }
        if (voice) utter.voice = voice;
      }

      utter.onend = () => {
        currentUtteranceRef.current = null;
      };
      utter.onerror = (e) => {
        console.warn("TTS error:", e);
        currentUtteranceRef.current = null;
      };

      currentUtteranceRef.current = utter;
      window.speechSynthesis.speak(utter);
    } catch (err) {
      console.error("speakText error:", err);
    }
  }

  function stopSpeech() {
    try {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      currentUtteranceRef.current = null;
    } catch (e) {}
  }

  // 🔁 Auto Hindi voice when captions update
useEffect(() => {
  if (!autoPlayTranslated) return; // off, do nothing
  if (captions.length === 0) return;

  const latest = captions[captions.length - 1];
  if (latest.translated) {
    speakText(latest.translated, "hi"); // Speak Hindi
  }
}, [captions, autoPlayTranslated]);


  // --- Transcription same as before (start/stop recorder) ---
  const waitForServerTranscriptionAck = (timeoutMs = 2000) =>
    new Promise((resolve) => {
      if (!socketRef.current) return resolve(false);
      let resolved = false;
      const onAck = () => {
        if (resolved) return;
        resolved = true;
        socketRef.current.off("transcription-started", onAck);
        resolve(true);
      };
      socketRef.current.once("transcription-started", onAck);
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        socketRef.current.off("transcription-started", onAck);
        resolve(false);
      }, timeoutMs);
    });

  const startTranscription = async () => {
    try {
      if (!socketRef.current || !socketRef.current.connected) {
        console.warn("Socket not connected, cannot start transcription.");
        return;
      }
      if (recorderRef.current) {
        console.log("Transcription already running.");
        return;
      }

      socketRef.current.emit("start-transcription");
      await waitForServerTranscriptionAck(2000);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorderStreamRef.current = stream;

      let mimeType = "";
      try {
        if (MediaRecorder.isTypeSupported) {
          if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) mimeType = "audio/webm;codecs=opus";
          else if (MediaRecorder.isTypeSupported("audio/webm")) mimeType = "audio/webm";
          else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) mimeType = "audio/ogg;codecs=opus";
        }
      } catch (e) {}

      let recorder;
      try {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch (err) {
        console.warn("MediaRecorder creation with options failed, falling back to default:", err);
        recorder = new MediaRecorder(stream);
      }

      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        try {
          if (!e.data || e.data.size === 0) return;
          const reader = new FileReader();
          reader.onload = () => {
            const base64data = reader.result;
            if (socketRef.current && socketRef.current.connected) {
              socketRef.current.emit("audio-chunk", base64data);
            }
          };
          reader.onerror = (err) => console.error("FileReader error converting audio blob:", err);
          reader.readAsDataURL(e.data);
        } catch (err) {
          console.error("ondataavailable error:", err);
        }
      };

      recorder.onstart = () => {
        console.log("MediaRecorder started:", recorder.state, mimeType || "default-mime");
        setTranscribing(true);
      };

      recorder.onerror = (ev) => {
        console.error("MediaRecorder error event:", ev);
      };

      recorder.onstop = () => {
        console.log("MediaRecorder stopped");
        try {
          recorderStreamRef.current?.getTracks()?.forEach((t) => t.stop());
        } catch (e) {}
        recorderRef.current = null;
        recorderStreamRef.current = null;

        if (socketRef.current && socketRef.current.connected) {
          socketRef.current.emit("end-transcription");
        }
        setTranscribing(false);
      };

      recorder.start(1000);
      console.log("recorder.start(1000) called");
    } catch (err) {
      console.error("Transcription setup error:", err);
      try {
        recorderRef.current?.stop();
      } catch (e) {}
      setTranscribing(false);
    }
  };

  const stopTranscription = () => {
    try {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
        console.log("Requested recorder.stop()");
      } else {
        if (socketRef.current && socketRef.current.connected) {
          socketRef.current.emit("end-transcription");
        }
        setTranscribing(false);
        try {
          recorderStreamRef.current?.getTracks()?.forEach((t) => t.stop());
        } catch (e) {}
        recorderRef.current = null;
        recorderStreamRef.current = null;
      }
    } catch (err) {
      console.error("stopTranscription error:", err);
      setTranscribing(false);
      recorderRef.current = null;
      recorderStreamRef.current = null;
    }
  };

  const toggleTranscription = () => {
    if (transcribing) stopTranscription();
    else startTranscription();
  };

  // --- SOCKET ---
  const initSocket = () => {
    socketRef.current = io(server);

    socketRef.current.on("connect", () => {
      const roomId = window.location.href.split("?")[0];
      socketRef.current.emit("join-call", { roomId, username });
      console.debug("socket connected, join-call emitted", roomId, username);

      // set initial selected language on server as well
      socketRef.current.emit("set-language", selectedLang);

      socketRef.current.on("host-status", ({ isHost }) => setIsHost(!!isHost));

      socketRef.current.on("participants-update", (arr = []) => {
        setParticipants(arr);
        const me = arr.find((p) => p.id === socketRef.current.id);
        setLockedAudio(!!(me && me.lockedAudio));
        setLockedVideo(!!(me && me.lockedVideo));
      });

      socketRef.current.on("existing-participants", (existing = []) => {
        existing.forEach(({ id, name }) => createPeerConnection(id, true, name));
      });

      socketRef.current.on("new-user", ({ id, name }) => createPeerConnection(id, false, name));

      socketRef.current.on("signal", handleSignal);

      socketRef.current.on("chat-message", (msg, sender) => setMessages((prev) => [...prev, { data: msg, sender }]));

      socketRef.current.on("user-left", (id) => {
        setVideos((prev) => prev.filter((v) => v.socketId !== id));
        if (connectionsRef.current[id]) {
          try {
            connectionsRef.current[id].close();
          } catch (e) {}
          delete connectionsRef.current[id];
        }
      });

      // host controls
      socketRef.current.on("force-mute", () => {
        setLockedAudio(true);
        setAudioEnabled(false);
        try {
          const t = window.localStream?.getAudioTracks()?.[0];
          if (t) t.enabled = false;
        } catch (e) {}
        stopTranscription();
      });
      socketRef.current.on("force-stop-video", () => {
        setLockedVideo(true);
        setVideoEnabled(false);
        try {
          const t = window.localStream?.getVideoTracks()?.[0];
          if (t) t.enabled = false;
        } catch (e) {}
      });
      socketRef.current.on("unlock-audio", () => setLockedAudio(false));
      socketRef.current.on("unlock-video", () => setLockedVideo(false));
      socketRef.current.on("kick-user", () => endCall());
      socketRef.current.on("chat-lock-status", ({ lock }) => setChatLocked(!!lock));
      socketRef.current.on("room-locks", ({ chatLock, screenLock, screenOwner }) => {
        setChatLocked(!!chatLock);
        setScreenLocked(!!screenLock);
      });
      socketRef.current.on("screen-lock-status", ({ lock }) => setScreenLocked(!!lock));
      socketRef.current.on("force-stop-screen", () => {
        if (screenEnabled) toggleScreen();
      });

      // Transcription result: server will send tailored object per recipient
      socketRef.current.on("transcription-result", (payload = {}) => {
        const { sender, senderId, text, translated, lang } = payload;
        if (!text) return;

        // If the message belongs to me (senderId === my socket), ignore (server design sends to all incl. original sender but your UI already shows local)
        if (socketRef.current && socketRef.current.id) {
          if (senderId && senderId === socketRef.current.id) return;
        }

        // Build caption item with both original and translated (if present)
        setCaptions((prev) => {
          const item = {
            sender: sender || "Guest",
            senderId: senderId || null,
            text,
            translated: translated || null,
            lang: lang || "en",
            ts: Date.now(),
          };
          const next = [...prev, item].slice(-4); // keep last few
          return next;
        });

        // auto-play logic: if user wants auto and translation exists and target matches their selectedLang
        try {
          if (translated && selectedLang && lang === selectedLang && autoPlayTranslated) {
            speakText(translated, lang);
          }
        } catch (e) {
          console.warn("autoplay failed", e);
        }
      });

      socketRef.current.on("transcription-cleared", () => setCaptions([]));
      socketRef.current.on("transcription-blocked", () => {
        console.warn("transcription-blocked received from server");
        stopTranscription();
      });
      socketRef.current.on("transcription-started", () => {
        console.debug("server acknowledged transcription started");
      });
      socketRef.current.on("transcription-stop", () => {
        stopTranscription();
      });

      socketRef.current.on("chat-blocked", () => {
        alert("Chat is locked by the host. You cannot send messages right now.");
      });
    });

    socketRef.current.on("disconnect", (reason) => {
      console.log("socket disconnected:", reason);
      stopTranscription();
    });
  };

  // --- PEER CONNECTION ---
  const createPeerConnection = (peerId, isInitiator, peerName) => {
    if (!peerId) return;
    if (connectionsRef.current[peerId]) return;

    const pc = new RTCPeerConnection(peerConfig);

    pc.onicecandidate = (e) => {
      if (e.candidate) socketRef.current.emit("signal", peerId, JSON.stringify({ ice: e.candidate }));
    };

    pc.ontrack = (e) => addOrUpdateVideo(peerId, e.streams[0], peerName);

    try {
      window.localStream?.getTracks().forEach((track) => pc.addTrack(track, window.localStream));
    } catch (e) {}

    connectionsRef.current[peerId] = pc;

    if (isInitiator) {
      pc
        .createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => socketRef.current.emit("signal", peerId, JSON.stringify({ sdp: pc.localDescription })))
        .catch((err) => console.error("createOffer err", err));
    }

    return pc;
  };

  const handleSignal = async (fromId, signal) => {
    let data;
    try {
      data = typeof signal === "string" ? JSON.parse(signal) : signal;
    } catch (err) {
      console.warn("Invalid signal JSON", err);
      return;
    }
    if (!connectionsRef.current[fromId]) createPeerConnection(fromId, false, undefined);
    const pc = connectionsRef.current[fromId];
    if (!pc) return;

    try {
      if (data.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        if (data.sdp.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socketRef.current.emit("signal", fromId, JSON.stringify({ sdp: pc.localDescription }));
        }
      }
      if (data.ice) await pc.addIceCandidate(new RTCIceCandidate(data.ice));
    } catch (err) {
      console.error("handleSignal error:", err);
    }
  };

  const addOrUpdateVideo = (id, stream, name) => {
    setVideos((prev) => {
      const exists = prev.find((v) => v.socketId === id);
      if (exists) return prev.map((v) => (v.socketId === id ? { ...v, stream, username: name || v.username } : v));
      return [...prev, { socketId: id, stream, username: name || "Guest" }];
    });
  };

  // --- TOGGLES ---
  const toggleVideo = (forceValue) => {
    if (lockedVideo && typeof forceValue === "undefined") return alert("Host has disabled video for you.");
    const newVal = typeof forceValue !== "undefined" ? !!forceValue : !videoEnabled;
    setVideoEnabled(newVal);
    const track = window.localStream?.getVideoTracks()?.[0];
    if (track) track.enabled = newVal;
  };

  const toggleAudio = (forceValue) => {
    if (lockedAudio && typeof forceValue === "undefined") return alert("Host has disabled audio for you.");
    const newVal = typeof forceValue !== "undefined" ? !!forceValue : !audioEnabled;
    setAudioEnabled(newVal);
    const track = window.localStream?.getAudioTracks()?.[0];
    if (track) track.enabled = newVal;

    if (!newVal && transcribing) stopTranscription();

    if (socketRef.current?.id) setMutedUsers((prev) => ({ ...prev, [socketRef.current.id]: !newVal }));
  };

  const toggleScreen = async () => {
    if (!screenEnabled) {
      if (screenLocked) {
        alert("Screen sharing is locked by the host.");
        return;
      }
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = screenStream.getVideoTracks()[0];
        Object.values(connectionsRef.current).forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
          if (sender) sender.replaceTrack(videoTrack);
        });
        setScreenEnabled(true);
        if (socketRef.current && socketRef.current.connected) socketRef.current.emit("screen-share-start");
      } catch (err) {
        console.error("getDisplayMedia error:", err);
      }
    } else {
      await getLocalStream();
      setScreenEnabled(false);
      if (socketRef.current && socketRef.current.connected) socketRef.current.emit("screen-share-stop");
    }
  };

  const sendMessage = () => {
    if (!chatInput) return;
    if (chatLocked) {
      alert("Chat is locked by the host. You cannot send messages right now.");
      return;
    }
    socketRef.current.emit("chat-message", chatInput, username);
    setMessages((prev) => [...prev, { data: chatInput, sender: "You" }]);
    setChatInput("");
  };

  const endCall = () => {
    try {
      window.localStream?.getTracks().forEach((t) => t.stop());
    } catch (e) {}
    Object.values(connectionsRef.current).forEach((pc) => {
      try {
        pc.close();
      } catch (e) {}
    });
    stopTranscription();
    socketRef.current?.disconnect();
    window.location.href = "/";
  };

  const connect = async () => {
    if (!username) return alert("Enter your name!");
    setAskUsername(false);
    await getLocalStream();
    initSocket();
  };

  // --- HOST ACTIONS ---
  const handleMuteUser = (userId) => {
    socketRef.current.emit("host-mute-user", { userId });
    setMutedUsers((prev) => ({ ...prev, [userId]: true }));
  };
  const handleUnmuteUser = (userId) => {
    socketRef.current.emit("host-unmute-user", { userId });
    setMutedUsers((prev) => ({ ...prev, [userId]: false }));
  };
  const handleStopVideoUser = (userId) => socketRef.current.emit("host-stop-video-user", { userId });
  const handleStartVideoUser = (userId) => socketRef.current.emit("host-start-video-user", { userId });
  const handleKick = (userId) => socketRef.current.emit("host-remove-user", userId);
  const handleChatLock = (lock) => socketRef.current.emit("host-chat-toggle", { lock });
  const handleScreenLock = (lock) => socketRef.current.emit("host-screen-toggle", { lock });
  const handleMuteAll = () => socketRef.current.emit("host-mute-all");

  useEffect(() => {
    return () => {
      try {
        Object.values(connectionsRef.current).forEach((pc) => pc.close());
        socketRef.current?.disconnect();
      } catch (e) {}
      stopTranscription();
      stopSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When user changes language, tell server
  useEffect(() => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("set-language", selectedLang);
    }
  }, [selectedLang]);

  // small inline style block for captions overlay
  const captionBoxStyle = {
    position: "fixed",
    left: "50%",
    transform: "translateX(-50%)",
    bottom: 90,
    zIndex: 1000,
    pointerEvents: "none",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    width: "min(95%, 720px)",
  };
  const captionLineStyle = {
    background: "rgba(0,0,0,0.6)",
    color: "#fff",
    padding: "6px 10px",
    borderRadius: 8,
    maxWidth: "100%",
    textAlign: "center",
    pointerEvents: "auto",
    fontSize: 14,
    lineHeight: "1.2",
    transition: "opacity 300ms ease, transform 300ms ease",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "flex",
    alignItems: "center",
    gap: 8,
  };
  const originalStyle = { fontSize: 12, opacity: 0.9, flex: 1, textAlign: "left" };
  const translatedStyle = { fontSize: 15, fontWeight: 700, marginTop: 4 };

  return (
    <div className={styles.meetVideoContainer}>
      {askUsername ? (
        <div style={{ padding: 20 }}>
          <h2>Enter Lobby</h2>
          <TextField label="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <Button variant="contained" onClick={connect} style={{ marginLeft: 8 }}>
            Connect
          </Button>
        </div>
      ) : (
        <>
          {/* Host Panel */}
          {isHost && (
            <div style={{ position: "fixed", left: 10, top: 10, zIndex: 40 }}>
              <IconButton style={{ color: "#fff" }} onClick={() => setHostPanelOpen((s) => !s)}>
                <MoreVertIcon />
              </IconButton>
              <Collapse in={hostPanelOpen}>
                <div className={styles.hostPanel}>
                  <Button onClick={handleMuteAll}>Mute All</Button>
                  <Button onClick={() => handleChatLock(true)}>Disable Chat</Button>
                  <Button onClick={() => handleChatLock(false)}>Enable Chat</Button>
                  <Button onClick={() => handleScreenLock(true)}>Lock Screen</Button>
                  <Button onClick={() => handleScreenLock(false)}>Unlock Screen</Button>
                  <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 10 }}>
                    {(participants || []).map((p) => (
                      <Card key={p.id} style={{ marginBottom: 6 }}>
                        <CardContent style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ fontWeight: 700 }}>
                            {p.name}
                            {p.lockedAudio && " 🔇"}
                            {p.lockedVideo && " 📷❌"}
                          </div>
                          <div>
                            <IconButton onClick={() => handleMuteUser(p.id)} title="Mute (lock)">
                              <VolumeOffIcon />
                            </IconButton>
                            <IconButton onClick={() => handleUnmuteUser(p.id)} title="Unlock audio">
                              <VolumeUpIcon />
                            </IconButton>
                            <Button size="small" onClick={() => handleStopVideoUser(p.id)}>
                              Stop
                            </Button>
                            <Button size="small" onClick={() => handleStartVideoUser(p.id)}>
                              Start
                            </Button>
                            <Button size="small" color="error" onClick={() => handleKick(p.id)}>
                              Kick
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              </Collapse>
            </div>
          )}

          {/* 🎧 Simplified Caption + Auto Hindi Voice */}
<div style={captionBoxStyle} aria-live="polite">
  {/* 🟢 Toggle Switch for Auto Hindi */}
  <div
    style={{
      display: "flex",
      gap: 8,
      alignItems: "center",
      marginBottom: 6,
      pointerEvents: "auto",
    }}
  >
    <FormControlLabel
      control={
        <Switch
          checked={autoPlayTranslated}
          onChange={(e) => {
            const enabled = e.target.checked;
            setAutoPlayTranslated(enabled);
            if (!enabled) stopSpeech(); // stop any ongoing Hindi speech
          }}
        />
      }
      label="🎧 Hear in Hindi"
      style={{ color: "#fff" }}
    />
    <div style={{ color: "#fff", fontSize: 12, opacity: 0.8 }}>
      {autoPlayTranslated
        ? "Listening in Hindi"
        : "Listening in Original Voice"}
    </div>
  </div>

  {/* 🪄 Only show last 2 caption lines */}
  {captions.slice(-2).map((c) => (
    <div key={c.ts} style={{ ...captionLineStyle }}>
      <div style={originalStyle}>
        <strong style={{ marginRight: 6 }}>{c.sender}:</strong>
        <span>{autoPlayTranslated && c.translated ? c.translated : c.text}</span>
      </div>
  

                {/* Play / Stop buttons for translation (or original) */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {c.translated ? (
                    <>
                      <IconButton
                        size="small"
                        onClick={() => {
                          // speak translated in its language (lang field is target lang)
                          speakText(c.translated, c.lang);
                        }}
                        title="Play translation"
                        style={{ color: "#fff" }}
                      >
                        <PlayArrowIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => {
                          stopSpeech();
                        }}
                        title="Stop"
                        style={{ color: "#fff" }}
                      >
                        <StopIcon />
                      </IconButton>
                    </>
                  ) : (
                    <>
                      <IconButton
                        size="small"
                        onClick={() => {
                          // if no translated text, play original in its language (defaults to en)
                          speakText(c.text, c.lang || "en");
                        }}
                        title="Play original"
                        style={{ color: "#fff" }}
                      >
                        <PlayArrowIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => {
                          stopSpeech();
                        }}
                        title="Stop"
                        style={{ color: "#fff" }}
                      >
                        <StopIcon />
                      </IconButton>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Language dropdown + layout near CC button (top-right flow) */}
          <div style={{ position: "fixed", right: 16, top: 12, zIndex: 50, display: "flex", gap: 8, alignItems: "center" }}>
            <FormControl size="small" variant="standard" style={{ minWidth: 140, background: "rgba(0,0,0,0.25)", padding: 6, borderRadius: 6 }}>
              <InputLabel style={{ color: "#fff" }}>Language</InputLabel>
              <Select
                value={selectedLang}
                onChange={(e) => setSelectedLang(e.target.value)}
                style={{ color: "#fff", minWidth: 120 }}
                label="Language"
              >
                {LANGUAGES.map((l) => (
                  <MenuItem key={l.code} value={l.code}>
                    {l.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </div>

          {/* Videos Grid */}
          <div className={styles.videosGrid}>{videos.map((v) => <RemoteVideo key={v.socketId} stream={v.stream} username={v.username} />)}</div>

          {/* Local Video */}
          <div className={styles.localVideoWrapper}>
            <video ref={localVideoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>

          {/* Controls */}
          <div className={styles.controlsBar}>
            <IconButton onClick={() => toggleVideo()} disabled={lockedVideo} title={lockedVideo ? "Video locked by host" : "Toggle video"}>
              {videoEnabled ? <VideocamIcon /> : <VideocamOffIcon />}
            </IconButton>
            <IconButton onClick={() => toggleAudio()} disabled={lockedAudio} title={lockedAudio ? "Audio locked by host" : "Toggle audio"}>
              {audioEnabled ? <MicIcon /> : <MicOffIcon />}
            </IconButton>

            {/* CC Toggle */}
            <IconButton onClick={toggleTranscription} title={transcribing ? "Stop captions" : "Start captions"}>
              <ClosedCaptionIcon style={{ color: transcribing ? "#4caf50" : undefined }} />
            </IconButton>

            <IconButton onClick={() => toggleScreen()} title={screenEnabled ? "Stop sharing" : "Start sharing"}>
              {screenEnabled ? <StopScreenShareIcon /> : <ScreenShareIcon />}
            </IconButton>
            <IconButton onClick={() => endCall()} style={{ color: "red" }}>
              <CallEndIcon />
            </IconButton>
            <Badge badgeContent={messages.filter((m) => m.sender !== "You").length} color="warning">
              <IconButton onClick={() => setShowChat((s) => !s)}>
                <ChatIcon />
              </IconButton>
            </Badge>
          </div>

          {/* Chat Panel */}
{showChat && (
  <div className={styles.chatPanel}>
    <div className={styles.chatMessages}>
      {messages.map((m, i) => (
        <div key={i} className={styles.chatMessage}>
          <strong>{m.sender}: </strong>
          <span>{m.data}</span>
        </div>
      ))}
    </div>

   <div className={styles.chatInput} style={{ position: "relative" }}>
  {/* Emoji toggle button */}
  <IconButton
    onClick={(e) => {
      e.stopPropagation(); // prevent body click from instantly closing
      setShowEmojiPicker((prev) => !prev);
    }}
    style={{ color: "#fff", marginRight: "4px" }}
  >
    😊
  </IconButton>

  {/* Emoji picker popup */}
  {showEmojiPicker && (
    <div
      style={{
        position: "absolute",
        bottom: "60px",
        left: "0",
        zIndex: 10,
      }}
    >
      <EmojiPicker
        onEmojiClick={(emojiData) => {
          setChatInput((prev) => prev + emojiData.emoji);
          setShowEmojiPicker(false); // close after selecting emoji
        }}
        theme="dark"
      />
    </div>
  )}

  <TextField
    fullWidth
    value={chatInput}
    onChange={(e) => setChatInput(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === "Enter") sendMessage();
    }}
    placeholder={chatLocked ? "Chat locked by host" : "Type a message..."}
    disabled={chatLocked}
  />

  <Button onClick={sendMessage} disabled={chatLocked}>
    Send
  </Button>
</div>

  </div>
)}

        </>
      )}
    </div>
  );
}
