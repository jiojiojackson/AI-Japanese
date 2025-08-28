document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed. Script is running.");

    // --- DOM Elements ---
    const recordButton = document.getElementById('record-button');
    const conversationArea = document.getElementById('conversation-area');
    const voiceSelect = document.getElementById('voice-select');

    // Initial AI message elements are templates, we'll create new ones
    const initialAiTextElement = document.getElementById('ai-text');
    const initialPlayButton = document.getElementById('play-button');

    const scoreValueElement = document.getElementById('score-value');
    const suggestionsTextElement = document.getElementById('suggestions-text');

    // --- State ---
    let isRecording = false;
    let recognition;
    let messages = []; // Array to store conversation history
    let lastAiQuestion = "";
    let finalTranscript = ""; // To accumulate transcript

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

        recognition.onend = () => {
            console.log("Recognition service ended.");
            if (isRecording) { // Only process if it was a user-initiated stop
                isRecording = false;
                recordButton.textContent = '🎤 録音開始';
                recordButton.classList.remove('is-recording');

                const userAnswer = finalTranscript.trim();
                if (userAnswer) {
                    console.log('Processing final answer on "end" event: ' + userAnswer);
                    addMessageToConversation('user', userAnswer);
                    messages.push({ role: 'user', content: userAnswer });
                    getAiResponse();
                    getEvaluation(lastAiQuestion, userAnswer);
                }
                finalTranscript = ""; // Reset for next turn
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            isRecording = false; // Reset state on error
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

    // --- Functions ---
    function startRecording() {
        if (recognition && !isRecording) {
            finalTranscript = ""; // Clear stale transcript before starting
            isRecording = true;
            recognition.start();
            recordButton.textContent = '⏹️ 録音停止';
            recordButton.classList.add('is-recording');
            console.log("Recording started...");
        }
    }

    function stopRecording() {
        if (recognition && isRecording) {
            // Just stop the service. The `onend` event will handle the rest.
            recognition.stop();
            console.log("Stop button clicked. Waiting for 'onend' event...");
        }
    }

    function addMessageToConversation(sender, text, furiganaHTML = null) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `${sender}-message`);

        const speakerElement = document.createElement('p');
        speakerElement.classList.add('speaker');
        speakerElement.textContent = sender === 'ai' ? 'AI:' : 'あなた:';
        messageElement.appendChild(speakerElement);

        const textElement = document.createElement('div');
        textElement.classList.add('text-content');

        if (sender === 'ai' && furiganaHTML) {
            textElement.innerHTML = furiganaHTML;
            lastAiQuestion = text; // Save the plain text for context
        } else {
            textElement.textContent = text;
        }
        messageElement.appendChild(textElement);

        if (sender === 'ai') {
            const playButton = document.createElement('button');
            playButton.textContent = '▶️ 再生';
            playButton.addEventListener('click', () => playAiAudio(text, playButton));
            messageElement.appendChild(playButton);
        }

        conversationArea.appendChild(messageElement);
        conversationArea.scrollTop = conversationArea.scrollHeight; // Auto-scroll
    }

    async function playAiAudio(text, button) {
        if (!text) return;
        try {
            const selectedVoice = voiceSelect.value;
            button.disabled = true;
            button.textContent = '🔊 再生中...';
            const response = await fetch('/synthesize-speech', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, voice_name: selectedVoice }),
            });
            if (!response.ok) throw new Error(`TTS HTTP error! status: ${response.status}`);

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            audio.play();
            audio.onended = () => {
                button.disabled = false;
                button.textContent = '▶️ 再生';
                URL.revokeObjectURL(audioUrl);
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

    async function getEvaluation(ai_question, user_answer) {
        scoreValueElement.textContent = '評価中...';
        suggestionsTextElement.textContent = '評価中...';
        try {
            const response = await fetch('/evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ai_question, user_answer }),
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);

            scoreValueElement.textContent = `${data.score} / 10`;
            suggestionsTextElement.textContent = data.suggestions;

        } catch (error) {
            console.error('Error getting evaluation:', error);
            scoreValueElement.textContent = 'エラー';
            suggestionsTextElement.textContent = '評価の取得中にエラーが発生しました。';
        }
    }

    function startConversation() {
        // Clear initial placeholder message
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
