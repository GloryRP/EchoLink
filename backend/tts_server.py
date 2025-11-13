from flask import Flask, request, jsonify, send_file
from gtts import gTTS
import os
import uuid

app = Flask(__name__)

@app.route("/speak", methods=["POST"])
def speak():
    data = request.get_json()
    text = data.get("text", "")
    lang = data.get("lang", "en")

    if not text.strip():
        return jsonify({"error": "Empty text"}), 400

    try:
        filename = f"{uuid.uuid4().hex}.mp3"
        filepath = os.path.join("audio", filename)
        os.makedirs("audio", exist_ok=True)
        tts = gTTS(text=text, lang=lang)
        tts.save(filepath)
        return send_file(filepath, mimetype="audio/mpeg")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(port=5001)
