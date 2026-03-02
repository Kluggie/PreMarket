import tokenHandler from '../[token].js';

export default async function handler(req: any, res: any, tokenParam?: string) {
  return tokenHandler(req, res, tokenParam);
}
