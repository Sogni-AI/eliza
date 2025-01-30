import {
  Action,
  IAgentRuntime,
  Memory,
  HandlerCallback,
  elizaLogger,
  generateText,
  ModelClass,
  State,
  Plugin,
} from "@elizaos/core";
import crypto from "node:crypto";
import { generateImage } from "@elizaos/core";
import fs from "fs";
import path from "path";
import { validateImageGenConfig } from "./environment";


// Save a base64-encoded image to disk.
export function saveBase64Image(base64Data: string, filename: string): string {
  // Create generatedImages directory if it doesn't exist
  const imageDir = path.join(process.cwd(), "generatedImages");
  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
  }

  // If the base64 data starts with data:image/... strip out the prefix
  let rawData = base64Data;
  if (rawData.startsWith("data:image")) {
    const commaIndex = rawData.indexOf(",");
    rawData = rawData.substring(commaIndex + 1);
  }

  // Create a buffer from the base64 string
  const imageBuffer = Buffer.from(rawData, "base64");

  // Create full file path
  const filepath = path.join(imageDir, `${filename}.png`);

  // Save the file
  fs.writeFileSync(filepath, imageBuffer);

  return filepath;
}

// Save an image from a remote HTTP or HTTPS URL to disk.
export async function saveHeuristImage(
  imageUrl: string,
  filename: string
): Promise<string> {
  const imageDir = path.join(process.cwd(), "generatedImages");
  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
  }

  // Fetch image from URL
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image from ${imageUrl}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const imageBuffer = Buffer.from(arrayBuffer);

  // Create full file path
  const filepath = path.join(imageDir, `${filename}.png`);
  fs.writeFileSync(filepath, imageBuffer);

  return filepath;
}

const IMAGE_PROMPT_INPUT = `You are tasked with generating an image prompt based on a content and a specified style.
Your goal is to create a detailed and vivid image prompt that captures the essence of the content while incorporating an appropriate subject based on your analysis of the content.

1. Main subject
2. Detailed description
3. Style
4. Lighting
5. Composition
6. Quality modifiers

To generate the image prompt, follow these steps:

1. Analyze the content text carefully, identifying key themes, emotions, and visual elements mentioned or implied.

2. Determine the most appropriate main subject by:
   - Identifying concrete objects or persons mentioned in the content
   - Analyzing the central theme or message
   - Considering metaphorical representations of abstract concepts
   - Selecting a subject that best captures the content's essence

3. Determine an appropriate environment or setting based on the content's context and your chosen subject.

4. Decide on suitable lighting that enhances the mood or atmosphere of the scene.

5. Choose a color palette that reflects the content's tone and complements the subject.

6. Identify the overall mood or emotion conveyed by the content.

7. Plan a composition that effectively showcases the subject and captures the content's essence.

8. Incorporate the specified style into your description, considering how it affects the overall look and feel of the image.

9. Use concrete nouns and avoid abstract concepts when describing the main subject and elements of the scene.

Construct your image prompt using the following structure:

1. Main subject: Describe the primary focus of the image based on your analysis
2. Environment: Detail the setting or background
3. Lighting: Specify the type and quality of light in the scene
4. Colors: Mention the key colors and their relationships
5. Mood: Convey the overall emotional tone
6. Composition: Describe how elements are arranged in the frame
7. Style: Incorporate the given style into the description

Ensure that your prompt is detailed, vivid, and incorporates all the elements mentioned above while staying true to the content and the specified style. LIMIT the image prompt 50 words or less.

Write your final prompt now.
`;

const IMAGE_SYSTEM_PROMPT = `Your job is to produce an image prompt from the instructions.
Keep it succinct but incorporate main details. Just respond with the final image prompt text, no extra commentary.`;

