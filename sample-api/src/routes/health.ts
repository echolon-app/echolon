import { Router, Request, Response } from 'express';

const router = Router();

// ============================================================================
// Health Endpoints
// ============================================================================

/**
 * @openapi
 * /health:
 *   get:
 *     tags:
 *       - Health
 *     summary: Health check
 *     description: Returns the health status of the API
 *     responses:
 *       200:
 *         description: API is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ============================================================================
// Echo Endpoint
// ============================================================================

/**
 * @openapi
 * /echo:
 *   post:
 *     tags:
 *       - Echo
 *     summary: Echo back request
 *     description: Returns the request body, headers, query params and method back to the client. Useful for testing.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *         text/plain:
 *           schema:
 *             type: string
 *     parameters:
 *       - in: query
 *         name: delay
 *         schema:
 *           type: integer
 *         description: Optional delay in milliseconds before responding
 *     responses:
 *       200:
 *         description: Echoed request data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 method:
 *                   type: string
 *                 path:
 *                   type: string
 *                 query:
 *                   type: object
 *                 headers:
 *                   type: object
 *                 body:
 *                   type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *   get:
 *     tags:
 *       - Echo
 *     summary: Echo back request (GET)
 *     description: Returns the request headers, query params and method back to the client. Useful for testing.
 *     parameters:
 *       - in: query
 *         name: delay
 *         schema:
 *           type: integer
 *         description: Optional delay in milliseconds before responding
 *     responses:
 *       200:
 *         description: Echoed request data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 method:
 *                   type: string
 *                 path:
 *                   type: string
 *                 query:
 *                   type: object
 *                 headers:
 *                   type: object
 *                 body:
 *                   type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *   put:
 *     tags:
 *       - Echo
 *     summary: Echo back request (PUT)
 *     description: Returns the request body, headers, query params and method back to the client. Useful for testing.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *     responses:
 *       200:
 *         description: Echoed request data
 *   patch:
 *     tags:
 *       - Echo
 *     summary: Echo back request (PATCH)
 *     description: Returns the request body, headers, query params and method back to the client. Useful for testing.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *     responses:
 *       200:
 *         description: Echoed request data
 *   delete:
 *     tags:
 *       - Echo
 *     summary: Echo back request (DELETE)
 *     description: Returns the request headers, query params and method back to the client. Useful for testing.
 *     responses:
 *       200:
 *         description: Echoed request data
 */

export const echoHandler = async (req: Request, res: Response) => {
  // Optional delay for testing loading states
  const delay = parseInt(req.query.delay as string) || 0;
  if (delay > 0) {
    await new Promise(resolve => setTimeout(resolve, Math.min(delay, 10000))); // Max 10s delay
  }

  res.json({
    method: req.method,
    path: req.path,
    url: req.url,
    query: req.query,
    headers: req.headers,
    body: req.body,
    timestamp: new Date().toISOString(),
  });
};

export default router;

