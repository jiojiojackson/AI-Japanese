import os
import json
from flask import Flask, request, jsonify, render_template, send_file
from dotenv import load_dotenv
import struct
from io import BytesIO
from pykakasi import kakasi
import groq
from google import genai
from google.genai import types

# Load environment variables from .env file
# Explicitly providing path to .env file to avoid search issues.
dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path=dotenv_path)

app = Flask(__name__)
kks = kakasi()

# In a real application, you would get the API key from a secure source
# For this example, we'll use an environment variable
groq_client = groq.Groq(api_key=os.environ.get("GROQ_API_KEY"))

@app.route('/')
def index():
    return render_template('index.html')

def create_furigana_html(text):
    """
    Converts a Japanese string into HTML with <ruby> tags for furigana.
    """
    result = kks.convert(text)
    html_parts = []
    for item in result:
        orig = item['orig']
        hira = item['hira']
        if orig != hira:
            html_parts.append(f"<ruby>{orig}<rt>{hira}</rt></ruby>")
        else:
            html_parts.append(orig)
    return "".join(html_parts)

@app.route('/chat', methods=['POST'])
def chat():
    """
    Handles the chat request from the user, gets a response from Groq.
    """
    messages = request.json.get('messages')
    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    try:
        chat_completion = groq_client.chat.completions.create(
            messages=messages,
            model="openai/gpt-oss-120b",
        )
        ai_text = chat_completion.choices[0].message.content

        response_data = {
            "text": ai_text,
            "furigana_html": create_furigana_html(ai_text)
        }
        return jsonify(response_data)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/evaluate', methods=['POST'])
def evaluate():
    """
    Evaluates the user's response using Groq.
    """
    ai_question = request.json.get('ai_question')
    user_answer = request.json.get('user_answer')

    if not user_answer or not ai_question:
        return jsonify({"error": "AI question or user answer missing"}), 400

    system_prompt = """
    You are a helpful and friendly Japanese language tutor.
    Your role is to evaluate a user's spoken response to your question.
    Provide your evaluation in a strict JSON format. The JSON object must have two keys:
    1. "score": An integer from 1 to 10, where 1 is poor and 10 is perfect.
    2. "suggestions": A brief, friendly, and encouraging string of feedback in Japanese. Focus on one or two key areas for improvement. If the answer is perfect, give praise.

    Example response:
    {
        "score": 8,
        "suggestions": "素晴らしい！発音はとても自然です。文法もほぼ完璧ですが、「私は」を省略するともっと自然に聞こえますよ。"
    }
    """

    try:
        chat_completion = groq_client.chat.completions.create(
            model="openai/gpt-oss-120b",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"My question to the student was: '{ai_question}'. The student's response was: '{user_answer}'. Please evaluate it."}
            ]
        )
        evaluation_data = json.loads(chat_completion.choices[0].message.content)
        return jsonify(evaluation_data)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/synthesize-speech', methods=['POST'])
def synthesize_speech():
    """
    Generates speech from text using the Gemini TTS API and returns it as a WAV file.
    """
    text = request.json.get('text')
    voice_name = request.json.get('voice_name', 'Zephyr') # Default voice

    if not text:
        return jsonify({"error": "No text provided"}), 400

    try:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY environment variable not set or empty.")

        client = genai.Client(api_key=api_key)
        model = "gemini-2.5-flash-preview-tts"
        contents = [
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(text=text),
                ],
            ),
        ]
        generate_content_config = types.GenerateContentConfig(
            response_modalities=["audio"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=voice_name
                    )
                )
            ),
        )

        audio_buffer = BytesIO()
        for chunk in client.models.generate_content_stream(
            model=model,
            contents=contents,
            config=generate_content_config,
        ):
            if chunk.candidates and chunk.candidates[0].content and chunk.candidates[0].content.parts:
                part = chunk.candidates[0].content.parts[0]
                if part.inline_data and part.inline_data.data:
                    audio_buffer.write(part.inline_data.data)

        raw_audio_data = audio_buffer.getvalue()
        if not raw_audio_data:
            # This could happen if the request is bad (e.g., invalid voice name)
            return jsonify({"error": "No audio data received from API. Check parameters like voice_name."}), 500

        wav_data = convert_to_wav(raw_audio_data, "audio/L16;rate=24000")
        wav_buffer = BytesIO(wav_data)
        wav_buffer.seek(0)

        return send_file(wav_buffer, mimetype='audio/wav')

    except Exception as e:
        # Log the full error to the console for debugging
        print(f"An exception occurred in synthesize_speech: {e}")
        return jsonify({"error": f"An internal error occurred: {str(e)}"}), 500


def convert_to_wav(audio_data: bytes, mime_type: str) -> bytes:
    """Generates a WAV file header for the given audio data and parameters."""
    parameters = parse_audio_mime_type(mime_type)
    bits_per_sample = parameters["bits_per_sample"]
    sample_rate = parameters["rate"]
    num_channels = 1
    data_size = len(audio_data)
    bytes_per_sample = bits_per_sample // 8
    block_align = num_channels * bytes_per_sample
    byte_rate = sample_rate * block_align
    chunk_size = 36 + data_size

    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", chunk_size, b"WAVE", b"fmt ", 16, 1, num_channels, sample_rate,
        byte_rate, block_align, bits_per_sample, b"data", data_size
    )
    return header + audio_data

def parse_audio_mime_type(mime_type: str) -> dict[str, int | None]:
    """Parses bits per sample and rate from an audio MIME type string."""
    bits_per_sample = 16
    rate = 24000
    parts = mime_type.split(";")
    for param in parts:
        param = param.strip()
        if param.lower().startswith("rate="):
            try:
                rate = int(param.split("=", 1)[1])
            except (ValueError, IndexError):
                pass
        elif param.startswith("audio/L"):
            try:
                bits_per_sample = int(param.split("L", 1)[1])
            except (ValueError, IndexError):
                pass
    return {"bits_per_sample": bits_per_sample, "rate": rate}


if __name__ == '__main__':
    app.run(debug=True, use_reloader=False, host='0.0.0.0', port=5000)
