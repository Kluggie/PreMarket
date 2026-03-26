export class ApiError extends Error {
  statusCode: number;
  code: string;
  extra: Record<string, unknown>;
  constructor(
    statusCode: number,
    code: string,
    message: string,
    extra?: Record<string, unknown>,
  );
}
