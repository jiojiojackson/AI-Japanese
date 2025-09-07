import os
import json
from flask import Flask, request, jsonify, render_template, send_file, session, redirect, url_for, abort
from dotenv import load_dotenv
import struct
from io import BytesIO
import groq
from google import genai
from google.genai import types
from gtts import gTTS
import requests
import urllib.parse
import unicodedata

# Load environment variables from .env file
dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path=dotenv_path)

app = Flask(__name__)
# Secret for session cookies. In production set FLASK_SECRET (Vercel env).
app.secret_key = os.environ.get("FLASK_SECRET") or os.urandom(24)

# Simple auth: single password stored in APP_PASSWORD (Vercel env)
APP_PASSWORD = os.environ.get("APP_PASSWORD")

def is_authenticated() -> bool:
    return bool(session.get("logged_in"))

def login_required(fn):
    from functools import wraps

    @wraps(fn)
    def wrapper(*args, **kwargs):
        # If no APP_PASSWORD configured, treat app as open (useful for local dev)
        if not APP_PASSWORD:
            return fn(*args, **kwargs)

        if is_authenticated():
            return fn(*args, **kwargs)

        # If it's an HTML GET request, redirect to login page
        if request.method == 'GET' and 'text/html' in (request.headers.get('Accept', '') or ''):
            return redirect(url_for('login'))

        # Otherwise return a JSON 401 for API calls
        return jsonify({"error": "Unauthorized"}), 401

    return wrapper


@app.context_processor
def inject_auth_flags():
    return {"app_password_set": bool(APP_PASSWORD), "logged_in": session.get('logged_in', False)}

# In a real application, you would get the API key from a secure source
groq_client = groq.Groq(api_key=os.environ.get("GROQ_API_KEY"))
DEFAULT_MODEL = "openai/gpt-oss-120b"

POS_PROMPT = """
You are a Japanese morphological analysis expert. Your task is to process a Japanese sentence and return a structured JSON object representing the analysis.
The JSON object must be an array of "words". Each "word" object in the array contains the part-of-speech (`pos`) for the whole word, and a `word_tokens` array detailing its components.

For each component token in `word_tokens`, you must provide:
1. `surface`: The character(s) of the token.
2. `is_kanji`: A boolean, `true` if the surface is Kanji, `false` otherwise.
3. `reading`: If `is_kanji` is `true`, provide the contextually correct **Hiragana** reading. If `is_kanji` is `false`, this key can be omitted.

The top-level `pos` should be the main part of speech for the entire word (e.g., '名詞', '動詞').

Example Input: 「この食べ物は美味しい。」
Example JSON Output:
{
  "result": [
    {
      "pos": "連体詞",
      "word_tokens": [{"surface": "この", "is_kanji": false}]
    },
    {
      "pos": "名詞",
      "word_tokens": [
        {"surface": "食", "is_kanji": true, "reading": "た"},
        {"surface": "べ", "is_kanji": false},
        {"surface": "物", "is_kanji": true, "reading": "もの"}
      ]
    },
    {
      "pos": "助詞",
      "word_tokens": [{"surface": "は", "is_kanji": false}]
    },
    {
      "pos": "形容詞",
      "word_tokens": [
        {"surface": "美味", "is_kanji": true, "reading": "おい"},
        {"surface": "しい", "is_kanji": false}
      ]
    },
    {
      "pos": "記号",
      "word_tokens": [{"surface": "。", "is_kanji": false}]
    }
  ]
}
"""

def analyze_text_for_pos(text_to_analyze: str, model: str) -> dict:
    """Helper function to run POS analysis on a string."""
    pos_completion = groq_client.chat.completions.create(
        messages=[
            {"role": "system", "content": POS_PROMPT},
            {"role": "user", "content": text_to_analyze}
        ],
        model=model,
        response_format={"type": "json_object"},
    )
    pos_data = json.loads(pos_completion.choices[0].message.content)
    analyzed_tokens = pos_data.get("result", [])
    return {"text": text_to_analyze, "tokens": analyzed_tokens}


