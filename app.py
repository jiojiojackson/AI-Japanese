import os
import json
from flask import Flask, request, jsonify, render_template, send_file
from dotenv import load_dotenv
import struct
from io import BytesIO
import groq
from google import genai
from google.genai import types
from gtts import gTTS

# Load environment variables from .env file
dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path=dotenv_path)

app = Flask(__name__)

# In a real application, you would get the API key from a secure source
groq_client = groq.Groq(api_key=os.environ.get("GROQ_API_KEY"))

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
def chat():
    """
    Handles chat, cleans response, and performs POS tagging using AI calls.
    """
    messages = request.json.get('messages')
    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    try:
        # Step 1: Get the initial conversational response
        initial_completion = groq_client.chat.completions.create(
            messages=messages, model="openai/gpt-oss-120b"
        )
        raw_ai_text = initial_completion.choices[0].message.content

        # Step 2: Clean the response using a second AI call
        cleanup_prompt = "Reformat the following text into a simple, natural paragraph of Japanese. Remove markdown (like `**`, `*`, `1.`, `-`), fix repeated punctuation, and ensure it reads like a natural spoken response. Output only the cleaned text."
        cleanup_completion = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": cleanup_prompt},
                {"role": "user", "content": raw_ai_text}
            ],
            model="openai/gpt-oss-120b",
        )
        cleaned_ai_text = cleanup_completion.choices[0].message.content.strip()

        # Step 3: Perform POS tagging using a third AI call
        pos_prompt = """
You are a Japanese linguistics expert. Analyze the user's text by performing morphological analysis.
Return a JSON array of objects, where each object represents a token and has three keys: "word", "furigana", and "pos".
- "word": The token itself (the word).
- "furigana": The furigana reading in Katakana.
- "pos": The primary part of speech (e.g., '名詞', '動詞', '助詞', '形容詞', '記号').

Example Input: 「この猫はとても可愛いですね。」
Example JSON Output:
[
  {"word": "この", "furigana": "コノ", "pos": "連体詞"},
  {"word": "猫", "furigana": "ネコ", "pos": "名詞"},
  {"word": "は", "furigana": "ハ", "pos": "助詞"},
  {"word": "とても", "furigana": "トテモ", "pos": "副詞"},
  {"word": "可愛い", "furigana": "カワイイ", "pos": "形容詞"},
  {"word": "です", "furigana": "デス", "pos": "助動詞"},
  {"word": "ね", "furigana": "ネ", "pos": "助詞"},
  {"word": "。", "furigana": "。", "pos": "記号"}
]
"""
        pos_completion = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": pos_prompt},
                {"role": "user", "content": cleaned_ai_text}
            ],
            model="openai/gpt-oss-120b",
            response_format={"type": "json_object"},
        )
        # The response is a stringified JSON, so we need to parse it.
        # The AI is asked to return an array, but the JSON object response will likely wrap it in a key.
        # We will try to find the key that contains the array.
        pos_data = json.loads(pos_completion.choices[0].message.content)
        analyzed_tokens = []
        if isinstance(pos_data, list):
            analyzed_tokens = pos_data
        elif isinstance(pos_data, dict):
            # Find the first value in the dict that is a list
            for value in pos_data.values():
                if isinstance(value, list):
                    analyzed_tokens = value
                    break

        if not analyzed_tokens:
             # Fallback if parsing fails: return the plain text without tokens
             return jsonify({"text": cleaned_ai_text, "tokens": [{"word": cleaned_ai_text, "furigana": "", "pos": "その他"}]})

        response_data = {
            "text": cleaned_ai_text,
            "tokens": analyzed_tokens
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
You are a helpful and friendly Japanese language tutor. Your role is to evaluate a user's spoken Japanese response to your question.

Provide your evaluation in a strict JSON format, with no other text outside the JSON object. The JSON object must have the following four keys:
1.  `"score"`: An integer from 1 to 10, where 1 is poor and 10 is perfect.
2.  `"error_html"`: The user's original sentence, but with any grammatical errors or awkward phrasing wrapped in `<span class="error">...</span>` tags. If there are no errors, this should be the original sentence unmodified.
3.  `"corrected_sentence"`: The fully correct and natural-sounding version of the sentence.
4.  `"explanation"`: A brief, friendly, and encouraging string of feedback in Japanese, explaining the main error and how the corrected sentence improves it.

Example for a sentence with an error:
User's response: 「昨日、私に公園へ行きます。」
Your JSON output:
{
    "score": 6,
    "error_html": "昨日、<span class=\"error\">私に</span>公園へ<span class=\"error\">行きます</span>。",
    "corrected_sentence": "昨日、私は公園へ行きました。",
    "explanation": "助詞の「に」の使い方が少し不自然ですね。「は」を使うとより良いです。また、昨日のことなので、動詞は過去形の「行きました」にしましょう。"
}

Example for a correct sentence:
User's response: 「この猫はとても可愛いですね。」
Your JSON output:
{
    "score": 10,
    "error_html": "この猫はとても可愛いですね。",
    "corrected_sentence": "この猫はとても可愛いですね。",
    "explanation": "完璧です！とても自然な日本語です。"
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

@app.route('/punctuate', methods=['POST'])
def punctuate():
    """
    Adds punctuation to a raw text string using Groq AI.
    """
    raw_text = request.json.get('text')
    if not raw_text:
        return jsonify({"error": "No text provided"}), 400

    try:
        system_prompt = "You are a helpful assistant. Add appropriate Japanese punctuation (like 、 and 。) to the following text. Do not change the words. Only return the punctuated text, with no other explanations or surrounding text."

        chat_completion = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": raw_text}
            ],
            model="openai/gpt-oss-120b",
        )
        punctuated_text = chat_completion.choices[0].message.content
        return jsonify({"punctuated_text": punctuated_text})

    except Exception as e:
        return jsonify({"error": f"Error during punctuation: {str(e)}"}), 500

