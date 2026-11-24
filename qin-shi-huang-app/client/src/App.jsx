import { useState } from 'react';

function App() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userText = input;
    setMessages((prev) => [...prev, { sender: 'You', text: userText }]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('http://localhost:5000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText }),
      });

      if (!response.ok) {
        throw new Error('Server responded with an error');
      }

      const data = await response.json();
      setMessages((prev) => [...prev, { sender: 'Qin Shi Huang', text: data.reply }]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [...prev, { sender: 'Error', text: 'Failed to reach server.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Qin Shi Huang Chatbot</h1>

      <div>
        {messages.map((msg, index) => (
          <p key={index}>
            <strong>{msg.sender}:</strong> {msg.text}
          </p>
        ))}
        {loading && <p>Thinking...</p>}
      </div>

      <form onSubmit={sendMessage}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
        />
        <button type="submit" disabled={loading}>Send</button>
      </form>
    </div>
  );
}

export default App;