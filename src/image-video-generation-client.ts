import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { Config } from './config.js';
import {
  ImageGenerationParams,
  VideoGenerationParams,
  AsyncResult,
  ImageGenerationResponse
} from './config.js';
import { ApiError, NetworkError } from './errors.js';

export class ImageVideoGenerationClient {
  private client: AxiosInstance;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use((request) => {
      request.headers.Authorization = `Bearer ${this.config.apiKey}`;
      return request;
    });
  }

  private async retryRequest<T>(
    requestFn: () => Promise<T>,
    maxRetries: number = this.config.maxRetries
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxRetries) {
          break;
        }

        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }

  private handleApiError(error: any): never {
    if (error.response) {
      const { status, data } = error.response;
      const message = data?.error?.message || data?.message || 'API request failed';
      throw new ApiError(message, data?.error?.code || 'UNKNOWN_ERROR', status);
    } else if (error.request) {
      throw new NetworkError('Network error: No response received');
    } else {
      throw new NetworkError(`Network error: ${error.message}`);
    }
  }

  async generateImage(params: ImageGenerationParams): Promise<ImageGenerationResponse> {
    const requestConfig: AxiosRequestConfig = {
      method: 'POST',
      url: '/paas/v4/images/generations',
      data: {
        model: params.model || this.config.defaultImageModel,
        prompt: params.prompt,
        quality: params.quality || 'standard',
        size: params.size || '1024x1024',
        watermark_enabled: params.watermark_enabled !== undefined ? params.watermark_enabled : true,
        ...(params.user_id && { user_id: params.user_id }),
      },
    };

    return this.retryRequest(async () => {
      try {
        const response = await this.client.request<ImageGenerationResponse>(requestConfig);
        return response.data;
      } catch (error) {
        this.handleApiError(error);
      }
    });
  }

  async generateVideo(params: VideoGenerationParams): Promise<AsyncResult> {
    const requestConfig: AxiosRequestConfig = {
      method: 'POST',
      url: '/paas/v4/videos/generations',
      data: {
        model: params.model || this.config.defaultVideoModel,
        prompt: params.prompt,
        ...(params.image_url && { image_url: params.image_url }),
        ...(params.quality && { quality: params.quality }),
        ...(params.size && { size: params.size }),
        ...(params.fps && { fps: params.fps }),
        ...(params.duration && { duration: params.duration }),
        ...(params.with_audio !== undefined && { with_audio: params.with_audio }),
        ...(params.watermark_enabled !== undefined && { watermark_enabled: params.watermark_enabled }),
      },
    };

    return this.retryRequest(async () => {
      try {
        const response = await this.client.request<AsyncResult>(requestConfig);
        return response.data;
      } catch (error) {
        this.handleApiError(error);
      }
    });
  }

  async queryAsyncResult(taskId: string): Promise<AsyncResult> {
    const requestConfig: AxiosRequestConfig = {
      method: 'GET',
      url: `/paas/v4/async-result/${taskId}`,
    };

    return this.retryRequest(async () => {
      try {
        const response = await this.client.request<AsyncResult>(requestConfig);
        return response.data;
      } catch (error) {
        this.handleApiError(error);
      }
    });
  }

  async waitForVideoResult(
    taskId: string,
    maxWaitTime: number = 300000,
    pollInterval: number = 5000
  ): Promise<AsyncResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const result = await this.queryAsyncResult(taskId);

      if (result.task_status === 'SUCCESS') {
        return result;
      }

      if (result.task_status === 'FAIL') {
        throw new ApiError(
          result.error || 'Video generation failed',
          'GENERATION_FAILED'
        );
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new ApiError(
      'Video generation timed out',
      'TIMEOUT_ERROR'
    );
  }

  updateConfig(updates: any): void {
    this.config.updateConfig(updates);

    if (updates.timeout) {
      this.client.defaults.timeout = updates.timeout;
    }
  }
}