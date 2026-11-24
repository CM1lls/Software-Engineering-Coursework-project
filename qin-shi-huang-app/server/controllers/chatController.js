const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

exports.handleChat = async (req, res) => {
  const { message } = req.body;
  const prompt = `You are Qin Shi Huang, the First Emperor of China. Reply in character: "${message}"`;

  try {
    // Primary model
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
    });
    return res.json({ reply: response.text });
  } catch (error) {
    // If 503 overloaded, automatically retry with the lighter model
    if (error.status === 503) {
      console.warn('gemini-3.8-flash busy (503), falling back to gemini-3.8-flash-lite...');
      try {
        const fallbackResponse = await ai.models.generateContent({
          model: 'gemini-3.8-flash-lite',
          contents: prompt,
        });
        return res.json({ reply: fallbackResponse.text });
      } catch (fallbackError) {
        console.error('Fallback Gemini Error:', fallbackError);
      }
    } else {
      console.error('Gemini Error:', error);
    }

    res.status(500).json({ error: 'The imperial court is currently overwhelmed. Please try again.' });
  }
};