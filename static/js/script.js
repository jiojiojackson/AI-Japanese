document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const recordButton = document.getElementById('record-button');
    const conversationArea = document.getElementById('conversation-area');
    const voiceSelect = document.getElementById('voice-select');
    const ttsEngineSelect = document.getElementById('tts-engine-select');
    const geminiVoiceSettings = document.getElementById('gemini-voice-settings');

    // --- State ---
    let isRecording = false;
    let recognition;
    let messages = [];
    let lastAiQuestion = "";
    let finalTranscript = "";
    let audioCache = {};
    let messageIdCounter = 0;

    // --- Speech Recognition Setup ---
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.lang = 'ja-JP';
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event) => {
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
        };

        recognition.onend = async () => {
            if (isRecording) {
                isRecording = false;
                recordButton.textContent = '🎤 録音開始';
                recordButton.classList.remove('is-recording');
                const rawUserAnswer = finalTranscript.trim();

                if (rawUserAnswer) {
                    const messageId = `user-message-${messageIdCounter++}`;
                    const punctuatedAnswer = await punctuateText(rawUserAnswer);

                    addMessageToConversation('user', punctuatedAnswer, null, messageId);
                    messages.push({ role: 'user', content: punctuatedAnswer });
                    getAiResponse();
                    getEvaluation(lastAiQuestion, punctuatedAnswer, messageId);
                }
                finalTranscript = "";
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            isRecording = false;
            recordButton.textContent = '🎤 録音開始';
            recordButton.classList.remove('is-recording');
        };
    } else {
        console.error("Speech Recognition not supported.");
        recordButton.disabled = true;
        recordButton.textContent = "音声認識はサポートされていません";
    }

    // --- Event Listeners ---
    recordButton.addEventListener('click', () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    ttsEngineSelect.addEventListener('change', (e) => {
        if (e.target.value === 'gemini') {
            geminiVoiceSettings.style.display = 'block';
        } else {
            geminiVoiceSettings.style.display = 'none';
        }
    });

    // --- Functions ---
    function startRecording() {
        if (recognition && !isRecording) {
            finalTranscript = "";
            isRecording = true;
            recognition.start();
            recordButton.textContent = '⏹️ 録音停止';
            recordButton.classList.add('is-recording');
        }
    }

    function stopRecording() {
        if (recognition && isRecording) {
            recognition.stop();
        }
    }

    function addMessageToConversation(sender, text, furiganaHTML = null, messageId = null) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `${sender}-message`);
        if (messageId) {
            messageElement.id = messageId;
        }

        const speakerElement = document.createElement('p');
        speakerElement.classList.add('speaker');
        speakerElement.textContent = sender === 'ai' ? 'AI:' : 'あなた:';
        messageElement.appendChild(speakerElement);

        const textElement = document.createElement('div');
        textElement.classList.add('text-content');
        if (messageId) {
            textElement.id = `${messageId}-text`;
        }

        if (sender === 'ai') {
            textElement.innerHTML = furiganaHTML;
            lastAiQuestion = text;
            textElement.classList.add('is-hidden');
            textElement.addEventListener('click', () => {
                textElement.classList.remove('is-hidden');
            }, { once: true });
        } else {
            textElement.textContent = text;
        }
        messageElement.appendChild(textElement);

        if (sender === 'ai') {
            const playButton = document.createElement('button');
            playButton.textContent = '▶️ 再生';
            playButton.addEventListener('click', () => playAiAudio(text, playButton));
            messageElement.appendChild(playButton);
            playAiAudio(text, playButton);
        }
        conversationArea.appendChild(messageElement);
        conversationArea.scrollTop = conversationArea.scrollHeight;
    }

    async function punctuateText(text) {
        if (!text) return "";
        try {
            const response = await fetch('/punctuate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text }),
            });
            if (!response.ok) {
                return text;
            }
            const data = await response.json();
            return data.punctuated_text || text;
        } catch (error) {
            console.error("Error punctuating text:", error);
            return text;
        }
    }

    async function playAiAudio(text, button) {
        if (!text) return;

        const selectedEngine = document.querySelector('input[name="tts-engine"]:checked').value;
        const selectedVoice = voiceSelect.value;
        const cacheKey = `${selectedEngine}-${selectedVoice}-${text}`;

        if (audioCache[cacheKey]) {
            const audio = new Audio(audioCache[cacheKey]);
            button.disabled = true;
            button.textContent = '🔊 再生中...';
            audio.play();
            audio.onended = () => {
                button.disabled = false;
                button.textContent = '▶️ 再生';
            };
            return;
        }

        try {
            button.disabled = true;
            button.textContent = '🔊 再生中...';
            const response = await fetch('/synthesize-speech', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    engine: selectedEngine,
                    voice_name: selectedVoice
                }),
            });
            if (!response.ok) throw new Error(`TTS HTTP error! status: ${response.status}`);

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            audioCache[cacheKey] = audioUrl;
            const audio = new Audio(audioUrl);
            audio.play();
            audio.onended = () => {
                button.disabled = false;
                button.textContent = '▶️ 再生';
            };
        } catch (error) {
            console.error('Error synthesizing speech:', error);
            button.disabled = false;
            button.textContent = '▶️ 再生';
        }
    }

    async function getAiResponse() {
        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages }),
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            messages.push({ role: 'assistant', content: data.text });
            addMessageToConversation('ai', data.text, data.furigana_html);
        } catch (error) {
            console.error('Error getting AI response:', error);
            addMessageToConversation('ai', 'すみません、エラーが発生しました。');
        }
    }

    async function getEvaluation(ai_question, user_answer, messageId) {
        try {
            const response = await fetch('/evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ai_question, user_answer }),
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);

            const messageElement = document.getElementById(messageId);
            const textElement = document.getElementById(`${messageId}-text`);
            if (messageElement && textElement) {
                textElement.innerHTML = data.error_html;

                const feedbackContainer = document.createElement('div');
                feedbackContainer.className = 'feedback-container';

                feedbackContainer.innerHTML = `
                    <div class="feedback-item"><strong>スコア:</strong> <span class="score">${data.score} / 10</span></div>
                    <div class="feedback-item"><strong>自然な言い方:</strong> <span class="corrected-sentence">${data.corrected_sentence}</span></div>
                    <div class="feedback-item"><strong>アドバイス:</strong> ${data.explanation}</div>
                `;
                messageElement.appendChild(feedbackContainer);
            }
        } catch (error) {
            console.error('Error getting evaluation:', error);
        }
    }

    function startConversation() {
        conversationArea.innerHTML = '';
        messages = [
            {
                role: "system",
                content: "You are a friendly Japanese conversation partner. Start the conversation with a simple, common question in Japanese. Keep your responses concise."
            }
        ];
        getAiResponse();
    }

    // --- Initial Run ---
    startConversation();
});
