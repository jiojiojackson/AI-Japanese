document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const recordButton = document.getElementById('record-button');
    const conversationArea = document.getElementById('conversation-area');

    // Settings Modal Elements
    const openSettingsButton = document.getElementById('open-settings-button');
    const closeSettingsButton = document.getElementById('close-settings-button');
    const settingsModal = document.getElementById('settings-modal');
    const modelSelects = {
        conversation: document.getElementById('model-select-conversation'),
        evaluation: document.getElementById('model-select-evaluation'),
        explanation: document.getElementById('model-select-explanation'),
        formatting: document.getElementById('model-select-formatting'),
    };

    // Word Card Modal Elements
    const wordCardModal = document.getElementById('word-card-modal');
    const closeWordCardButton = document.getElementById('close-word-card-button');
    const wordCardTitle = document.getElementById('word-card-title');
    const wordCardPitch = document.getElementById('word-card-pitch');
    const wordCardHiragana = document.getElementById('word-card-hiragana');
    const wordCardPosDetails = document.getElementById('word-card-pos-details');
    const wordCardPronounceButton = document.getElementById('word-card-pronounce-button');
    const wordCardContext = document.getElementById('word-card-context');
    const wordCardMeanings = document.getElementById('word-card-meanings');

    // TTS Elements
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
    let currentWordToPronounce = '';

    // --- Settings Logic ---
    function saveSettings() {
        for (const key in modelSelects) {
            localStorage.setItem(`settings-model-${key}`, modelSelects[key].value);
        }
    }

    function loadSettings() {
        modelSelects.conversation.value = localStorage.getItem('settings-model-conversation') || 'openai/gpt-oss-120b';
        modelSelects.evaluation.value = localStorage.getItem('settings-model-evaluation') || 'openai/gpt-oss-120b';
        modelSelects.explanation.value = localStorage.getItem('settings-model-explanation') || 'openai/gpt-oss-120b';
        modelSelects.formatting.value = localStorage.getItem('settings-model-formatting') || 'openai/gpt-oss-20b';
        saveSettings();
    }

    function getModelFor(task) {
        return modelSelects[task].value;
    }

    // --- Speech Recognition Setup ---
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.lang = 'ja-JP';
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event) => {
            finalTranscript = "";
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
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
            isRecording = false;
            recordButton.textContent = '🎤 録音開始';
            recordButton.classList.remove('is-recording');
        };
    } else {
        recordButton.disabled = true;
        recordButton.textContent = "音声認識はサポートされていません";
    }

    // --- Event Listeners ---
    openSettingsButton.addEventListener('click', () => settingsModal.classList.remove('is-hidden'));
    closeSettingsButton.addEventListener('click', () => settingsModal.classList.add('is-hidden'));
    closeWordCardButton.addEventListener('click', () => wordCardModal.classList.add('is-hidden'));

    wordCardPronounceButton.addEventListener('click', () => {
        if (currentWordToPronounce) {
            playAiAudio(currentWordToPronounce, wordCardPronounceButton);
        }
    });

    for (const key in modelSelects) {
        modelSelects[key].addEventListener('change', saveSettings);
    }

    recordButton.addEventListener('click', () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    ttsEngineSelect.addEventListener('change', (e) => {
        geminiVoiceSettings.style.display = (e.target.value === 'gemini') ? 'block' : 'none';
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

    function addMessageToConversation(sender, text, tokens = null, messageId = null) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `${sender}-message`);
        if (messageId) messageElement.id = messageId;

        const speakerElement = document.createElement('p');
        speakerElement.classList.add('speaker');
        speakerElement.textContent = sender === 'ai' ? 'AI:' : 'あなた:';
        messageElement.appendChild(speakerElement);

        const textElement = document.createElement('div');
        textElement.classList.add('text-content');
        if (messageId) textElement.id = `${messageId}-text`;

        if (sender === 'ai') {
            lastAiQuestion = text;
            tokens.forEach(token => {
                const rubyElement = document.createElement('ruby');
                rubyElement.classList.add('pos-token', `pos-${token.pos}`);
                rubyElement.style.cursor = 'pointer';
                rubyElement.appendChild(document.createTextNode(token.word));
                const rt = document.createElement('rt');
                rt.textContent = token.furigana;
                rubyElement.appendChild(rt);

                rubyElement.addEventListener('click', (event) => {
                    if (textElement.classList.contains('is-hidden')) return;
                    event.stopPropagation();
                    showWordCard(token, text);
                });

                textElement.appendChild(rubyElement);
            });
            textElement.classList.add('is-hidden');
            textElement.addEventListener('click', () => textElement.classList.remove('is-hidden'), { once: true });
        } else {
            textElement.textContent = text;
        }
        messageElement.appendChild(textElement);

        if (sender === 'ai') {
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'message-buttons';

            const playButton = document.createElement('button');
            playButton.textContent = '▶️ 再生';
            playButton.addEventListener('click', () => playAiAudio(text, playButton));

            const translateButton = document.createElement('button');
            translateButton.textContent = '文 翻译';
            translateButton.addEventListener('click', () => getTranslation(text, messageElement));

            buttonContainer.appendChild(playButton);
            buttonContainer.appendChild(translateButton);
            messageElement.appendChild(buttonContainer);

            playAiAudio(text, playButton);
        }
        conversationArea.appendChild(messageElement);
        conversationArea.scrollTop = conversationArea.scrollHeight;
    }

    async function getTranslation(text, messageElement) {
        const existingTranslation = messageElement.querySelector('.translation-text');
        if (existingTranslation) {
            existingTranslation.style.display = (existingTranslation.style.display === 'none') ? 'block' : 'none';
            return;
        }

        try {
            const response = await fetch('/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, model: getModelFor('conversation') }) // Use conversation model for translation
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);

            const translationP = document.createElement('p');
            translationP.className = 'translation-text';
            translationP.textContent = data.translated_text;
            messageElement.appendChild(translationP);

        } catch (error) {
            console.error("Error fetching translation:", error);
        }
    }

    async function showWordCard(token, sentence) {
        wordCardModal.classList.remove('is-hidden');
        wordCardTitle.textContent = token.word;
        wordCardPitch.textContent = '';
        wordCardHiragana.textContent = '加载中...';
        wordCardPosDetails.innerHTML = '';
        wordCardContext.textContent = '加载中...';
        wordCardMeanings.innerHTML = '<li>加载中...</li>';

        currentWordToPronounce = token.word;

        try {
            const response = await fetch('/explain-word', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    word: token.word,
                    sentence: sentence,
                    model: getModelFor('explanation')
                })
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);

            wordCardPitch.textContent = data.pitch_accent;
            wordCardHiragana.textContent = data.hiragana;
            data.pos_details.forEach(pos => {
                const posTag = document.createElement('span');
                posTag.className = 'pos-detail-item';
                posTag.textContent = `${pos.pos} (${pos.type}) ${pos.transitivity || ''}`.trim();
                wordCardPosDetails.appendChild(posTag);
            });

            wordCardContext.textContent = data.contextual_explanation;
            wordCardMeanings.innerHTML = '';
            data.meanings.forEach(meaning => {
                const meaningDiv = document.createElement('div');
                meaningDiv.className = 'meaning-group';
                const definitionP = document.createElement('p');
                definitionP.innerHTML = `<strong>${meaning.definition}</strong>`;
                meaningDiv.appendChild(definitionP);
                const exampleUl = document.createElement('ul');
                meaning.examples.forEach(ex => {
                    const li = document.createElement('li');
                    li.innerHTML = `<ruby>${ex.sentence}<rt>${ex.reading}</rt></ruby><br><span class="translation">${ex.translation}</span>`;
                    exampleUl.appendChild(li);
                });
                meaningDiv.appendChild(exampleUl);
                wordCardMeanings.appendChild(meaningDiv);
            });

        } catch (error) {
            wordCardContext.textContent = '解释获取失败。';
            wordCardMeanings.innerHTML = '';
        }
    }

    async function punctuateText(text) {
        if (!text) return "";
        try {
            const response = await fetch('/punctuate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, model: getModelFor('formatting') }),
            });
            if (!response.ok) return text;
            const data = await response.json();
            return data.punctuated_text || text;
        } catch (error) {
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
            button.disabled = false;
            button.textContent = '▶️ 再生';
        }
    }

    async function getAiResponse() {
        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: messages, model: getModelFor('conversation') }),
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            messages.push({ role: 'assistant', content: data.text });
            addMessageToConversation('ai', data.text, data.tokens);
        } catch (error) {
            addMessageToConversation('ai', 'すみません、エラーが発生しました。');
        }
    }

    async function getEvaluation(ai_question, user_answer, messageId) {
        try {
            const response = await fetch('/evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ai_question, user_answer, model: getModelFor('evaluation') }),
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
    loadSettings();
    startConversation();
});
