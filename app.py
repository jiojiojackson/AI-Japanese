import os
import json
from flask import Flask, request, jsonify, render_template, send_file
from dotenv import load_dotenv
from gtts import gTTS
from io import BytesIO
from pykakasi import kakasi
import groq

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
kks = kakasi()

# In a real application, you would get the API key from a secure source
# For this example, we'll use an environment variable
client = groq.Groq(api_key=os.environ.get("GROQ_API_KEY"))

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
        chat_completion = client.chat.completions.create(
            messages=messages,
            model="llama3-8b-8192",
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
        chat_completion = client.chat.completions.create(
            model="llama3-8b-8192",
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
    Generates speech from text using gTTS and returns it as an audio file.
    """
    text = request.json.get('text')
    lang = request.json.get('lang', 'ja') # Default to Japanese

    if not text:
        return jsonify({"error": "No text provided"}), 400

    try:
        tts = gTTS(text=text, lang=lang)
        mp3_fp = BytesIO()
        tts.write_to_fp(mp3_fp)
        mp3_fp.seek(0)
        return send_file(mp3_fp, mimetype='audio/mpeg')
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, use_reloader=False, host='0.0.0.0', port=5000)
