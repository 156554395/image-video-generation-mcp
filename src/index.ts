#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { Config } from './config.js';
import { ImageVideoGenerationClient } from './image-video-generation-client.js';
import { ValidationError } from './errors.js';

class ImageVideoGenerationMCPServer {
  private server: Server;
  private client: ImageVideoGenerationClient;

  constructor(config: Config) {
    this.server = new Server({
        name: 'image-video-generation-mcp',
        version: '1.0.0',
        description: 'MCP server for image and video generation',
      }, {
        capabilities: {
          tools: {},
        },
      }
    );

    this.client = new ImageVideoGenerationClient(config);
    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'generate_image',
            description: 'Generate images using BigModel CogView models',
            inputSchema: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'Text description of the image to generate',
                },
                model: {
                  type: 'string',
                  description: 'Model to use (cogview-4, cogview-4-250304, cogview-3-flash)',
                  enum: ['cogview-4', 'cogview-4-250304', 'cogview-3-flash'],
                  default: 'cogview-3-flash',
                },
                quality: {
                  type: 'string',
                  description: 'Image quality',
                  enum: ['standard', 'hd'],
                  default: 'standard',
                },
                size: {
                  type: 'string',
                  description: 'Image size (e.g., 1024x1024, 1024x1792)',
                  default: '1024x1024',
                },
                watermark_enabled: {
                  type: 'boolean',
                  description: 'Whether to add watermark',
                  default: false,
                },
                user_id: {
                  type: 'string',
                  description: 'User ID for tracking (6-128 characters)',
                  minLength: 6,
                  maxLength: 128,
                },
              },
              required: ['prompt'],
            },
          } as Tool,
          {
            name: 'generate_video',
            description: 'Generate videos using BigModel CogVideoX models',
            inputSchema: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'Text description of the video to generate (max 512 characters)',
                  maxLength: 512,
                },
                model: {
                  type: 'string',
                  description: 'Model to use',
                  enum: ['cogvideox-3', 'cogvideox-2', 'cogvideox-flash'],
                  default: 'cogvideox-flash',
                },
                quality: {
                  type: 'string',
                  description: 'Output quality mode',
                  enum: ['speed', 'quality'],
                  default: 'quality',
                },
                size: {
                  type: 'string',
                  description: 'Video resolution (e.g., 1920x1080, 1280x720)',
                  default: '1920x1080',
                },
                fps: {
                  type: 'number',
                  description: 'Frame rate',
                  enum: [30, 60],
                  default: 30,
                },
                duration: {
                  type: 'number',
                  description: 'Video duration in seconds',
                  enum: [5, 10],
                  default: 10,
                },
                with_audio: {
                  type: 'boolean',
                  description: 'Enable AI-generated audio',
                  default: true,
                },
                watermark_enabled: {
                  type: 'boolean',
                  description: 'Control watermark',
                  default: false,
                },
              },
              required: ['prompt'],
            },
          } as Tool,
          {
            name: 'query_video_result',
            description: 'Query the result of an asynchronous video generation task',
            inputSchema: {
              type: 'object',
              properties: {
                task_id: {
                  type: 'string',
                  description: 'The task ID returned from video generation',
                },
              },
              required: ['task_id'],
            },
          } as Tool,
          {
            name: 'wait_for_video',
            description: 'Wait for video generation to complete and return the result',
            inputSchema: {
              type: 'object',
              properties: {
                task_id: {
                  type: 'string',
                  description: 'The task ID returned from video generation',
                },
                max_wait_time: {
                  type: 'number',
                  description: 'Maximum wait time in milliseconds (default: 300000)',
                  default: 300000,
                },
                poll_interval: {
                  type: 'number',
                  description: 'Polling interval in milliseconds (default: 5000)',
                  default: 5000,
                },
              },
              required: ['task_id'],
            },
          } as Tool,
          {
            name: 'configure_models',
            description: 'Configure default models and settings',
            inputSchema: {
              type: 'object',
              properties: {
                default_image_model: {
                  type: 'string',
                  description: 'Default image generation model',
                  enum: ['cogview-4', 'cogview-4-250304', 'cogview-3-flash'],
                },
                default_video_model: {
                  type: 'string',
                  description: 'Default video generation model',
                  enum: ['cogvideox-3', 'cogvideox-2', 'cogvideox-flash'],
                },
                timeout: {
                  type: 'number',
                  description: 'Request timeout in milliseconds',
                  minimum: 1000,
                  maximum: 300000,
                },
                max_retries: {
                  type: 'number',
                  description: 'Maximum retry attempts',
                  minimum: 1,
                  maximum: 10,
                },
              },
            },
          } as Tool,
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'generate_image':
            return await this.handleGenerateImage(args);

          case 'generate_video':
            return await this.handleGenerateVideo(args);

          case 'query_video_result':
            return await this.handleQueryVideoResult(args);

          case 'wait_for_video':
            return await this.handleWaitForVideo(args);

          case 'configure_models':
            return await this.handleConfigureModels(args);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof ValidationError) {
          return {
            content: [
              {
                type: 'text',
                text: `Validation Error: ${error.message}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleGenerateImage(args: any) {
    const response = await this.client.generateImage(args);

    return {
      content: [
        {
          type: 'text',
          text: `Image generated successfully!\n\n` +
            `Created: ${new Date(response.created * 1000).toISOString()}\n` +
            `Images: ${response.data.length}\n` +
            `Content Filter Level: ${response.content_filter?.level || 'N/A'}\n\n` +
            `Image URLs:\n` +
            response.data.map((img, index) =>
              `${index + 1}. ${img.url}${img.revised_prompt ? `\n   Revised prompt: ${img.revised_prompt}` : ''}`
            ).join('\n')
        },
        {
          type: 'text',
          text: response.data.map(img => img.url).join('\n'),
        },
      ],
    };
  }

  private async handleGenerateVideo(args: any) {
    const response = await this.client.generateVideo(args);

    // 使用 response.id 作为 task_id，这是查询API需要的正确ID
    const taskId = response.id || response.request_id || 'N/A';

    return {
      content: [
        {
          type: 'text',
          text: `Video generation task started!\n\n` +
            `Task ID: ${taskId}\n` +
            `Request ID: ${response.request_id || 'N/A'}\n` +
            `Status: ${response.task_status || 'N/A'}\n` +
            `Model: ${response.model || 'N/A'}\n\n` +
            `Use the 'query_video_result' tool with Task ID to check the status, ` +
            `or 'wait_for_video' to wait for completion.`,
        },
        {
          type: 'text',
          text: taskId, // 提供纯文本的 task_id 方便复制使用
        },
      ],
    };
  }

  private async handleQueryVideoResult(args: any) {
    const { task_id } = args;
    const response = await this.client.queryAsyncResult(task_id);

    let message = `Video Generation Status:\n\n` +
      `Task ID: ${response.request_id || task_id}\n` +
      `Status: ${response.task_status || 'N/A'}` +
      (response.model ? `\nModel: ${response.model}` : '') +
      (response.created ? `\nCreated: ${new Date(response.created * 1000).toISOString()}` : '');

    // 支持两种字段名：video_result 和 video_results
    const videoResults = response.video_result || response.video_results;

    if (response.task_status === 'SUCCESS' && videoResults && videoResults.length > 0) {
      message += `\n\nVideos:\n` +
        videoResults.map((video, index) =>
          `${index + 1}. ${video.url}${video.cover_image_url ? `\n   Cover: ${video.cover_image_url}` : ''}`
        ).join('\n');
    }

    if (response.error) {
      message += `\n\nError: ${response.error}`;
    }

    return {
      content: [
        {
          type: 'text',
          text: message,
        },
        ...(videoResults && videoResults.length > 0 ? [{
          type: 'text',
          text: videoResults.map(video => video.url).join('\n'),
        }] : [])
      ],
    };
  }

  private async handleWaitForVideo(args: any) {
    const { task_id, max_wait_time, poll_interval } = args;
    const response = await this.client.waitForVideoResult(
      task_id,
      max_wait_time,
      poll_interval
    );

    // 支持两种字段名：video_result 和 video_results
    const videoResults = response.video_result || response.video_results;

    if (videoResults && videoResults.length > 0) {
      return {
        content: [
          {
            type: 'text',
            text: `Video generation completed!\n\n` +
              `Task ID: ${response.request_id || task_id}\n` +
              `Status: ${response.task_status || 'N/A'}\n` +
              (response.model ? `Model: ${response.model}\n` : '') +
              (response.created ? `Created: ${new Date(response.created * 1000).toISOString()}\n` : '') +
              `\nVideos:\n` +
              videoResults.map((video, index) =>
                `${index + 1}. ${video.url}${video.cover_image_url ? `\n   Cover: ${video.cover_image_url}` : ''}`
              ).join('\n')
          },
          {
            type: 'text',
            text: videoResults.map(video => video.url).join('\n'),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Video generation completed with status: ${response.task_status || 'N/A'}`,
        },
      ],
    };
  }

  private async handleConfigureModels(args: any) {
    const updates: any = {};

    if (args.default_image_model) {
      updates.defaultImageModel = args.default_image_model;
    }
    if (args.default_video_model) {
      updates.defaultVideoModel = args.default_video_model;
    }
    if (args.timeout) {
      updates.timeout = args.timeout;
    }
    if (args.max_retries) {
      updates.maxRetries = args.max_retries;
    }

    this.client.updateConfig?.(updates);

    return {
      content: [
        {
          type: 'text',
          text: `Configuration updated successfully!\n\n` +
            `Changes:\n` +
            Object.entries(updates).map(([key, value]) => `  ${key}: ${value}`).join('\n'),
        },
      ],
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MCP Image Video Generation server running on stdio');
  }
}

async function main(): Promise<void> {
  try {
    const config = new Config();
    const server = new ImageVideoGenerationMCPServer(config);
    await server.run();
  } catch (error) {
    console.error('❌ Failed to start MCP server:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Server startup error:', error);
    process.exit(1);
  });
}