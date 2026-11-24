const fs = require('fs');
const path = require('path');

const getDialogueData = () => {
  const filePath = path.join(__dirname, '../data/dialogueData.json');
  const rawData = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(rawData);
};

// Escape special regex characters in triggers
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Check if a trigger appears as a whole word or phrase (prevents "hi" matching "childhood" or "China")
const matchesWholeWord = (text, trigger) => {
  const pattern = new RegExp(`\\b${escapeRegex(trigger.toLowerCase())}\\b`, 'i');
  return pattern.test(text);
};

exports.handleChat = (req, res) => {
  try {
    const { message } = req.body;
    const userInput = (message || '').toLowerCase().trim();
    const data = getDialogueData();

    let bestMatch = null;
    let longestTriggerLength = 0;

    for (const topic of data.topics) {
      for (const trigger of topic.triggers) {
        if (matchesWholeWord(userInput, trigger) && trigger.length > longestTriggerLength) {
          bestMatch = topic;
          longestTriggerLength = trigger.length;
        }
      }
    }

    if (bestMatch) {
      return res.json({
        topicId: bestMatch.id,
        reply: bestMatch.reply,
        trustDelta: bestMatch.trustDelta,
        mood: bestMatch.mood,
        followUpOptions: bestMatch.followUpOptions,
      });
    }

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