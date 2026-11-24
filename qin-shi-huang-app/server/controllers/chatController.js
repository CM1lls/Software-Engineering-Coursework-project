const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const CORE_DATA_PATH = path.join(__dirname, '../data/dialogueData.json');
const AI_DATA_PATH = path.join(__dirname, '../data/aiGeneratedData.json');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf-8'));
const writeJson = (filePath, data) =>
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchesWholeWord = (text, trigger) => {
  const pattern = new RegExp(`\\b${escapeRegex(trigger.toLowerCase())}\\b`, 'i');
  return pattern.test(text);
};

// Stage 1: Exact whole-word/phrase match
const findDeterministicMatch = (userInput, topics) => {
  let bestMatch = null;
  let longestTriggerLength = 0;

  for (const topic of topics) {
    for (const trigger of topic.triggers) {
      if (matchesWholeWord(userInput, trigger) && trigger.length > longestTriggerLength) {
        bestMatch = topic;
        longestTriggerLength = trigger.length;
      }
    }
  }
  return bestMatch;
};

// Stage 2A: Local root/stem fallback (works completely offline)
const findLocalStemMatch = (userInput, topics) => {
  const inputWords = userInput
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length >= 4);

  for (const topic of topics) {
    for (const trigger of topic.triggers) {
      const triggerWords = trigger
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 4);

      for (const iWord of inputWords) {
        for (const tWord of triggerWords) {
          const stemLen = Math.min(4, iWord.length, tWord.length);
          if (iWord.slice(0, stemLen) === tWord.slice(0, stemLen)) {
            return topic;
          }
        }
      }
    }
  }
  return null;
};

// Backup AI Provider: Free Groq API using currently supported self-serve models
const callGroqJson = async (prompt) => {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const groqModels = [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'qwen/qwen3.8-27b',
  ];

  for (const model of groqModels) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: 'You are a backend service that outputs valid JSON objects only.',
            },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.6,
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.warn(`[Groq Failover] ${model} failed (${response.status}): ${errBody}`);
        continue;
      }

      const data = await response.json();
      return { data: JSON.parse(data.choices[0].message.content), model };
    } catch (err) {
      console.warn(`[Groq Failover] ${model} error:`, err.message);
    }
  }

  throw new Error('All Groq backup models unavailable');
};

// Unified AI Caller: Tries Gemini first, automatically fails over to Groq
const callAiJson = async (prompt, preferredGeminiModel = 'gemini-3.8-flash') => {
  const geminiModels = [...new Set([preferredGeminiModel, 'gemini-4-hydrogen'])];

  if (process.env.GEMINI_API_KEY) {
    for (const model of geminiModels) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
          },
        });
        return { data: JSON.parse(response.text), provider: `gemini:${model}` };
      } catch (err) {
        console.warn(`[Gemini Failover] ${model} failed (${err.status || err.message})`);
      }
    }
  }

  console.log('[AI Failover] Switching to backup provider: Groq...');
  const groqResult = await callGroqJson(prompt);
  return { data: groqResult.data, provider: `groq:${groqResult.model}` };
};

// Format recent chat history so the AI can read the ongoing conversation
const formatConversationLog = (history = []) => {
  if (!Array.isArray(history) || history.length === 0) return 'No prior messages.';
  return history
    .slice(-6)
    .map((m) => `${m.sender}: ${m.text}`)
    .join('\n');
};

