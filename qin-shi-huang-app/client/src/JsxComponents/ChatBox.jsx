import { useState } from 'react';

function ChatBox() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [trustScore, setTrustScore] = useState(50);
  const [mood, setMood] = useState('Regal');
  const [suggestions, setSuggestions] = useState([
    'Greetings, Your Majesty',
    'How did you conquer China?',
    'When will you die?',
  ]);
  const [loading, setLoading] = useState(false);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userText = input;
    const updatedMessages = [...messages, { sender: 'You', text: userText }];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('http://localhost:5000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          history: messages,
        }),
      });

      if (!response.ok) {
        throw new Error('Server responded with an error');
      }

      const data = await response.json();

      setMessages((prev) => [
        ...prev,
        { sender: 'Qin Shi Huang', text: data.reply },
      ]);
      setMood(data.mood || 'Regal');
      setTrustScore((prev) =>
        Math.max(0, Math.min(100, prev + (data.trustDelta || 0)))
      );
      if (data.followUpOptions && data.followUpOptions.length > 0) {
        setSuggestions(data.followUpOptions);
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { sender: 'Error', text: 'Failed to reach server.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Qin Shi Huang Court</h1>
      <p>
        <strong>Mood:</strong> {mood} | <strong>Imperial Trust:</strong>{' '}
        {trustScore}/100
      </p>

      <div>
        {messages.map((msg, index) => (
          <p key={index}>
            <strong>{msg.sender}:</strong> {msg.text}
          </p>
        ))}
        {loading && <p>The Emperor is considering your words...</p>}
      </div>

      {suggestions.length > 0 && (
        <p>
          <em>Suggested topics to ask: {suggestions.join(' • ')}</em>
        </p>
      )}

      <form onSubmit={sendMessage}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Address the First Emperor..."
        />
        <button type="submit" disabled={loading}>
          Send
        </button>
      </form>
    </div>
  );
}

export default ChatBox;