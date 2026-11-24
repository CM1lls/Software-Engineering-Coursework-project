const fs = require('fs');
const path = require('path');

// Load the JSON file dynamically so edits are easy to test
const getDialogueData = () => {
  const filePath = path.join(__dirname, '../data/dialogueData.json');
  const rawData = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(rawData);
};

exports.handleChat = (req, res) => {
  try {
    const { message } = req.body;
    const userInput = (message || '').toLowerCase().trim();
    const data = getDialogueData();

    // Find the first topic where any trigger phrase appears in the user's message
    const matchedTopic = data.topics.find((topic) =>
      topic.triggers.some((trigger) => userInput.includes(trigger.toLowerCase()))
    );

    if (matchedTopic) {
      return res.json({
        topicId: matchedTopic.id,
        reply: matchedTopic.reply,
        trustDelta: matchedTopic.trustDelta,
        mood: matchedTopic.mood,
        followUpOptions: matchedTopic.followUpOptions,
      });
    }

    // Return the predetermined fallback if no trigger matched
    return res.json({
      topicId: 'fallback',
      reply: data.fallback.reply,
      trustDelta: 0,
      mood: data.fallback.mood,
      followUpOptions: data.fallback.followUpOptions,
    });
  } catch (error) {
    console.error('Dialogue Engine Error:', error);
    res.status(500).json({ error: 'Failed to process dialogue.' });
  }
};