@app.route('/synthesize-speech', methods=['POST'])
def synthesize_speech():
    """
    Generates speech from text using either Gemini or gTTS engine.
    """
    text = request.json.get('text')
    engine = request.json.get('engine', 'gemini') # Default to gemini

    if not text:
        return jsonify({"error": "No text provided"}), 400

    try:
        if engine == 'gtts':
            tts = gTTS(text=text, lang='ja')
            mp3_fp = BytesIO()
            tts.write_to_fp(mp3_fp)
            mp3_fp.seek(0)
            return send_file(mp3_fp, mimetype='audio/mpeg')

        elif engine == 'gemini':
            voice_name = request.json.get('voice_name', 'Zephyr')
            api_key = os.environ.get("GEMINI_API_KEY")
            if not api_key:
                raise ValueError("GEMINI_API_KEY environment variable not set or empty.")

            client = genai.Client(api_key=api_key)
            model = "gemini-2.5-flash-preview-tts"
            contents = [types.Content(role="user", parts=[types.Part.from_text(text=text)])]
            generate_content_config = types.GenerateContentConfig(
                response_modalities=["audio"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice_name)
                    )
                ),
            )

            audio_buffer = BytesIO()
            for chunk in client.models.generate_content_stream(model=model, contents=contents, config=generate_content_config):
                if chunk.candidates and chunk.candidates[0].content and chunk.candidates[0].content.parts:
                    part = chunk.candidates[0].content.parts[0]
                    if part.inline_data and part.inline_data.data:
                        audio_buffer.write(part.inline_data.data)

            raw_audio_data = audio_buffer.getvalue()
            if not raw_audio_data:
                return jsonify({"error": "No audio data received from API. Check parameters."}), 500

            wav_data = convert_to_wav(raw_audio_data, "audio/L16;rate=24000")
            wav_buffer = BytesIO(wav_data)
            wav_buffer.seek(0)
            return send_file(wav_buffer, mimetype='audio/wav')

        else:
            return jsonify({"error": "Invalid TTS engine specified"}), 400

    except Exception as e:
        print(f"An exception occurred in synthesize_speech with engine {engine}: {e}")
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