@app.route('/')
@login_required
def index():
    return render_template('index.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    # If no password configured, redirect to home
    if not APP_PASSWORD:
        return redirect(url_for('index'))

    if request.method == 'POST':
        pw = request.form.get('password', '')
        if pw == APP_PASSWORD:
            session['logged_in'] = True
            return redirect(url_for('index'))
        else:
            return render_template('login.html', error='密码错误')

    return render_template('login.html')


@app.route('/logout', methods=['POST', 'GET'])
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login') if APP_PASSWORD else url_for('index'))


@app.route('/get-presets')
@login_required
def get_presets():
    try:
        # Presets are in the root directory of the app
        presets_path = os.path.join(app.root_path, 'presets.json')
        with open(presets_path, 'r', encoding='utf-8') as f:
            presets = json.load(f)
        return jsonify(presets)
    except FileNotFoundError:
        return jsonify({"error": "Presets file not found."}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/chat', methods=['POST'])
@login_required
def chat():
    """
    Handles generating a conversational response from the AI.
    """
    messages = request.json.get('messages')
    model = request.json.get('model', DEFAULT_MODEL)
    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    try:
        # Step 1: Get the initial conversational response
        initial_completion = groq_client.chat.completions.create(
            messages=messages, model=model
        )
        raw_ai_text = initial_completion.choices[0].message.content

        # Step 2: Clean the response using a second AI call
        cleanup_prompt = "Reformat the following text into a simple, natural paragraph of Japanese. Remove markdown (like `**`, `*`, `1.`, `-`), fix repeated punctuation, and ensure it reads like a natural spoken response. Output only the cleaned text."
        cleanup_completion = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": cleanup_prompt},
                {"role": "user", "content": raw_ai_text}
            ],
            model=model,
        )
        cleaned_ai_text = cleanup_completion.choices[0].message.content.strip()

        return jsonify({"text": cleaned_ai_text})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/analyze', methods=['POST'])