const imageGeneration: Action = {
  name: "GENERATE_IMAGE",
  similes: [
    "IMAGE_GENERATION",
    "IMAGE_GEN",
    "CREATE_IMAGE",
    "MAKE_PICTURE",
    "GENERATE_IMAGE",
    "GENERATE_A",
    "DRAW",
    "DRAW_A",
    "MAKE_A",
  ],
  description: "Generate an image to go along with the message.",
  suppressInitialMessage: true,

  // Unified validation to allow usage if ANY known key is present
  validate: async (runtime: IAgentRuntime, _message: Memory) => {
    // Validate environment config for all libraries
    await validateImageGenConfig(runtime);

    const anthropicApiKeyOk = !!runtime.getSetting("ANTHROPIC_API_KEY");
    const nineteenAiApiKeyOk = !!runtime.getSetting("NINETEEN_AI_API_KEY");
    const togetherApiKeyOk = !!runtime.getSetting("TOGETHER_API_KEY");
    const heuristApiKeyOk = !!runtime.getSetting("HEURIST_API_KEY");
    const falApiKeyOk = !!runtime.getSetting("FAL_API_KEY");
    const openAiApiKeyOk = !!runtime.getSetting("OPENAI_API_KEY");
    const veniceApiKeyOk = !!runtime.getSetting("VENICE_API_KEY");
    const livepeerGatewayUrlOk = !!runtime.getSetting("LIVEPEER_GATEWAY_URL");

    // Additional keys from new code
    const xAiApiKeyOk = !!runtime.getSetting("XAI_API_KEY");
    const sogniOk = !!runtime.getSetting("SOGNI_APP_ID");

    return (
      anthropicApiKeyOk ||
      nineteenAiApiKeyOk ||
      togetherApiKeyOk ||
      heuristApiKeyOk ||
      falApiKeyOk ||
      openAiApiKeyOk ||
      veniceApiKeyOk ||
      livepeerGatewayUrlOk ||
      xAiApiKeyOk ||
      sogniOk
    );
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: Record<string, any>,
    callback?: HandlerCallback
  ) => {
    // Optional: Attempt to compose state
    // elizaLogger.log("Composing state for message:", message);
    // const composedState = await runtime.composeState(message);
    // if (composedState) {
    //   state = composedState as State;
    // }

    // 1) Combine user input with the big block to produce final context
    const userText = (message?.content?.text || "").trim();
    const finalContext = `${IMAGE_PROMPT_INPUT}\n\nUser content:\n${userText}`;

    // Generate a short image prompt from the instructions
    let imagePrompt: string;
    try {
      imagePrompt = await generateText({
        runtime,
        context: finalContext,
        modelClass: ModelClass.MEDIUM,
        customSystemPrompt: IMAGE_SYSTEM_PROMPT,
      });
    } catch (err) {
      elizaLogger.error("Error generating the short image prompt text:", err);
      // fallback if generation fails
      imagePrompt = userText;
    }

    elizaLogger.log("imagePrompt used for generation:", imagePrompt);

    // Possibly read from character-provided image settings
    const imageSettings = runtime.character?.settings?.imageSettings || {};
    elizaLogger.log("Image settings:", imageSettings);

    // Validate config again for Sogni usage
    const config = await validateImageGenConfig(runtime);
    const sogniOk = !!runtime.getSetting("SOGNI_APP_ID");

    if (sogniOk) {
      // Attempt Sogni generation
      let SogniClient;
      try {
        // Dynamically import only if needed
        ({ SogniClient } = await import("@sogni-ai/sogni-client"));
      } catch (dynErr) {
        elizaLogger.error("Failed dynamic import of SogniClient:", dynErr);
        callback?.(
          { text: "Could not import Sogni. Check logs." },
          []
        );
        return;
      }

      let sogniClient: any;
      try {
        elizaLogger.log("Initializing Sogni client...", config.SOGNI_APP_ID);
        sogniClient = await SogniClient.createInstance({
          appId: config.SOGNI_APP_ID || "",
          restEndpoint: "https://api.sogni.ai",
          socketEndpoint: "https://socket.sogni.ai",
          testnet: true,
          network: "fast",
        });

        elizaLogger.log(
          "Sogni client created. Logging in...",
          config.SOGNI_USERNAME
        );
        await sogniClient.account.login(
          config.SOGNI_USERNAME || "",
          config.SOGNI_PASSWORD || ""
        );
        elizaLogger.log("Sogni login successful.");
      } catch (e) {
        elizaLogger.error("Failed to initialize or login to Sogni:", e);
        callback?.(
          {
            text: "Error: could not initialize Sogni. Please check logs.",
          },
          []
        );
        return;
      }

      // Generate images via Sogni
      let images: string[] = [];
      try {
        elizaLogger.log("Creating Sogni project with prompt:", imagePrompt);
        const project = await sogniClient.projects.create({
          modelId: "flux1-schnell-fp8",
          positivePrompt: imagePrompt,
          negativePrompt: "",
          stylePrompt: "",
          steps: 4,
          guidance: 1,
          numberOfImages: 1,
          scheduler: "Euler",
          timeStepSpacing: "Linear",
        });

        elizaLogger.log("Project created:", project);

        // Wait for completion
        const projectImages = await project.waitForCompletion();
        elizaLogger.log(
          `Project completed. Received ${projectImages.length} images.`
        );

        images = projectImages;
      } catch (error) {
        elizaLogger.error("Error generating images via Sogni:", error);
        callback?.(
          {
            text: "Error: Sogni image generation failed. Check logs.",
          },
          []
        );
        return;
      }

      if (images && images.length > 0) {
        elizaLogger.log(
          "Sogni image generation successful, number of images:",
          images.length
        );
        for (let i = 0; i < images.length; i++) {
          const imageUrl = images[i];
          const filename = `generated_${Date.now()}_${i}`;
          try {
            // Sogni returns a standard URL
            const filepath = await saveHeuristImage(imageUrl, filename);
            elizaLogger.log(`Processed Sogni image ${i + 1}:`, filename);

            // For each image, we pass back an attachment
            callback?.(
              {
                text: "...",
                attachments: [
                  {
                    id: crypto.randomUUID(),
                    url: filepath,
                    title: "Generated image",
                    source: "imageGeneration",
                    description: "...",
                    text: "...",
                    contentType: "image/png",
                  },
                ],
              },
              []
            );
          } catch (err) {
            elizaLogger.error("Failed saving Sogni image locally:", err);
            continue;
          }
        }
      } else {
        elizaLogger.error("No images returned from Sogni or empty array.");
      }
    } else {
      // Fallback approach using generateImage from @elizaos/core
      elizaLogger.log("Sogni not configured. Using fallback approach.");

      const fallbackImages = await generateImage(
        {
          prompt: imagePrompt,
          width: options.width || imageSettings.width || 1024,
          height: options.height || imageSettings.height || 1024,
          ...(options.count != null || imageSettings.count != null
            ? { count: options.count || imageSettings.count || 1 }
            : {}),
          ...(options.negativePrompt != null ||
          imageSettings.negativePrompt != null
            ? {
                negativePrompt:
                  options.negativePrompt || imageSettings.negativePrompt,
              }
            : {}),
          ...(options.numIterations != null ||
          imageSettings.numIterations != null
            ? {
                numIterations:
                  options.numIterations || imageSettings.numIterations,
              }
            : {}),
          ...(options.guidanceScale != null ||
          imageSettings.guidanceScale != null
            ? {
                guidanceScale:
                  options.guidanceScale || imageSettings.guidanceScale,
              }
            : {}),
          ...(options.seed != null || imageSettings.seed != null
            ? { seed: options.seed || imageSettings.seed }
            : {}),
          ...(options.modelId != null || imageSettings.modelId != null
            ? { modelId: options.modelId || imageSettings.modelId }
            : {}),
          ...(options.jobId != null || imageSettings.jobId != null
            ? { jobId: options.jobId || imageSettings.jobId }
            : {}),
          ...(options.stylePreset != null || imageSettings.stylePreset != null
            ? {
                stylePreset:
                  options.stylePreset || imageSettings.stylePreset,
              }
            : {}),
          ...(options.hideWatermark != null ||
          imageSettings.hideWatermark != null
            ? {
                hideWatermark:
                  options.hideWatermark || imageSettings.hideWatermark,
              }
            : {}),
        },
        runtime
      );

      if (fallbackImages.success && fallbackImages.data?.length > 0) {
        elizaLogger.log(
          "Fallback image generation success, number of images:",
          fallbackImages.data.length
        );
        for (let i = 0; i < fallbackImages.data.length; i++) {
          const image = fallbackImages.data[i];
          const filename = `generated_${Date.now()}_${i}`;

          let filepath: string;
          if (image.startsWith("http")) {
            filepath = await saveHeuristImage(image, filename);
          } else {
            filepath = saveBase64Image(image, filename);
          }

          elizaLogger.log(`Processed fallback image ${i + 1}:`, filename);

          callback?.(
            {
              text: "...",
              attachments: [
                {
                  id: crypto.randomUUID(),
                  url: filepath,
                  title: "Generated image",
                  source: "imageGeneration",
                  description: "...",
                  text: "...",
                  contentType: "image/png",
                },
              ],
            },
            []
          );
        }
      } else {
        elizaLogger.error("Fallback image generation returned no data or failed.");
      }
    }
  },

  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Please generate an image of a futuristic city." },
      },
      {
        user: "{{user2}}",
        content: { text: "...", action: "GENERATE_IMAGE" },
      },
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Generate an image of a cat" },
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Here's an image of a cat",
          action: "GENERATE_IMAGE",
        },
      },
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Generate an image of a dog" },
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Here's an image of a dog",
          action: "GENERATE_IMAGE",
        },
      },
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Create an image of a cat with a hat" },
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Here's an image of a cat with a hat",
          action: "GENERATE_IMAGE",
        },
      },
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Make an image of a dog with a hat" },
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Here's an image of a dog with a hat",
          action: "GENERATE_IMAGE",
        },
      },
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Paint an image of a cat with a hat" },
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Here's an image of a cat with a hat",
          action: "GENERATE_IMAGE",
        },
      },
    ],
  ],
};

export const imageGenerationPlugin: Plugin = {
  name: "imageGeneration",
  description: "Generate images",
  actions: [imageGeneration],
  evaluators: [],
  providers: [],
};

export default imageGenerationPlugin;
