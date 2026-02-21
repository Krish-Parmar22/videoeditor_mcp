import OpenAI from "openai";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const MAX_VIDEO_SIZE_MB = 50;

export function createCumulusVlmClient() {
  const endpoint = process.env.CUMULUS_VLM_ENDPOINT;
  const model = process.env.CUMULUS_VLM_MODEL;

  if (!endpoint || !model) {
    console.warn(
      "[Cumulus Labs VLM] CUMULUS_VLM_ENDPOINT or CUMULUS_VLM_MODEL not set — analyze-video tool will return errors"
    );
  }

  const client = new OpenAI({
    apiKey: process.env.CUMULUS_VLM_API_KEY || "EMPTY",
    baseURL: endpoint,
  });

  async function analyzeVideo(
    videoPath: string,
    question: string
  ): Promise<string> {
    if (!endpoint || !model) {
      throw new Error(
        "CUMULUS_VLM_ENDPOINT and CUMULUS_VLM_MODEL environment variables must be set"
      );
    }

    const resolved = path.resolve(videoPath);
    const info = await stat(resolved);
    const sizeMB = info.size / (1024 * 1024);

    if (sizeMB > MAX_VIDEO_SIZE_MB) {
      console.warn(
        `[Cumulus Labs VLM] Video file is ${sizeMB.toFixed(1)}MB (>${MAX_VIDEO_SIZE_MB}MB). Large files may be slow or fail.`
      );
    }

    const videoBuffer = await readFile(resolved);
    const base64 = videoBuffer.toString("base64");
    const ext = path.extname(resolved).slice(1).toLowerCase() || "mp4";
    const mimeType = ext === "mov" ? "video/quicktime" : `video/${ext}`;

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "video_url" as any,
              video_url: {
                url: `data:${mimeType};base64,${base64}`,
              },
            } as any,
            {
              type: "text",
              text: question,
            },
          ],
        },
      ],
      max_tokens: 4096,
    });

    return response.choices[0]?.message?.content ?? "";
  }

  async function analyzeVideoUrl(
    videoUrl: string,
    question: string
  ): Promise<string> {
    if (!endpoint || !model) {
      throw new Error(
        "CUMULUS_VLM_ENDPOINT and CUMULUS_VLM_MODEL environment variables must be set"
      );
    }

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "video_url" as any,
              video_url: {
                url: videoUrl,
              },
            } as any,
            {
              type: "text",
              text: question,
            },
          ],
        },
      ],
      max_tokens: 4096,
    });

    return response.choices[0]?.message?.content ?? "";
  }

  return { analyzeVideo, analyzeVideoUrl };
}
