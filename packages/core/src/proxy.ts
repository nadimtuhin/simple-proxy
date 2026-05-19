import axios, { AxiosError } from 'axios';
import { ProxyError, ProxyRequestPayload, ProxyResponse, MAX_REQUEST_SIZE } from './types.js';
import { classifyResponseError, classifyNetworkError } from './errors.js';

export async function axiosProxyRequest(payload: ProxyRequestPayload): Promise<ProxyResponse> {
  if (!payload.url) {
    throw new Error('url is required for axiosProxyRequest');
  }

  try {
    const response = await axios({
      url: payload.url,
      method: payload.method,
      headers: payload.headers,
      timeout: payload.timeout,
      maxContentLength: MAX_REQUEST_SIZE,
      maxBodyLength: MAX_REQUEST_SIZE,
      ...(payload.data !== undefined ? { data: payload.data } : {}),
    });
    return response as ProxyResponse;
  } catch (error) {
    const axiosError = error as AxiosError;

    if (axiosError.response) {
      throw classifyResponseError(axiosError);
    } else if (axiosError.request) {
      throw classifyNetworkError(axiosError);
    } else {
      const enhancedError: ProxyError = new Error(`Request setup error: ${axiosError.message}`);
      enhancedError.status = 500;
      enhancedError.code = 'REQUEST_ERROR';
      throw enhancedError;
    }
  }
}
