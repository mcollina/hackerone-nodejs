interface AppErrorOptions {
  code: string;
  statusCode?: number;
  cause?: Error;
}

export interface AppError extends Error {
  code: string;
  statusCode: number;
  retryAfter?: number;
}

function createAppError(message: string, options: AppErrorOptions): AppError {
  const error = new Error(message, { cause: options.cause }) as AppError;
  error.code = options.code;
  error.statusCode = options.statusCode ?? 500;
  Error.captureStackTrace(error, createAppError);
  return error;
}

export function authenticationError(): AppError {
  return createAppError('Authentication failed', {
    code: 'AUTHENTICATION_ERROR',
    statusCode: 401,
  });
}

export function notFoundError(resource: string): AppError {
  return createAppError(`${resource} not found`, {
    code: 'NOT_FOUND',
    statusCode: 404,
  });
}

export function rateLimitError(retryAfter?: number): AppError {
  const error = createAppError('Rate limit exceeded', {
    code: 'RATE_LIMIT',
    statusCode: 429,
  });
  error.retryAfter = retryAfter;
  return error;
}

export function apiError(message: string, statusCode: number, cause?: Error): AppError {
  return createAppError(message, {
    code: 'API_ERROR',
    statusCode,
    cause,
  });
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof Error && 'code' in error && 'statusCode' in error;
}
