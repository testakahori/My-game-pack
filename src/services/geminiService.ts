
import { GoogleGenAI, Type } from "@google/genai";
import { TikTokGift, GiftMapping } from "../types";

// Initialize the Gemini AI client
export const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Generates a set of 5 Minecraft commands for a specific TikTok gift name and intensity level.
 */
export async function generateMinecraftCommandSet(giftName: string, intensity: string): Promise<{ commands: string[]; description: string; giftIdSuggestion?: string }> {
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `Generate 5 creative Minecraft commands for a TikTok gift called "${giftName}" with an intensity of "${intensity}".
    The commands should include sounds, particles, or entities. Provide a brief description of the effect.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          commands: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of exactly 5 Minecraft commands.",
          },
          description: {
            type: Type.STRING,
            description: "A summary of what this command set does.",
          },
          giftIdSuggestion: {
            type: Type.STRING,
            description: "A placeholder or suggested Gift ID.",
          },
        },
        required: ["commands", "description"],
      },
    },
  });

  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    throw new Error("Invalid response from AI");
  }
}

/**
 * Suggests 5 popular gift ideas, each with 5 commands.
 */
export async function suggestGiftIdeaSet(): Promise<Omit<GiftMapping, 'id'>[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: "Suggest 5 popular TikTok gifts (like Rose, Heart, etc.) and for each gift, provide 5 fun and varied Minecraft commands.",
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            giftId: { type: Type.STRING },
            name: { type: Type.STRING },
            commands: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            description: { type: Type.STRING },
          },
          required: ["giftId", "name", "commands", "description"],
        },
      },
    },
  });

  try {
    return JSON.parse(response.text || "[]");
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    return [];
  }
}

/**
 * Fetches a database of popular TikTok gifts and recommended commands.
 */
export async function fetchLatestTikTokGifts(): Promise<TikTokGift[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: "Provide a list of 10 popular TikTok gifts with their known IDs and 3 recommended Minecraft commands for each to use in a live bridge application.",
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            giftId: { type: Type.STRING },
            name: { type: Type.STRING },
            description: { type: Type.STRING },
            recommendedCommands: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ["giftId", "name", "description", "recommendedCommands"],
        },
      },
    },
  });

  try {
    return JSON.parse(response.text || "[]");
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    return [];
  }
}