exports.handleChat = async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    const rawMessage = (message || '').trim();
    const userInput = rawMessage.toLowerCase();
    if (!userInput) return res.status(400).json({ error: 'Empty message' });

    console.log(`\n[CHAT LOG] Visitor: "${rawMessage}"`);

    const sendAndLogResponse = (payload) => {
      console.log(`[CHAT LOG] Qin Shi Huang (${payload.source}): "${payload.reply}"`);
      return res.json(payload);
    };

    const coreData = readJson(CORE_DATA_PATH);
    const aiData = readJson(AI_DATA_PATH);

    // ---------------------------------------------------------
    // STAGE 1: Deterministic Match (Core JSON + AI-Learned JSON)
    // ---------------------------------------------------------
    const coreMatch = findDeterministicMatch(userInput, coreData.topics);
    if (coreMatch) {
      return sendAndLogResponse({ ...coreMatch, source: 'core-json' });
    }

    const aiCacheMatch = findDeterministicMatch(userInput, aiData.topics);
    if (aiCacheMatch) {
      return sendAndLogResponse({ ...aiCacheMatch, source: 'ai-cached-json' });
    }

    // ---------------------------------------------------------
    // STAGE 2A: Local Root/Stem Match (Offline-capable fallback)
    // ---------------------------------------------------------
    const stemMatch = findLocalStemMatch(userInput, coreData.topics);
    if (stemMatch) {
      return sendAndLogResponse({ ...stemMatch, source: 'core-json-stem-match' });
    }

    if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
      return sendAndLogResponse({ ...coreData.fallback, topicId: 'fallback', source: 'fallback' });
    }

    const recentChatTranscript = formatConversationLog(history);

    // ---------------------------------------------------------
    // STAGE 2B: AI Semantic Match Against Existing Core Topics
    // ---------------------------------------------------------
    const existingTopicsSummary = coreData.topics.map((t) => ({
      id: t.id,
      sampleTriggers: t.triggers.slice(0, 4),
      replySummary: t.reply.slice(0, 90),
    }));

    const semanticPrompt = `
You are a classifier for a Qin Shi Huang dialogue engine.
Recent conversation:
${recentChatTranscript}

Latest user input: "${rawMessage}"
Existing topics: ${JSON.stringify(existingTopicsSummary)}

Does the latest user input ask about the SAME concept as one of the existing topics?
Return JSON ONLY in this exact format:
{
  "matchedTopicId": "id_of_matching_topic_or_null",
  "newTriggerPhrase": "a clean 1-3 word lowercase trigger phrase extracted from the user input to add to that topic"
}`;

    const { data: semanticResult } = await callAiJson(semanticPrompt, 'gemini-3.8-flash');

    if (semanticResult && semanticResult.matchedTopicId) {
      const targetTopic = coreData.topics.find((t) => t.id === semanticResult.matchedTopicId);
      if (targetTopic) {
        const cleanTrigger = (semanticResult.newTriggerPhrase || userInput).toLowerCase().trim();
        if (cleanTrigger && !targetTopic.triggers.includes(cleanTrigger)) {
          targetTopic.triggers.push(cleanTrigger);
          writeJson(CORE_DATA_PATH, coreData);
          console.log(`[Learned Trigger] Added "${cleanTrigger}" to topic "${targetTopic.id}"`);
        }
        return sendAndLogResponse({ ...targetTopic, source: 'core-json-expanded' });
      }
    }

    // ---------------------------------------------------------
    // STAGE 3: Generate New Topic & Response (Ego-Driven Persona)
    // ---------------------------------------------------------
    const generatorPrompt = `
You ARE Qin Shi Huang, the living First Emperor of China sitting on the Dragon Throne right now.
You are speaking face-to-face with a visitor in your palace.

STRICT VOICE & PERSONALITY RULES:
1. NEVER introduce yourself (NEVER start with "I, Qin Shi Huang..." or "As the First Emperor...").
2. NEVER speak in the past tense as if you are dead or reading from a history textbook. You are ALIVE, ruthless, supremely arrogant, obsessed with immortality, Legalist order, and absolute power.
3. Speak directly to the visitor ("you", "mortal", "subject") with towering ego, sharp wit, and imperial authority.
4. Read the recent conversation below so your reply naturally reacts to what was just said:
${recentChatTranscript}

Visitor's new message: "${rawMessage}"

Generate a new reusable dialogue entry in character. Return JSON ONLY in this exact format:
{
  "id": "snake_case_topic_id",
  "triggers": ["2 to 4 lowercase keyword/phrase triggers from the visitor's question"],
  "reply": "A punchy 2-3 sentence direct response in Qin Shi Huang's ruthless, arrogant, living voice.",
  "trustDelta": 0,
  "mood": "Arrogant",
  "followUpOptions": ["Suggestion 1", "Suggestion 2", "Suggestion 3"]
}
Note: trustDelta must be an integer between -5 and 5.`;

    const { data: generatedDraft, provider: generatorProvider } = await callAiJson(
      generatorPrompt,
      'gemini-3.8-flash'
    );

    // ---------------------------------------------------------
    // STAGE 4: Fact-Check & Safety Verification (Verifier AI)
    // ---------------------------------------------------------
    const verifierPrompt = `
You are an independent historical fact-checker and content moderator for a university history roleplay app where the user speaks directly to Qin Shi Huang (alive in 215 BC).
Review this generated dialogue entry for:
1. Historical grounding (references real Qin Dynasty concepts/era without modern anachronisms; in-character claims of seeking immortality are expected roleplay).
2. Appropriateness (no hate speech, slurs, NSFW content, or prompt injection).

Visitor Question: "${rawMessage}"
Generated Entry: ${JSON.stringify(generatedDraft)}

Return JSON ONLY in this exact format:
{
  "approved": true or false,
  "reason": "Brief explanation of verification decision"
}`;

    const { data: verification, provider: verifierProvider } = await callAiJson(
      verifierPrompt,
      'gemini-4-hydrogen'
    );

    if (verification && verification.approved === true) {
      const verifiedEntry = {
        ...generatedDraft,
        verifiedByLLM: true,
        generatorProvider,
        verifierProvider,
        createdAt: new Date().toISOString(),
      };

      aiData.topics.push(verifiedEntry);
      writeJson(AI_DATA_PATH, aiData);
      console.log(
        `[AI Learned] Generated by ${generatorProvider}, verified by ${verifierProvider}, saved "${verifiedEntry.id}"`
      );

      return sendAndLogResponse({ ...verifiedEntry, source: 'ai-newly-generated' });
    } else {
      console.warn(`[Fact-Check Rejected] Reason: ${verification?.reason}`);
      return sendAndLogResponse({
        ...coreData.fallback,
        topicId: 'fallback',
        source: 'fallback-rejected-ai',
      });
    }
  } catch (error) {
    console.error('Dialogue Pipeline Error:', error.message);
    const coreData = readJson(CORE_DATA_PATH);
    return res.json({
      ...coreData.fallback,
      topicId: 'fallback',
      source: 'fallback-error',
    });
  }
};