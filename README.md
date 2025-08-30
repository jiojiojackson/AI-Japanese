# 日本語会話チューター / Japanese Speaking Tutor

<img width="1304" height="788" alt="image" src="https://github.com/user-attachments/assets/38684b0f-3183-4fd3-b8b6-073b33d4c6e2" />
<img width="1305" height="825" alt="image" src="https://github.com/user-attachments/assets/4b0e993b-fc21-4392-b423-3debf38d8479" />



## 中文说明（简明）
这是一个基于 Flask 的小型 Web 应用，用于练习日语会话与发音。主要功能：
- 与 AI 进行日语对话（chat），生成自然的日文回复并以词为单位展示形态（包含假名/漢字标注）。
- 对用户语音转文字后进行标点修正（punctuate）、评估（evaluate）、并显示改正建议与得分。
- 单词点击弹出词卡（解释、平假名、词性、例句、声调信息）。
- TTS：支持两种合成引擎：Google Gemini（高质量）与 gTTS（备用）。
- 翻译：将日文翻译为中文（translate）。

后端主要调用 / 使用：
- groq (groq-client)：用于对话、评估、切分与解释等 AI 请求。
- google-genai：用作 Gemini TTS 合成（可选，高质量）。
- gTTS：作为简单的日语 TTS 备选。
- Flask：Web 框架。
- 浏览器端：使用 Web Speech API 做语音识别（交互在前端实现）。

本地运行（开发）
1. 创建虚拟环境并安装依赖：
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
2. 设置环境变量（示例）：
   export GROQ_API_KEY="your_groq_key"
   export GEMINI_API_KEY="your_gemini_key"      # 可选（如果使用 Gemini）
   export FLASK_SECRET="a_random_secret"
   export APP_PASSWORD="optional_password"      # 可选（启用登录保护）
3. 启动应用：
   python app.py
   アプリは http://0.0.0.0:5000 で利用可能です。

Vercel 部署（简要步骤）
1. 在项目根已包含 vercel.json（本项目使用 @vercel/python ビルド）。
2. 将代码推到 GitHub。登录 Vercel 并创建新プロジェクト，連携先選擇該倉庫。
3. 在 Vercel プロジェクト設定中追加環境変数：
   - GROQ_API_KEY
   - GEMINI_API_KEY（若使用 Gemini）
   - FLASK_SECRET
   - APP_PASSWORD（若需要登录保护）
4. 触发部署。Vercel 会读取 requirements.txt 并安装依赖。
5. 部署完成后访问公开的 URL，测试语音合成（TTS）、翻译等功能。

重要提示 / 注意
- 不要将 API Key 和密钥提交到公共仓库。
- 如果使用 Gemini TTS，请注意 Google GenAI 的使用条款与可能产生的费用。
- 浏览器端的 Web Speech API 支持情况因浏览器而异，推荐使用 Chrome 进行测试。

---

## English — Short README

This is a small Flask web app for practicing Japanese speaking and pronunciation.

Main features:
- Chat with an AI in Japanese; responses are cleaned and tokenized with POS and furigana for display.
- Speech-to-text (browser Web Speech API) → punctuation correction → evaluation with feedback and score.
- Clickable word cards showing readings, pitch accent, POS details and example sentences.
- TTS options: Google Gemini (high quality via google-genai) and gTTS (fallback).
- Translation endpoint: Japanese -> Chinese.

Backend tools and libraries:
- groq (AI completions for chat, evaluate, explain-word, punctuate, translate)
- google-genai (Gemini TTS streaming)
- gTTS (simple MP3 generation)
- Flask (web server)

Run locally:
1. python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
2. Export env vars:
   GROQ_API_KEY, GEMINI_API_KEY (optional), FLASK_SECRET, APP_PASSWORD (optional)
3. python app.py
   The app listens on 0.0.0.0:5000

Deploy to Vercel:
1. vercel.json is provided and uses @vercel/python.
2. Push repo to GitHub and import into Vercel.
3. Set required environment variables in Vercel dashboard.
4. Trigger deployment; Vercel will install dependencies from requirements.txt.

Notes:
- Never commit secrets to the repository.
- Gemini usage may incur costs; check provider policies.
- Browser Web Speech API support varies — Chrome recommended.

