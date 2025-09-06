document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const recordButton = document.getElementById('record-button');
    const stopButton = document.getElementById('stop-button');
    const cancelButton = document.getElementById('cancel-button');
    const conversationArea = document.getElementById('conversation-area');
    const userControls = document.getElementById('user-controls');
    const realTimeTranscript = document.getElementById('real-time-transcript');

    // Preset Modal Elements
    const presetModal = document.getElementById('preset-modal');
    const personaSelect = document.getElementById('persona-select');
    const topicSelect = document.getElementById('topic-select');
    const startChatButton = document.getElementById('start-chat-button');

    // Settings Modal Elements
    const openSettingsButton = document.getElementById('open-settings-button');
    const closeSettingsButton = document.getElementById('close-settings-button');
    const settingsModal = document.getElementById('settings-modal');
    const modelSelects = {
        conversation: document.getElementById('model-select-conversation'),
        analysis: document.getElementById('model-select-analysis'),
        evaluation: document.getElementById('model-select-evaluation'),
        explanation: document.getElementById('model-select-explanation'),
        formatting: document.getElementById('model-select-formatting'),
        translation: document.getElementById('model-select-translation'),
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
    let presets = [];

    // --- Settings Logic ---
    function saveSettings() {
        for (const key in modelSelects) {
            localStorage.setItem(`settings-model-${key}`, modelSelects[key].value);
        }
    }

    function loadSettings() {
        modelSelects.conversation.value = localStorage.getItem('settings-model-conversation') || 'openai/gpt-oss-120b';
        modelSelects.analysis.value = localStorage.getItem('settings-model-analysis') || 'openai/gpt-oss-120b';
        modelSelects.evaluation.value = localStorage.getItem('settings-model-evaluation') || 'openai/gpt-oss-120b';
        modelSelects.explanation.value = localStorage.getItem('settings-model-explanation') || 'openai/gpt-oss-120b';
        modelSelects.formatting.value = localStorage.getItem('settings-model-formatting') || 'openai/gpt-oss-20b';
        modelSelects.translation.value = localStorage.getItem('settings-model-translation') || 'openai/gpt-oss-20b';
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
            let interim_transcript = '';
            let final_transcript_for_display = '';
            finalTranscript = '';

            for (let i = 0; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                    final_transcript_for_display += event.results[i][0].transcript;
                } else {
                    interim_transcript += event.results[i][0].transcript;
                }
            }
            realTimeTranscript.innerHTML = final_transcript_for_display + `<span class="interim-text">${interim_transcript}</span>`;
        };

        recognition.onend = async () => {
            recordButton.classList.remove('is-hidden');
            stopButton.classList.add('is-hidden');
            cancelButton.classList.add('is-hidden');
            realTimeTranscript.classList.add('is-hidden');

            if (isRecording) {
                isRecording = false;
                const rawUserAnswer = finalTranscript.trim();

                if (rawUserAnswer) {
                    const messageId = `user-message-${messageIdCounter++}`;
                    const punctuatedAnswer = await punctuateText(rawUserAnswer);

                    addMessageToConversation('user', punctuatedAnswer, messageId);
                    messages.push({ role: 'user', content: punctuatedAnswer });
                    getAiResponse();
                    getEvaluation(lastAiQuestion, punctuatedAnswer, messageId);
                }
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            isRecording = false;
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

    recordButton.addEventListener('click', startRecording);
    stopButton.addEventListener('click', stopRecording);
    cancelButton.addEventListener('click', cancelRecording);

    ttsEngineSelect.addEventListener('change', (e) => {
        geminiVoiceSettings.style.display = (e.target.value === 'gemini') ? 'block' : 'none';
    });

    personaSelect.addEventListener('change', () => {
        const selectedPersona = presets.find(p => p.persona === personaSelect.value);
        if (selectedPersona) {
            populateTopics(selectedPersona.topics);
        }
    });

    startChatButton.addEventListener('click', startConversation);


    // --- Functions ---
    function startRecording() {
        if (recognition && !isRecording) {
            finalTranscript = "";
            realTimeTranscript.textContent = "聞き取り中...";
            realTimeTranscript.classList.remove('is-hidden');
            isRecording = true;
            recognition.start();
            recordButton.classList.add('is-hidden');
            stopButton.classList.remove('is-hidden');
            cancelButton.classList.remove('is-hidden');
        }
    }

    function stopRecording() {
        if (recognition && isRecording) {
            recognition.stop();
        }
    }

    function cancelRecording() {
        if (recognition && isRecording) {
            isRecording = false;
            recognition.abort();
            realTimeTranscript.classList.add('is-hidden');
            finalTranscript = "";
        }
    }

    function addMessageToConversation(sender, text, messageId = null) {
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
        textElement.textContent = text; // Always start with plain text

        messageElement.appendChild(textElement);

        if (sender === 'ai') {
            lastAiQuestion = text;

            // Hide the text and add a click listener to reveal it
            textElement.classList.add('is-hidden');
            textElement.addEventListener('click', () => textElement.classList.remove('is-hidden'), { once: true });

            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'message-buttons';

            const playButton = document.createElement('button');
            playButton.textContent = '▶️ 再生';
            playButton.addEventListener('click', () => playAiAudio(text, playButton));

            const translateButton = document.createElement('button');
            translateButton.textContent = '文 翻译';
            translateButton.addEventListener('click', () => getTranslation(text, messageElement));

            const analyzeButton = document.createElement('button');
            analyzeButton.textContent = '分析';
            analyzeButton.addEventListener('click', (event) => {
                // Prevent the click from bubbling up to the textElement and revealing it
                event.stopPropagation();
                handleAnalysisClick(text, textElement, analyzeButton);
            });

            buttonContainer.appendChild(playButton);
            buttonContainer.appendChild(translateButton);
            buttonContainer.appendChild(analyzeButton);
            messageElement.appendChild(buttonContainer);

            playAiAudio(text, playButton);
        }
        conversationArea.appendChild(messageElement);
        conversationArea.scrollTop = conversationArea.scrollHeight;
    }

    async function handleAnalysisClick(text, textElement, button) {
        button.disabled = true;
        button.textContent = '分析中...';
        try {
            const response = await fetch('/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, model: getModelFor('analysis') })
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);

            // Re-render the textElement with tokens
            textElement.innerHTML = ''; // Clear the plain text
            data.tokens.forEach(word => {
                const wordSpan = document.createElement('span');
                wordSpan.classList.add('pos-token', `pos-${word.pos}`);

                word.word_tokens.forEach(token => {
                    if (token.is_kanji) {
                        const rubyElement = document.createElement('ruby');
                        rubyElement.appendChild(document.createTextNode(token.surface));
                        const rt = document.createElement('rt');
                        rt.textContent = token.reading;
                        rubyElement.appendChild(rt);
                        wordSpan.appendChild(rubyElement);
                    } else {
                        wordSpan.appendChild(document.createTextNode(token.surface));
                    }
                });

                wordSpan.style.cursor = 'pointer';
                wordSpan.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const surfaceWord = word.word_tokens.map(t => t.surface).join('');
                    showWordCard({ word: surfaceWord }, text);
                });

                textElement.appendChild(wordSpan);
            });
            button.classList.add('is-hidden'); // Hide button after analysis
        } catch (error) {
            console.error("Error fetching analysis:", error);
            button.disabled = false;
            button.textContent = '分析';
        }
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
                body: JSON.stringify({ text: text, model: getModelFor('translation') })
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
        wordCardPitch.style.display = 'none';
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

            wordCardTitle.textContent = data.dictionary_form || token.word;
            currentWordToPronounce = data.dictionary_form || token.word;

            if (data.pitch_accent !== null && data.pitch_accent !== undefined) {
                wordCardPitch.textContent = data.pitch_accent;
                wordCardPitch.style.display = 'inline-flex';
            }
            wordCardHiragana.textContent = data.hiragana;
            data.pos_details.forEach(pos => {
                const posTag = document.createElement('span');
                posTag.className = 'pos-detail-item';
                posTag.textContent = pos.pos;
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

                    const sentenceSpan = document.createElement('span');
                    ex.tokens.forEach(token => {
                        if (token.is_kanji) {
                            const ruby = document.createElement('ruby');
                            ruby.appendChild(document.createTextNode(token.surface));
                            const rt = document.createElement('rt');
                            rt.textContent = token.reading;
                            ruby.appendChild(rt);
                            sentenceSpan.appendChild(ruby);
                        } else {
                            sentenceSpan.appendChild(document.createTextNode(token.surface));
                        }
                    });

                    const translationSpan = document.createElement('span');
                    translationSpan.className = 'translation';
                    translationSpan.textContent = ex.translation;

                    li.appendChild(sentenceSpan);
                    li.appendChild(document.createElement('br'));
                    li.appendChild(translationSpan);
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
            addMessageToConversation('ai', data.text);
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
        const selectedPersonaName = personaSelect.value;
        const selectedTopicName = topicSelect.value;

        const persona = presets.find(p => p.persona === selectedPersonaName);
        if (!persona) return;

        const topic = persona.topics.find(t => t.name === selectedTopicName);
        if (!topic) return;

        const systemPrompt = persona.prompt_template.replace('{topic}', topic.name);
        messages = [
            { role: 'system', content: systemPrompt },
            { role: 'assistant', content: topic.starting_prompt }
        ];

        presetModal.classList.add('is-hidden');
        conversationArea.classList.remove('is-hidden');
        userControls.classList.remove('is-hidden');

        conversationArea.innerHTML = '';
        addMessageToConversation('ai', topic.starting_prompt);
    }

    function populateTopics(topics) {
        topicSelect.innerHTML = '';
        topics.forEach(topic => {
            const option = document.createElement('option');
            option.value = topic.name;
            option.textContent = topic.name;
            topicSelect.appendChild(option);
        });
    }

    async function initializeApp() {
        loadSettings();
        try {
            const response = await fetch('/get-presets');
            presets = await response.json();
            if (presets && presets.length > 0) {
                presets.forEach(preset => {
                    const option = document.createElement('option');
                    option.value = preset.persona;
                    option.textContent = preset.persona;
                    personaSelect.appendChild(option);
                });
                // Initial population of topics
                populateTopics(presets[0].topics);
            }
        } catch (error) {
            console.error("Failed to load presets:", error);
            presetModal.innerHTML = '<p>会話プリセットの読み込みに失敗しました。ページを再読み込みしてください。</p>';
        }
    }

    // --- Initial Run ---
    initializeApp();
});