@login_required
def analyze():
    """
    Performs Part-of-Speech (POS) analysis on a given text string.
    """
    text = request.json.get('text')
    model = request.json.get('model', DEFAULT_MODEL)
    if not text:
        return jsonify({"error": "No text provided"}), 400

    try:
        analysis_result = analyze_text_for_pos(text, model)
        if not analysis_result.get("tokens"):
             return jsonify({"text": text, "tokens": [{"word": text, "furigana": "", "pos": "その他"}]})
        return jsonify(analysis_result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/evaluate', methods=['POST'])
@login_required
def evaluate():
    """
    Evaluates the user's response using Groq.
    """
    ai_question = request.json.get('ai_question')
    user_answer = request.json.get('user_answer')
    model = request.json.get('model', DEFAULT_MODEL)

    if not user_answer or not ai_question:
        return jsonify({"error": "AI question or user answer missing"}), 400

    system_prompt = """
You are a helpful and friendly Japanese language tutor. Your role is to evaluate a user's spoken Japanese response for a Chinese-speaking student.
Provide your evaluation in a strict JSON format. The `explanation` field must be in Chinese.
The JSON object must have four keys: "score", "error_html", "corrected_sentence", and "explanation".
- "error_html": The user's original sentence, with errors wrapped in `<span class="error">...</span>` tags.
- "corrected_sentence": The correct and natural version of the sentence.
- "explanation": A brief, friendly, and encouraging string of feedback in Chinese.
"""

    try:
        chat_completion = groq_client.chat.completions.create(
            model=model,
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

def lookup_japanese(text):
    """Perform a full lookup for `text` and return accent and excerpts.

    This single function does URL encoding, the HTTP GET, JSON parsing,
    title matching, excerpt extraction, and accent calculation.

    Returns: dict {'accent_num': int|None, 'excerpts': [str,...], 'reading': str|None} or None on failure/no-match.
    """
    try:
        quoted = urllib.parse.quote(text)
        url = f"https://api.mojidict.com/app/mojidict/api/v1/search/all?text={quoted}&types=102&types=106&types=103&types=671&highlight=true"
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0'
        }

        resp = requests.get(url, headers=headers)
        if resp.status_code != 200:
            return None

        try:
            data = resp.json()
        except Exception:
            return None

        try:
            title = data['word']['list'][0]['title']
        except (TypeError, KeyError, IndexError):
            return None

        left = title.split('|', 1)[0].strip()
        if left != text:
            return None
        right = title.split('|', 1)[1][:-1].strip()

        node = data['word']['list'][0]
        raw_excerpts = []
        for k in ('excerpt', 'excerptB', 'excerptC'):
            if k in node and node[k]:
                raw_excerpts.append(node[k])

        excerpts = []
        for ex in raw_excerpts:
            try:
                txt = ex.split(']', 1)[0].strip()[1:]
            except Exception:
                txt = ex
            excerpts.append(txt)

        try:
            accent_num = int(unicodedata.numeric(title[-1]))
        except Exception:
            accent_num = None

        return {'accent_num': accent_num, 'excerpts': excerpts, 'reading': right}

    except requests.exceptions.RequestException:
        return None

@app.route('/explain-word', methods=['POST'])
@login_required
def explain_word():
    """
    Provides a detailed explanation for a word in the context of a sentence.
    """
    word = request.json.get('word')
    sentence = request.json.get('sentence')
    model = request.json.get('model', DEFAULT_MODEL)

    if not word or not sentence:
        return jsonify({"error": "Word or sentence not provided"}), 400

    system_prompt = """
You are a Japanese language expert providing detailed data for a language learning app. A user has clicked on a word within a sentence.
Your task is to return a single JSON object with no other text. All explanatory text must be in Chinese.

The JSON object must have the following keys:
1.  `"dictionary_form"`: A string of the word's dictionary form (原形). For "食べました", this would be "食べる". If the word is already in dictionary form, return the word itself.
2.  `"contextual_explanation"`: A string in Chinese explaining the word's meaning in the given sentence. **Crucially, if the word is inflected (not in its dictionary form), you must first state its dictionary form (原形), its current form (e.g., 'て形', 'ます形'), and briefly explain the conjugation rule, before explaining its meaning.**
3.  `"meanings"`: An array of objects. List all common meanings. Each object must have:
    - `"definition"`: A string in Chinese for the definition.
    - `"examples"`: An array of example objects. Each example object must have:
        - `"tokens"`: An array of token objects for the example sentence, following the morphological analysis rules below.
        - `"translation"`: A string in Chinese for the translation.

**Morphological Analysis Rules for `tokens` array:**
For each token, you must provide:
- `surface`: The character(s) of the token.
- `is_kanji`: A boolean, `true` if the surface is Kanji.
- `reading`: If `is_kanji` is `true`, provide the contextually correct **Hiragana** reading.

Example for an inflected verb like "食べました":
{
  "dictionary_form": "食べる",
  "contextual_explanation": "这是动词 '食べる' 的礼貌体过去式 (ます形 的过去式)。形变规则为[食べる](原型)->[食べます](ます形)->[食べました](过去式)。在这个句子中，意为“吃了”。",
  "meanings": [
    {
      "definition": "【动词】吃",
      "examples": [
        {
          "tokens": [{"surface": "朝", "is_kanji": true, "reading": "あさ"}, {"surface": "ご", "is_kanji": false},{"surface": "飯", "is_kanji": true, "reading": "はん"},{"surface": "を", "is_kanji": false}, {"surface": "食", "is_kanji": true, "reading": "た"}, {"surface": "べ", "is_kanji": false},{"surface": "ま", "is_kanji": false},{"surface": "し", "is_kanji": false},{"surface": "た", "is_kanji": false}, {"surface": "か", "is_kanji": false}, {"surface": "？", "is_kanji": false}],
          "translation": "你吃早饭了吗？"
        }
      ]
    }
  ]
}
"""
    user_prompt = f"Please explain the word '{word}' as it appears in the sentence: '{sentence}'"

    try:
        chat_completion = groq_client.chat.completions.create(
            model=model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
        )
        explanation_data = json.loads(chat_completion.choices[0].message.content)

        dictionary_form = explanation_data.get("dictionary_form")
        if dictionary_form:
            lookup_result = lookup_japanese(dictionary_form)
            if lookup_result:
                explanation_data['pitch_accent'] = lookup_result.get('accent_num')
                explanation_data['hiragana'] = lookup_result.get('reading')
                if lookup_result.get('excerpts'):
                    pos_details = [{"pos": p} for p in lookup_result['excerpts']]
                    if pos_details:
                        explanation_data['pos_details'] = pos_details
            else:
                # Add default null values if lookup fails
                explanation_data['pitch_accent'] = None
                explanation_data['hiragana'] = None
                explanation_data['pos_details'] = []

        return jsonify(explanation_data)
    except Exception as e:
        return jsonify({"error": f"Error explaining word: {str(e)}"}), 500

@app.route('/translate', methods=['POST'])
@login_required
def translate():
    """
    Translates a text to Chinese using Groq AI.
    """
    text = request.json.get('text')
    model = request.json.get('model', DEFAULT_MODEL)
    if not text:
        return jsonify({"error": "No text provided"}), 400

    try:
        system_prompt = "You are a helpful translation assistant. Translate the following Japanese text to Chinese. Return only the translated text, with no other explanations or surrounding text."

        chat_completion = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text}
            ],
            model=model,
        )
        translated_text = chat_completion.choices[0].message.content
        return jsonify({"translated_text": translated_text})

    except Exception as e:
        return jsonify({"error": f"Error during translation: {str(e)}"}), 500


@app.route('/punctuate', methods=['POST'])
@login_required
def punctuate():
    """
    Adds punctuation to a raw text string using Groq AI.
    """
    raw_text = request.json.get('text')
    model = request.json.get('model', DEFAULT_MODEL)
    if not raw_text:
        return jsonify({"error": "No text provided"}), 400

    try:
        system_prompt = "You are a helpful assistant. Add appropriate Japanese punctuation (like 、 and 。) to the following text. Do not change the words. Only return the punctuated text, with no other explanations or surrounding text."

        chat_completion = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": raw_text}
            ],
            model=model,
        )
        punctuated_text = chat_completion.choices[0].message.content
        return jsonify({"punctuated_text": punctuated_text})

    except Exception as e:
        return jsonify({"error": f"Error during punctuation: {str(e)}"}), 500

@app.route('/synthesize-speech', methods=['POST'])
@login_required
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
